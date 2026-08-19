# Contratos definitivos da Fase 2 — R1 a R6

```
STATUS: APROVADO COM AJUSTES (decisao do mantenedor) e IMPLEMENTADO onde offline.
```

Estes contratos valem antes do Gateway TS/Deno e independem de linguagem.
Regra que atravessa todos: **o LLM não pode ser autoridade administrativa.**

---

## R1 — Contrato canônico de argumentos

### Achado que resolveu a questão

O `null` registrado na C1 **não veio do modelo nem do Parlant**. Veio do leitor
de eventos da POC, em `turnos.py`:

```python
"argumentos": chamada.get("arguments") or chamada.get("args"),
```

`{}` é falsy em Python. Com `arguments == {}` o `or` cai para `args`, que não
existe no evento, e o resultado vira `None`.

Três fatos do Parlant 3.3.2 sustentam que o valor no fio era `{}`:
`ToolCall.arguments` é `Mapping[str, JSONSerializable]` (o tipo não admite
`None`); `validate_tool_arguments` levanta `ToolExecutionError` para chave extra
numa tool com `parameters={}`; a assinatura real das tools de consulta tem só
`context`.

### Contrato

**Forma canônica de uma tool de zero argumentos: `{}`.**

```
AUSÊNCIA -> a chave não aparece
VAZIO    -> o valor vazio do tipo ({} para mapa, [] para lista)
null     -> não existe na forma canônica
```

**A normalização de ausente/`null` para `{}` vale somente para tools cujo
contrato declara zero argumentos.** Para tools com parâmetros, ausência é
tratada pelo schema específico e **nenhum valor é criado em silêncio**:
obrigatório ausente é recusa, não default.

| Camada | Política |
| --- | --- |
| modelo → ToolCaller | fora de contrato; observamos |
| ToolCaller → tool | Parlant já recusa chave extra — barreira provada |
| evento → telemetria | **normaliza** conforme o contrato da tool |
| adaptador → Gateway | **recusa** o que viola o contrato |

Recusa ⇒ `NOT_AVAILABLE` + `motivo: ARGUMENTOS_NAO_CANONICOS` +
`encaminhar_administracao: true`. Falha fechada: a consulta não acontece. Não se
limpa o argumento e segue.

**O valor bruto do evento é preservado literalmente**, inclusive quando a
canonização falha — a auditoria precisa do que chegou, não do que deveria ter
chegado.

Implementado em `referencia/santana_referencia/argumentos.py` e
`gateway.consultar_via_tool()`. Provado por **V12** (12 casos).

---

## R2 — Retries e HTTP 429

1. **O retry da biblioteca não é desligado.** Desligar exigiria patch em código
   de terceiro; `emcie-co/parlant` é referência, não fork. Retry passa a ser
   declarado e orçado.
2. **Métricas autoritativas** — e só estas duas:

```
tentativas reais observadas pelo wrapper   AUTORITATIVA
ocorrencias 429 observadas                 AUTORITATIVA
retries inferidos por fingerprint          DIAGNOSTICO — nunca valor exato
```

   O fingerprint (`sha256(model ‖ messages ‖ tools ‖ response_format)`) pode
   existir como diagnóstico, mas **não** é fonte autoritativa: duas operações
   legítimas idênticas produzem o mesmo fingerprint. Todo relatório que exibir
   retries inferidos declara `metodo: fingerprint` e `natureza: estimativa`.
3. **Orçamento conta tentativas, não operações** — inclusive as da biblioteca.
4. **Disjuntor:** 3 ocorrências de 429 dentro do turno ⇒ aborta com desfecho
   controlado. 429 em sequência não vira resposta melhor, vira espera.
5. **401 e 403 seguem fail-fast**, sem retry e sem disjuntor.
6. **Fail-closed:** falha de LLM (429, timeout, teto) ⇒ `FALHA_DE_ATENDIMENTO`
   ⇒ canned controlada. Nunca resposta parcial, nunca valor, documento, prazo
   ou procedimento.

**O Gateway é determinístico e não chama modelo. Um 429 pode atrasar ou impedir
uma resposta; não pode alterar nenhuma resposta autoritativa.**

Contrato definido; instrumentação é execução, e execução depende de autorização.

---

## R3 — Orçamento de chamadas de IA por turno

| Teto | Valor | Escopo | Ao estourar |
| --- | --- | --- | --- |
| `TETO_TURNO` | 25 tentativas | turno | aborta o turno, canned controlada |
| `TETO_SESSAO` | 120 tentativas | sessão | encerra para a Administração |
| `TETO_INICIALIZACAO` | 120 tentativas | só no build (R4) | falha o build |

```
25 = HARD SAFETY CAP contra runaway.
25 NAO e orcamento aceitavel de producao e nao deve ser citado como tal.
A meta operacional sera definida na Fase 6, apos medicao em runtime
persistente, e tem de ser INFERIOR ao teto.
```

