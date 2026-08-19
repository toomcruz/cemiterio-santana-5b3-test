# Handoff — Projeto Santana

Documento de continuidade, para que outro agente ou outra pessoa retome o
projeto **sem acesso ao histórico de conversa** que o produziu.

## 0. Precedência documental

Este documento é **índice e fotografia operacional**. Não é fonte autoritativa.

```
1. fontes/dados autoritativos versionados
2. contratos e vetores congelados
3. relatório da fase correspondente
4. evidência bruta e correções formais
5. PR/commit correspondente
6. HANDOFF                                  <- este documento
```

**Se o HANDOFF divergir de um documento canônico, o canônico prevalece.** É a
mesma regra que `docs/evidencia/c1-nvidia/CORRECAO-C1.md` já aplica ao relatório
bruto da C1.

Todo SHA citado aqui é fotografia do momento da escrita. **Confirme antes de
agir** — a seção 14 diz como.

## 1. Estado agora

| Fase | Status |
| --- | --- |
| Fase 0 — governança do repositório | **encerrada** (com risco aceito) |
| Fase 1A — preflight NVIDIA | **encerrada** |
| Fase 1B — C1 real | **encerrada** |
| Fase 2 — contratos R1–R6 e vetores V1–V12 | **encerrada** |
| Fase 3 — Gateway definitivo TS/Deno | **NÃO encerrada** — ver abaixo |

```
Fase 3:  IMPLEMENTATION_PASS_LOCAL
         CI_PENDING_ACTIONS_QUOTA
         NO_MERGE

PR #22 (aberto, sem merge)
HEAD    2daeaca947472d92831796c8fb42e5f7be6295ca
base    119c14f0fcdf30e269d3f74c2bec4e6efaaa23ac

CI_STATUS                   PENDING_VALIDATION
LAST_RUN                    32237817101
LAST_RUN_GITHUB_CONCLUSION  failure
FAILURE_CLASSIFICATION      ACTIONS_QUOTA / INFRASTRUCTURE
IMPLEMENTATION_FAILURE      false
```

O `failure` do run `32237817101` **não é falha do código**. No job `static`
daquele run: `runner_id: 0`, `runner_name: ""`, array `steps` **ausente**, e 2
segundos entre `started_at` e `completed_at`. Nenhum step chegou a ser criado,
logo nenhum falhou. A conta está sem minutos incluídos de GitHub Actions até
01/09/2026.

```
PRÓXIMA FASE: FASE 4 — ESCOPO A DEFINIR APÓS O ENCERRAMENTO FORMAL DA FASE 3.
```

## 2. Arquitetura

```
WhatsApp -> n8n -> Parlant -> Santana Authority Gateway -> resposta controlada -> n8n -> W-API
```

| Camada | Responsabilidade | O que não faz |
| --- | --- | --- |
| LLM (Gemini/NVIDIA) | interpretação linguística | não é autoridade administrativa |
| Parlant | governança conversacional: guidelines, journeys, tools, sessões | não decide conteúdo oficial |
| **Authority Gateway** | preços, documentos, prazos, procedimentos, regras, contexto, aplicabilidade, estado autoritativo | não gera texto livre |
| n8n | orquestração | não decide |
| W-API | entrega | não decide |

Regra que atravessa o projeto inteiro:

> **O LLM NÃO pode ser autoridade administrativa.**

## 3. Fases 0–3

| Fase | Entrega | PR | Documento canônico |
| --- | --- | --- | --- |
| 0 | Governança de `main`, tag e evidência organizada | #12 | `docs/evidencia/README.md` |
| 1A | Preflight NVIDIA: modelo acessível, tool calling, structured output | #13 | `.github/workflows/1a-nvidia-preflight.yml` |
| 1B | Primeira conversa C1 real completa | #20 | `docs/evidencia/c1-nvidia/CORRECAO-C1.md` |
| 2 | Contratos R1–R6 e vetores V1–V12 congelados | #21 | `docs/fase2/` |
| 3 | Gateway definitivo TS/Deno | #22 (aberto) | `docs/fase3/RELATORIO-FASE-3.md` |

A Fase 0 fechou com **risco aceito**: o ruleset `protect-main` existe mas não é
aplicável em repositório privado fora de organização Team, e a API ainda reporta
`"protected": false` para `main`; vale uma política operacional de oito regras.
A Fase 1B fechou como `C1_FUNCTIONAL_PASS_WITH_DEVIATIONS`, com cinco desvios
(A–E) e um adendo posterior da Fase 2.

### Nomenclatura histórica / documentos históricos

O repositório contém documentos que usam **outros sistemas de numeração de
fases**. Citados em `origin/main` `119c14f0fcdf30e269d3f74c2bec4e6efaaa23ac`:

