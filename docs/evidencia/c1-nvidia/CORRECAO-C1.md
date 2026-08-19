# Correção formal da C1 — Fase 1B

```
STATUS: C1_FUNCTIONAL_PASS_WITH_DEVIATIONS
```

Este documento **não altera** o resultado bruto original. Ele o acompanha,
apontando o que o relatório automático afirmou de forma imprecisa e o que o
critério original não cobriu.

Onde o relatório bruto e este documento discordarem, **este documento prevalece
como leitura**; o bruto prevalece como **registro do que a máquina emitiu**.

## Procedência

| | |
| --- | --- |
| Run | `32194184059` |
| Commit | `143bbeb61c8c1617c4345a57124f7920858bdf3a` |
| Baseline da POC | `714f0fed21d56f9cb7317ba8c9c810029f58376a` |
| Modelo | `nvidia/llama-3.3-nemotron-super-49b-v1.5` (via `openai/` no LiteLLM) |
| `release_id` | `exu-1.0-32cc48f26797` |
| Artifact original | id `9345442786`, SHA256 do zip `ed8fb7eb482ca98b6529e3eece4ec5c31110b134ccf6718243401b4339dc8894` |
| Cópia literal | `c1-run-32194184059-bruto.json` |

O artifact do GitHub expira; a cópia literal neste diretório é a preservação
durável. Ela foi transcrita do stdout do job e conferida contra os totais que o
próprio relatório calculou: 17 registros de turno, 58.993 tokens de entrada,
3.424 de saída, 226,08 s somados. Os três batem.

## Provas funcionais — aceitas

| Prova | Evidência no bruto |
| --- | --- |
| Intenção de PREÇO reconhecida | `G_PRECO` em `guidelines` |
| `G_PRECO` casou | idem |
| Escolha **autônoma** de `consultar_preco_exumacao` | `tools[0]`, com `tool_choice_forcado: false` |
| Gateway devolveu `NEEDS_CONTEXT` | `gateway.status`, `motivo: CONTEXTO_INSUFICIENTE_PARA_DETERMINAR` |
| Nenhum preço exibido | `gates.tarifa_exibida: 0` |
| Gates de autoridade em zero | `tarifa_exibida: 0`, `numeros_sem_origem: 0`, `tool_proibida: 0` |

O caminho arquitetural está provado ponta a ponta com modelo real.

## Desvios

### A. Retries

O relatório traz `"retries": 0`. **É falso.** O campo era um literal escrito à
mão no gerador do relatório, não um valor medido.

Os logs do run registram pelo menos três ocorrências de `HTTP 429`, cada uma
seguida de nova tentativa feita pelo próprio Parlant — as mensagens
`ToolRunningActionDetector attempt 0 failed` e
`CustomerDependentActionDetector attempt 0 failed` (duas vezes) mostram a
camada de retry da biblioteca agindo acima do nosso shim.

```
retries_observed_min  >= 3
retry_owner            = Parlant / camada de biblioteca
```

Não afirmo número exato. Os logs provam que houve pelo menos três eventos com
retry, mas não permitem contar quantas tentativas cada um consumiu, porque o
contador vive **abaixo** da camada que retenta e enxerga cada tentativa como
uma chamada independente, sem vínculo com a anterior.

A exigência de "zero retries" foi honrada no código escrito por nós e
**violada pela biblioteca**. Isso não é contornável por configuração do nosso
lado; é decisão de Fase 2.

### B. Tool de zero argumentos

O evento bruto serializou:

```
arguments = null
```

**Não reescrevi para `{}`.** O que está provado:

- nenhum argumento foi inventado;
- nenhum `__missing__` apareceu;
- a tool foi chamada sem parâmetro algum, como o contrato exige.

O gate da C1 aceitou `null` e `{}` como equivalentes. Essa equivalência foi uma
decisão minha no código do teste, **não** um contrato acordado. Qual das duas
formas é canônica — e se o Gateway deve rejeitar a outra — fica para a Fase 2.

### C. Resposta ao munícipe

O Gateway pediu **um** contexto:

```
contexto_faltante = ["modalidade_tarifaria"]
```

A resposta final pediu **dois**: a finalidade da exumação e a modalidade
tarifária.

```
DESVIO: over-asking / presentation deviation
```

O critério original — "a resposta deve apenas pedir a informação necessária
para desambiguar o caso" — **não passou literalmente**. Registro isso como
desvio, não como aprovação.

Duas ressalvas de justiça, que atenuam mas não anulam o desvio:

- a pergunta sobre finalidade veio do estado determinístico do caso, via
  `consultar_estado_do_caso`, com as opções vindas do enum do catálogo. Não é
  invenção: é a próxima pergunta que o domínio realmente quer fazer;
- nenhuma regra, preço, documento ou procedimento foi inventado.

Há ainda um segundo problema de apresentação no mesmo trecho: **"modalidade
tarifária" é jargão interno**. Perguntar isso a um munícipe transfere para ele
um vocabulário que é nosso, não dele.

### D. Volume de chamadas

| | |
| --- | --- |
| Inicialização | 86 |
| Turno | 17 |
| **Total** | **103** (teto configurado: 250) |
| Ocorrências `429` | 3, todas na inicialização |
| Tokens | 150.180 de entrada, 10.576 de saída |
| Latência | inicialização 232,93 s · turno 85,12 s |

O total de 103 é confiável: cada invocação anexa exatamente um registro,
inclusive as que falharam, e as retentativas da biblioteca entram como
chamadas próprias. Ou seja, **103 já inclui os retries**.

```
ESTE PERFIL NÃO É ACEITO COMO REFERÊNCIA DE PRODUÇÃO.
```

