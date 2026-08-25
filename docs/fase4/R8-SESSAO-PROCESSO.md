# R8 — Sessão × processo (Fase 4C)

```
NATUREZA      CONTRATO DE DOMINIO (fora da fronteira do release_id)
BASE          docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4C
GAP           G11
GARANTIA      SESSION CLOSED != PROCESS CLOSED
RELEASE       exu-1.0-32cc48f26797 (inalterado)
```

## Objetivo

Declarar e testar a fronteira entre **sessão** (ciclo de atendimento/conexão) e
**processo** (cases, facts, documentos, solicitações), de modo que fechar a
sessão **não** altere nenhum byte dos objetos de processo.

## Componentes

| Artefato | Papel |
| -------- | ----- |
| `santana-conversation-domain/engine/sessao_processo.ts` | ciclo de sessão + hash/snapshot de processo + vínculo unidirecional |
| `santana-conversation-domain/state.schema.json` | `last_touched_session_id?` aditivo |
| `santana-conversation-domain/engine/engine.ts` | campo aditivo no `ConversationState` |
| `santana-conversation-domain/engine/persistence.ts` | âncora: sessão fora das ops de processo |
| `contracts/r8-sessao-processo.ts` | contrato R8 (reexport) |
| `santana-conversation-domain/tests/fase4/fase4c_sessao_processo_test.ts` | sobrevivência + negativos |

## Modelo

### Sessão (`conversation_sessions` conceitual)

```
ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED
```

- Política 3+2 **já existe**; **não** alterada nesta subfase.
- **Não** implementar worker/timers aqui.
- Sessão **não** declara ownership do processo (sem `case_ids`, `process_id`, etc.).

### Processo

- `cases`
- `facts`
- `solicitacoes` (4B / R7)
- `documentos` — **ainda não existem** (4E); a coleção futura já entra no
  snapshot/hash como `[]` para proteger regressão quando 4E chegar.

### Vínculo (unidirecional)

```
processo.last_touched_session_id  →  session_id
```

- O processo pode saber em qual sessão foi tocado.
- A sessão **não** é dona do processo.
- Fechar sessão **não** tem caminho para: encerrar case, limpar facts,
  limpar documentos, limpar solicitações, resolver/abandonar goals, resetar
  processo.

## Gate PASS

Fechar a sessão não altera nenhum byte de:

- cases
- facts
- documentos (coleção futura protegida)
- solicitacoes

`hash_antes == hash_depois` no teste de sobrevivência.

Nova sessão:

- recupera o mesmo processo;
- mantém identidades;
- rebind do vínculo unidirecional.

## Gate FAIL

Qualquer objeto de processo muda quando a sessão é fechada.

## Offline

Nenhuma transição de sessão chama rede (`fetch` = 0 no caminho testado).
Sem Supabase, n8n, W-API, WhatsApp, worker real.

## Autoridade

A sessão controla **somente** o ciclo de atendimento/conexão.

Ela **não** decide:

- estado administrativo da solicitação;
- estado do case;
- fatos;
- documentos;
- conclusão de processo.

Nenhuma nova fonte de autoridade. Sem enum global novo de status de processo.

## Dependência 4E

Documentos pertencem à Fase 4E. Em 4C:

- **não** implementar documentos antecipadamente;
- snapshot/hash já reserva `documentos: []`;
- qualquer mutação futura dessa coleção altera o hash (superfície protegida).

## Fronteira

Não toca:

- `exumacao.v1.json`
- `facts.v1.json` / `goals.v1.json` / `questions.v1.json` / `relations.v1.json` /
  `topics.v1.json`

`release_id` permanece `exu-1.0-32cc48f26797`.