| Documento | Blob | Numeração que usa |
| --- | --- | --- |
| `docs/evidencia/parlant-poc/GATE-FASE-4.md` | `cde7c6c29c9e` | fases internas da POC (`Fase 4A`; ver tag `poc/exumacao-fase4a`) |
| `docs/phase-5b2-checklist.md` (e `-c2-`, `-c3-`, `-c4-`) | `ac46c121e2bb` | sistema `5B.x`, anterior a este fluxo de trabalho |
| `docs/evidencia/c1-nvidia/CORRECAO-C1.md:141` | `de0e8bf9f939` | diz literalmente *"Fase 6 **do plano**"* |
| `docs/fase2/CONTRATOS-R1-R6.md:110` | `d744b89446c5` | idem, "Fase 6" |
| `docs/fase2/VETORES-V1-V12.md:259` | `e04b38543f52` | idem, "Fase 6" |

> **Estes são documentos históricos, não roadmap vigente.** O plano a que
> `CORRECAO-C1.md:141` se refere **não existe versionado neste repositório**, e
> nenhuma equivalência entre sistemas de numeração está provada em documento
> algum. **Não inferir equivalência.**
>
> A numeração vigente é **0, 1A, 1B, 2, 3**, e a próxima é **4**, com escopo a
> definir.

## 4. Contratos R1–R6

Definição completa: **`docs/fase2/CONTRATOS-R1-R6.md`**.

| | Contrato | Núcleo |
| --- | --- | --- |
| R1 | argumentos canônicos | `{}` é a forma canônica de tool de zero argumentos; normalização de ausência vale **só** para zero-arg; o valor bruto do evento é preservado literalmente; mapa não vazio ⇒ `ARGUMENTOS_NAO_CANONICOS`, falha fechada |
| R2 | retries e HTTP 429 | tentativas reais e ocorrências 429 são as **únicas** métricas autoritativas; fingerprint é diagnóstico, nunca valor exato; disjuntor de 3 ocorrências; **429 nunca altera resposta autoritativa** |
| R3 | orçamento por turno | `TETO_TURNO = 25` é **hard safety cap contra runaway**, explicitamente **não** orçamento de produção; a meta operacional sai de medição em runtime persistente e deve ser inferior ao teto |
| R4 | inicialização × atendimento | zero chamadas de IA no boot em produção; artefato de release produzido no build; chave de cache = `release_id ‖ runtime_fingerprint` |
| R5 | léxico de apresentação | mão única: `código -> texto` permitido, `texto -> código` **proibido**; falha fechada quando não há entrada no léxico |
| R6 | uma pergunta por turno | precedência `DESAMBIGUACAO_GATEWAY > PROXIMA_PERGUNTA_DO_DOMINIO`; `opcoes_por_campo` no lugar de lista plana |

Alerta que engana com facilidade: **o R5 melhora a pergunta, não destrava o
preço.** Sem `MAP_MODALIDADE_TARIFARIA` decidido, a jornada de preço termina em
encaminhamento à Administração — ver seção 10.

## 5. Vetores V1–V12

Especificação: **`docs/fase2/VETORES-V1-V12.md`**.
Artefatos: **`conformidade/vetores/`** (47 casos) e `conformidade/vetores/FORMATO.md`.

| Resultado | Significado |
| --- | --- |
| `PASS` | saída real == esperada, documento inteiro, após canonização, **e** escritas iguais |
| `FAIL` | qualquer diferença — chave a mais, chave a menos, ordem, motivo errado, `entry_id` diferente |
| `INVALIDO` | `release_id` divergente: o vetor **não roda** e **não conta como PASS** |

> **Nenhum vetor é alterado para fazer uma implementação passar.** Se uma
> implementação diverge, corrige-se a implementação — inclusive quando a
> implementação é a de referência.

## 6. Estrutura do repositório

```
santana-authority/            dados autoritativos          — de nenhuma implementação
  catalogo/exumacao.v1.json     sha256 22e1e1f0…d03e5c1d
conformidade/                 contratos compartilhados     — de nenhuma implementação
  vetores/                      47 casos + FORMATO.md
  vetores/fixtures/             fixtures, isoladas dos dados autoritativos
  perfis/exumacao.v1.json       escopo técnico (NÃO fonte autoritativa)
  comparar.py                   comparador entre implementações
referencia/                   implementação de referência (Python), conformidade
santana-authority-gateway/    runtime definitivo (TS/Deno)
santana-conversation-domain/  catálogos de domínio, engine e testes P0
docs/fase2/ docs/fase3/ docs/evidencia/
```