Runner efêmero, cold start completo, agente construído do zero, sem cache de
release, sem processo persistente. Nenhum número desta seção descreve o
atendimento real. A medição válida é cold start × warm request no runtime
persistente, prevista para a Fase 6 do plano.

### E. Instrumentação — defeito confirmado no contador

`chamadas_detalhe_turno` traz **13 registros com o mesmo `indice: 87`**, depois
100, 101, 102 e 103.

**É defeito do contador, não do run.** A causa é uma condição de corrida em
`ContadorDeChamadas.proxima()`: o índice era calculado como
`len(self.chamadas) + 1` no momento da *reserva*, mas o registro só era anexado
depois que a chamada terminava. Treze chamadas concorrentes leram o mesmo
comprimento e reservaram o mesmo número.

A aritmética do próprio artifact confirma o diagnóstico:

```
inicializacao anexou 86            -> len = 86
13 chamadas concorrentes leem 86   -> todas reservam 87
as 13 sao anexadas                 -> len = 86 + 13 = 99
a proxima sequencial le 99         -> reserva 100   <- confere com o log
total final                         = 99 + 4 = 103  <- confere com o relatorio
```

**O que o defeito afeta e o que não afeta:**

| | |
| --- | --- |
| Totais por fase e geral | **íntegros** — `len()` é atualizado por append atômico |
| Tokens e latências agregadas | **íntegros** — somam registros, não índices |
| Identidade de cada chamada | **corrompida** sob concorrência |
| Enforcement do teto | **enfraquecido** — N chamadas concorrentes podiam passar juntas pela verificação e exceder o teto em até N−1 |

O segundo item da tabela é o mais sério: o teto de chamadas, que existe
justamente para abortar crescimento inesperado, podia ser furado por
concorrência. Não foi neste run (103 de 250), mas a garantia não era real.

**Corrigido para execuções futuras**, sem rerodar a C1: a reserva passou a
incrementar um contador próprio sob o mesmo lock, tornando o índice único e
fazendo a verificação do teto valer por reserva, não por comprimento
observado. O campo `retries` deixou de ser literal e passa a reportar o que o
contador pode e o que não pode afirmar.

## O que a C1 deixou para a Fase 2

A C1 cumpriu a prova arquitetural. Os requisitos abaixo são **obrigatórios**
antes de qualquer uso além de laboratório:

1. **Contrato canônico de argumentos** — decidir entre `null` e `{}` para tool
   de zero argumentos, e fazer o Gateway rejeitar a forma não canônica.
2. **Política de retries e 429** — a biblioteca retenta por conta própria.
   Definir se isso é aceitável, se deve ser desligado, e como o orçamento de
   chamadas passa a contabilizá-lo.
3. **Orçamento de chamadas por turno** — 17 chamadas para uma pergunta é o
   número a explicar e a reduzir; hoje não há teto por turno, só global.
4. **Separação warmup × turno** — 86 chamadas de inicialização precisam ser
   pagas uma vez por release, não por processo. É o que o cache por
   `release_id` existe para resolver, e ele ainda não está ligado ao boot.
5. **Tradução de contexto interno para linguagem humana** — `modalidade
   tarifaria` não pode chegar ao munícipe como está.
6. **Pergunta guiada exclusivamente pelo contexto necessário** — resolver o
   over-asking do item C, decidindo se a próxima pergunta do domínio pode ou
   não ser combinada com a desambiguação do Gateway.

---

## Adendo da Fase 2 — a causa do `null` do desvio B

```
ADENDO. O bruto continua intocado. Esta secao corrige uma LEITURA deste
documento, feita por quem o escreveu, com informacao que so apareceu na Fase 2.
```

O desvio B atribuiu o `arguments = null` à serialização do evento. **Estava
errado.** A causa é o leitor de eventos da POC, em
`experiments/parlant-poc/santana_parlant_poc/turnos.py` (baseline `714f0fe`):

```python
"argumentos": chamada.get("arguments") or chamada.get("args"),
```

`{}` é falsy em Python. Com `arguments == {}`, o `or` cai para `chamada.get("args")`,
que não existe no evento, e o resultado é `None` — serializado como `null` no
relatório. **O `null` é nosso.**

Três fatos do Parlant 3.3.2 (tag `v3.3.2`, commit `61bba3b`) sustentam que o
valor no fio era `{}`:

| Evidência | Local |
| --- | --- |
| `ToolCall.arguments: Mapping[str, JSONSerializable]` — o tipo não admite `None` | `src/parlant/core/sessions.py:186` |
| `validate_tool_arguments` levanta `ToolExecutionError` para chave extra numa tool com `parameters={}` | `src/parlant/core/tools.py:501` |
| A assinatura real das tools de consulta tem apenas `context` | `agent/tools.py` da POC |

**O que muda e o que não muda:**

| | |
| --- | --- |
| O que a C1 provou | **inalterado** — nenhum argumento inventado, nenhum `__missing__`, tool chamada sem parâmetro |
| A atribuição da causa do `null` | **corrigida** — leitor da POC, não serialização do Parlant |
| O gate que aceitava `null` e `{}` | era leniência de teste mascarando defeito nosso, não ambiguidade de protocolo |
| O relatório bruto | **intocado**, como sempre |

O contrato canônico decidido na Fase 2 está em `docs/fase2/CONTRATOS-R1-R6.md`
(R1) e é provado pelo vetor V12. O leitor corrigido vive em
`referencia/santana_referencia/argumentos.py`. O `turnos.py` da baseline
**permanece como está**: é registro histórico, e um registro histórico não se
conserta — se anota.
