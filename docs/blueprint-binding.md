# Especificação vinculante

Implementação vinculada a `Blueprint_Tecnico_Fase_5A_Santana.md`, revisado nesta etapa. Nenhuma decisão de arquitetura foi alterada pelo pacote.

Correções incorporadas:

- `support_conversations.automation_mode`: somente `BOT_ACTIVE` e `HUMAN_ACTIVE`.
- Estado de sessão: `ACTIVE → WARNING_PENDING → WARNING_SENT → CLOSED` em `conversation_sessions.status`.
- `service_*`: fonte histórica somente leitura para auditoria, comparação e carga controlada de rascunhos; proibida como fallback runtime.
- `MODEL_EVIDENCE_SUMMARY`: resumo redigido e auditável; nenhum campo de cadeia de pensamento.
- `A_CONFIRMAR`: não pode resolver preço, prazo, SLA ou documento obrigatório; não pode construir proposta administrativa nem consultar legado.

Qualquer alteração nesses limites exige uma revisão posterior do blueprint, não uma alteração local silenciosa.