A regra que produziu essa forma, aprendida por correção:

> **Nenhuma implementação é dona da fonte autoritativa.**

## 7. Autoridade e segurança

- **Falha fechada.** O indeterminável vira `NOT_AVAILABLE` com encaminhamento à
  Administração, nunca resposta aproximada.
- **Códigos, nunca frases.** O texto ao munícipe vem de canned response e do
  léxico, não do Gateway.
- **Proveniência obrigatória.** Nenhum `AVAILABLE` sem `source_id` e `entry_id`;
  nenhum campo de canned fora de `AVAILABLE`.
- **Três barreiras antes de escrever:** schema fechado da tool, segunda
  validação em `registrarFato`, validação do próprio caso.
- **`release_id` derivado de conteúdo** — catálogo oficial mais os cinco de
  domínio. Conhecimento diferente nunca compartilha cache.
- **Segredos** só via secret de CI: nunca em arquivo, log, argv ou URL.

## 8. Providers e resultados comprovados

| Provider | Estado | O que ficou provado |
| --- | --- | --- |
| NVIDIA `nvidia/llama-3.3-nemotron-super-49b-v1.5` | **funciona** | tool calling no contrato de zero argumentos, escolha autônoma da tool, structured output com `/no_think`, uma conversa C1 completa ponta a ponta |
| Gemini | **histórico da chave usada na POC/baseline** | com **aquela** chave: `2.5-pro` e `2.5-flash-lite` responderam `404 no longer available to new users`; `2.5-flash` (5 req/min) não concluiu o start em 45 min; `3.7-flash` (20 req/min) com `429` persistente |
| Embeddings | **locais** | `jinaai/jina-embeddings-v2-base-en`, 768 dims, zero chamada externa |

> **A linha do Gemini é registro histórico, não veredito sobre o provider.** Os
> `404` e `429` acima descrevem uma chave específica e as execuções daquela POC,
> e **não** afirmam nada sobre qualquer chave futura, sobre outro projeto ou
> sobre o estado atual do provider. A fonte canônica é
> `docs/evidencia/parlant-poc/POC-README.md`, que registra o diagnóstico: a
> integração estava ligada — autenticação ok, modelo resolvido, tools
> registradas — e o que faltava era cota. O mesmo documento observa que o start
> passa a concluir em outro dia/projeto ou com chave paga. **Reavaliar com
> medição própria antes de decidir qualquer coisa sobre Gemini.**

> O perfil de chamadas da C1 (103 chamadas, 232,93 s de inicialização) **não é
> referência de produção**: runner efêmero, cold start completo, agente
> construído do zero, sem cache de release. A medição válida é cold start ×
> warm request em runtime persistente, e ainda não foi feita.

## 9. Pendências

| Pendência | Natureza |
| --- | --- |
| `static` do PR #22 | bloqueado por cota de Actions até 01/09/2026 |
| Tag `poc/exumacao-fase4a` → `714f0fed21d56f9cb7317ba8c9c810029f58376a` | push retorna HTTP 403; pendência externa, **não contornar** |
| `main` tecnicamente desprotegida | política operacional de 8 regras em vigor |
| R2, R3 e R4 | contratados, **não instrumentados** — depende de execução autorizada com modelo |
| Léxico de apresentação (R5) e `pergunta_pendente` (R6) | camada de atendimento, ainda não portada |
| Três workflows órfãos inertes | podem ser desativados quando convier |

> **Não apagar** as branches `lab/parlant-poc` e
> `claude/parlant-poc-gemini-bjab09`: enquanto a tag não puder ser publicada,
> elas são os únicos ponteiros para a baseline `714f0fe`.

## 10. Decisões humanas necessárias

| Decisão | O que bloqueia |
| --- | --- |
| **`MAP_MODALIDADE_TARIFARIA`** | a jornada de preço terminar em valor. Hoje `PENDENTE_DE_DECISAO_HUMANA` |
| **`MAP_VIGENCIA_TABELA_TARIFARIA`** | `07_01_2026` foi lido como dd_mm_aaaa; a leitura mm_dd_aaaa daria outra data. Nenhuma das duas está declarada na fonte |
| Fonte oficial para 6 tipos sem entradas | `DOCUMENTOS`, `PRAZO`, `PROCEDIMENTO_ADMINISTRATIVO`, `TRANSPORTE`, `REGULARIDADE_DO_JAZIGO`, `SEMI_INTACTO` |
| Plano/organização do GitHub | proteção técnica real de `main` |

As duas primeiras estão declaradas em `mapeamentos_pendentes`, dentro do próprio
catálogo oficial.

## 11. O que o LLM nunca infere