**Enforcement por reserva sob lock** — já corrigido em
`ContadorDeChamadas.proxima()`, e é a única forma aceita: verificação do teto
dentro do mesmo lock da reserva.

**Atribuição obrigatória por componente.** `get_schematic_generator(t, hints)`
conhece `t`; vinculando `t.__name__` ao shim daquele gerador, cada tentativa
fica atribuível (matcher, tool caller, compositor). É o que transforma "17" de
número a reduzir em distribuição a explicar. Sem atribuição, qualquer redução é
chute.

**Nenhum teto pode ser afrouxado para um teste passar.** Estouro é resultado
válido do teste.

---

## R4 — Inicialização × atendimento

| | `INICIALIZACAO` | `ATENDIMENTO` |
| --- | --- | --- |
| Quando | passo de build, por release | por turno |
| Munícipe esperando | não | sim |
| Chamadas de IA em produção | **zero** | orçadas pelo R3 |
| Falha | falha o build | canned controlada |

**Regra dura:** nenhum turno de munícipe paga custo de inicialização. O processo
só aceita sessão depois de `PRONTO`, e `PRONTO` é por release.

**O artefato de release é produzido pelo build; o boot carrega.** Ausente ou
incompatível ⇒ **falha fechada**. Re-derivar em silêncio com 86 chamadas ao vivo
é o que torna custo e latência imprevisíveis.

**A chave de cache não é o `release_id`.** Ele cobre o conteúdo, não quem
avaliou o conteúdo:

```
runtime_fingerprint = sha256(parlant_version ‖ nlp_model_id ‖ embedder_id)
chave_do_artefato   = release_id ‖ runtime_fingerprint
```

`release_id` continua identificando **o conhecimento** — é o que aparece em log
e em resposta autoritativa, e é o que os vetores comparam. `runtime_fingerprint`
identifica **o avaliador** e só participa da chave de cache. Consequência
aceita: trocar de modelo exige rebuild do artefato.

---

## R5 — Contexto interno → linguagem do munícipe

1. **Código nunca é texto.** `contexto_faltante`, `opcoes_por_campo`, `motivo` e
   `entradas_em_conflito` são códigos. Escrito no contrato, não subentendido.
2. **Léxico de apresentação**, artefato versionado que entra no `release_id`:
   `(tipo_informacao, campo, valor?) -> texto aprovado`.
3. **Falha fechada de léxico.** Código sem entrada não pode ser renderizado por
   improviso: cai em canned genérica ou encaminha. Deixar o modelo traduzir um
   código é deixá-lo ser autoridade sobre vocabulário oficial.
4. **Mão única:**

```
PERMITIDO : codigo -> texto     (apresentacao)
PROIBIDO  : texto  -> codigo    (inferencia de aplicabilidade)
```

Renderizar `EXUMACAO_DE_OSSUARIO` é apresentação. Concluir que "vai para o
ossuário" significa `modalidade_tarifaria = EXUMACAO_DE_OSSUARIO` é inferência,
e continua bloqueada por `MAP_MODALIDADE_TARIFARIA`. Sem esta cláusula o léxico
vira, por acidente, o mapeamento que a decisão humana não autorizou.

**O R5 melhora a pergunta; não destrava o preço.** Com léxico e sem mapeamento
aprovado, a jornada de preço termina em encaminhamento à Administração.

---

## R6 — Perguntar somente o contexto necessário

1. **Uma única pergunta pendente por turno:**
   `pergunta_pendente = { campo, opcoes, origem }`,
   `origem ∈ { DESAMBIGUACAO_GATEWAY, PROXIMA_PERGUNTA_DO_DOMINIO }`.
2. **Precedência fixa:** `DESAMBIGUACAO_GATEWAY > PROXIMA_PERGUNTA_DO_DOMINIO`.
3. **Com vários campos faltantes, pergunta-se o PRIMEIRO de `contexto_faltante`**
   — a lista é ordenada deterministicamente, e é por isso que a ordem do V2 tem
   função: ela é a ordem de perguntar.
4. **`opcoes_por_campo`** substitui a lista plana `opcoes_possiveis`. Com dois
   campos faltantes a lista plana não dizia a qual campo cada opção pertencia, e
   perguntar um campo por vez com as opções do outro misturadas seria pedir ao
   munícipe que escolhesse numa lista que não é a dele.
5. **Enforcement por composição (STRICT)**, não por prompt.
6. **Guarda detectora** `perguntas_na_resposta`, com limite declarado: contar
   "?" é heurística. STRICT é o enforcement; a guarda cobre quando a composição
   não for STRICT.

Itens 3, 4 e 5 do contrato estão implementados no Gateway e provados por **V2**.
Os itens 1, 2 e 6 vivem na camada de atendimento, que ainda não foi portada.
