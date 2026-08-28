# R9 — Reclassificação (Fase 4D)

**Gaps:** `G17`, `G03`, `G16`  
**Contrato:** R9  
**Pré-condição:** 4C PASS  
**release_id:** `exu-1.0-32cc48f26797` (inalterado)

## Divergência R8/R9 (ETAPA 0)

Registrada, **não** corrigida silenciosamente na documentação histórica:

| Fonte | Mapeamento |
|-------|------------|
| Inventário geral de gaps | G03 → contrato **R8** |
| Seção específica **FASE 4C** | **R8** = Sessão × processo (G11) |
| Seção específica **FASE 4D** | **novo R9 — Reclassificação** |

**Resolução vigente:** a seção específica da 4D prevalece → **R9** para esta fase.  
Não há evidência conflitante posterior no handoff que reverta isso.

## Objetivo

1. Armazenar o tópico no estado (`current_topic`, `origin_topic`).
2. Operação explícita de reclassificação **sem** perda de contexto.
3. Precedência da primeira mensagem sobre menu genérico (G16).

## Evento `RECLASSIFICATION`

Aditivo. **Não** reutiliza `NEW_GOAL`, `CORRECTION`, `CHANGE_OF_MIND`, `UNCERTAIN`.

```
RECLASSIFICATION
  descricao   A mesma demanda passa a ser reconhecida como outro topico.
  efeitos     update_topic(goal_atual)
              preserve_facts
              preserve_documents
              record_origin_topic
  proibido    create_case
              supersede_fact
              reset_goal
  invariante  nenhum fact muda de status por efeito deste evento
```

## G17 — tópico no estado

Campos aditivos em `ConversationState` / `state.schema.json`:

- `current_topic` — tópico atual explícito
- `origin_topic` — tópico de origem após reclassificação (G03)

## G16 — primeira mensagem

Regra em `runtime/interpreter/first_message.ts` (`routeFirstMessage`):

- intenção segura + goal especializado → `SPECIALIZED` (**sem** menu genérico)
- ambígua/insuficiente → `DISAMBIGUATION` (menu permitido)
- mensagem específica **não** degrada para `OUTROS_ASSUNTOS` só porque o menu ainda não foi apresentado

## Documentos / R8

4E **não** iniciada. Documentos sintéticos usam só a superfície estrutural R8
(`documentos` no hash). Reclassificação **não** apaga/muta documentos.

## Fronteira

**Não** tocados: `exumacao.v1.json`, `facts.v1.json`, `goals.v1.json`,
`questions.v1.json`, `relations.v1.json`, `topics.v1.json`.

`conversation-events.v1.json` está **fora** da fronteira e recebe o event_kind aditivo.

## Artefatos

| Arquivo | Papel |
|---------|--------|
| `engine/engine.ts` | `current_topic`/`origin_topic` + handler `RECLASSIFICATION` |
| `engine/catalog.ts` | `EventKind` + `EventsDoc.forbidden?` |
| `conversation-events.v1.json` | evento aditivo |
| `state.schema.json` | campos de tópico + enum |
| `runtime/interpreter/first_message.ts` | G16 |
| `contracts/r9-reclassificacao.ts` | contrato |
| `tests/fase4/fase4d_reclassificacao_test.ts` | T08/T09/G16 |

## Gate PASS / FAIL

| | |
|---|---|
| **PASS** | OUTROS → tópico especializado preservando facts/docs/sols/case; origem registrada; 10 eventos com semântica intacta; `release_id` intacto |
| **FAIL** | fato/documento perdido; invariante de `NEW_GOAL` acionado; reuso semântico dos 4 eventos proibidos |