```
OSSUARIO -> EXUMACAO_DE_OSSUARIO     PROIBIDO
```

"Exumação de ossuário" é a exumação **feita num** ossuário.
`transport_destination = OSSUARIO` é o destino **para onde** os restos vão. São
coisas diferentes, e ligá-las exige decisão autoritativa humana.

Também proibido ao LLM: escolher tarifa · escolher `source_id` · decidir
aplicabilidade · traduzir código sem entrada no léxico · estimar prazo · listar
documento por conta própria · afirmar valor que não veio de tool.

> **Preço certo aplicado ao caso errado continua sendo erro.**

## 12. Critérios de merge

- PR obrigatório; sem push direto em `main`; sem merge automático.
- **`static` PASS obrigatório.** Teste local não substitui.
- Nenhum vetor alterado.
- `release_id` = `exu-1.0-32cc48f26797`.
- 47/47 nas duas implementações, com saída idêntica.

## 13. Próximo passo exato

Quando o GitHub Actions voltar:

```
1. confirmar HEAD do PR #22
2. se == 2daeaca947472d92831796c8fb42e5f7be6295ca
3. reexecutar o static
4. somente PASS autoriza merge
5. merge do PR #22
6. encerrar a Fase 3
7. então iniciar a Fase 4 (escopo a definir)
```

Se o HEAD tiver mudado: **PARAR e reavaliar.** Não reexecutar às cegas, e não
tratar o resultado como válido para outro commit.

## 14. Validação antes de trabalhar

Rodar antes de qualquer alteração:

```
git rev-parse origin/main
  -> 119c14f0fcdf30e269d3f74c2bec4e6efaaa23ac

python3 referencia/runner/executar_vetores.py
  -> CASOS: 47  PASS: 47  FAIL: 0  INVALIDO: 0

deno run --allow-env --allow-read --allow-write --allow-sys \
  santana-authority-gateway/conformidade/executar_vetores.ts
  -> CASOS: 47  PASS: 47  FAIL: 0  INVALIDO: 0

python3 conformidade/comparar.py \
  --relatorio referencia=… --relatorio ts=… --despejo referencia=… --despejo ts=…
  -> CONFORMIDADE: IDENTICA

sha256sum santana-authority/catalogo/exumacao.v1.json
  -> 22e1e1f0f03e5c1d77ee437fa5dfcd5f23502cc31a3bb575cb6a8dc56cd03f51
```

Três armadilhas de ambiente, todas encontradas na prática:

- **Deno 2.1.4** (versão pinada pela CI) vem do **GitHub Releases**;
  `deno.land` retorna 403 através do proxy.
- O repositório **não tem nenhuma dependência externa**. `jsr.io` e o registro
  npm estão bloqueados. **Não introduzir import externo.**
- **Teste local não substitui o `static`.** Ele antecipa o resultado; a
  confirmação só existe quando o Actions executa.

## 15. Erros cometidos e corrigidos

Listados porque um agente novo repetiria pelo menos dois deles.

| Erro | Consequência | Correção | Evidência |
| --- | --- | --- | --- |
| `or` falsy no leitor de eventos da POC | `{}` virou `null`; a evidência da C1 registrou a causa errada | leitura explícita da chave, sem depender de veracidade | adendo em `CORRECAO-C1.md`; vetor V12-A |
| Modelo escolhido por nome e reputação | 3 chamadas gastas em 404 "not found for account" | descoberta por tentativa controlada, em ordem fixa decidida por humano | Fase 1A |
| `retries: 0` literal no relatório | número falso publicado como se fosse medição | reportar só o que o contador pode afirmar, com o método declarado | `CORRECAO-C1.md`, desvio A |
| Índice do contador derivado de `len()` | 13 chamadas com o mesmo índice; o teto podia ser furado por concorrência | reserva de índice sob o mesmo lock da verificação | `CORRECAO-C1.md`, desvio E |
| `finalistas[0]` no desempate do Gateway | duas implementações corretas devolveriam `entry_id` diferente e o porte reprovaria | desempate por menor `entry_id` em code point | vetores V01-C e V01-D, mais teste de mutação |
| Catálogo oficial dentro de `referencia/` | a fonte autoritativa passava a morar dentro de uma implementação | movido para `santana-authority/`, caminho neutro | PR #21 |
| Teste de cópia única casando por **nome** de arquivo | reprovou o perfil de conformidade, que é legítimo | identificação de catálogo por **conteúdo**, não por nome | Fase 3, divergência 1 |

O padrão que se repete: **o erro quase nunca estava onde parecia.** Em três dos
sete casos o defeito era do instrumento de medição, não do que estava sendo
medido — e aceitar a primeira leitura teria congelado uma conclusão errada.
