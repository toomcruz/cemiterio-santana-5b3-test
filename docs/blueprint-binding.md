# Especificação vinculante

Implementação vinculada a `Blueprint_Tecnico_Fase_5A_Santana.md`, revisado nesta etapa. Nenhuma decisão de arquitetura foi alterada pelo pacote.

Correções incorporadas:

- `support_conversations.automation_mode`: somente `BOT_ACTIVE` e `HUMAN_ACTIVE`.
- Estado de sessão: `ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED` em `conversation_sessions.status`.
- `service_*`: fonte histórica somente leitura para auditoria, comparação e carga controlada de rascunhos; proibida como fallback runtime.
- `MODEL_EVIDENCE_SUMMARY`: resumo redigido e auditável; nenhum campo de cadeia de pensamento.
- `A_CONFIRMAR`: não pode resolver preço, prazo, SLA ou documento obrigatório; não pode construir proposta administrativa nem consultar legado.

Qualquer alteração nesses limites exige uma revisão posterior do blueprint, não uma alteração local silenciosa.

## Fase 4C / R8 — Sessão × processo (G11)

- Garantia: `SESSION CLOSED != PROCESS CLOSED`.
- Ciclo de sessão inalterado: `ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED`.
- Vínculo **unidirecional**: `ConversationState.last_touched_session_id` → sessão.
- Sessão **não** é dona do processo; fechar sessão não muta `cases` / `facts` /
  `solicitacoes` / documentos futuros.
- Política 3+2 permanece; worker/timers **fora** desta subfase.
- Contrato: `contracts/r8-sessao-processo.ts` · docs: `docs/fase4/R8-SESSAO-PROCESSO.md`.

## Fase 4D / R9 — Reclassificação (G17, G03, G16)

- Evento aditivo `RECLASSIFICATION` (não reusa NEW_GOAL/CORRECTION/CHANGE_OF_MIND/UNCERTAIN).
- Tópico explícito: `current_topic` / `origin_topic`.
- G16: primeira mensagem específica vence menu genérico (`runtime/interpreter/first_message.ts`).
- Divergência inventário G03→R8 vs seção 4D→R9: seção específica 4D vigente.
- Contrato: `contracts/r9-reclassificacao.ts` · docs: `docs/fase4/R9-RECLASSIFICACAO.md`.
