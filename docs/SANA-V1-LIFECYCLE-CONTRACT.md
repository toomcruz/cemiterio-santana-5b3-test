# Sana V1 — eventos, lifecycle e autoridade humana

Status: contrato LAB/shadow; não ativa timers nem altera o banco remoto.

## Fronteiras

- **Sessão:** `ACTIVE`, `WARNING_PENDING`, `WARNING_SENT`, `CLOSED`. Fechar a
  sessão não fecha processo, facts, documentos ou solicitações.
- **Goal/jornada:** `ACTIVE`, `WAITING`, `SUSPENDED`, `RESOLVED`, `ABANDONED`.
  `WAITING` e `SUSPENDED` não significam pessoa nova nem case novo.
- **Conversa/automação:** `BOT_ACTIVE` ou `HUMAN_ACTIVE`, projetados no banco
  como `bot`/`human`.
- **Binding de subject:** `ACTIVE`, `INVALIDATED` ou `REPLACED`. Binding
  invalidado não volta a ACTIVE; uma nova resolução cria outro `binding_id`.

## Transições governadas

### `FOCUS_CASE`

Receipt interno de foco, emitido somente quando:

1. `binding_id` é ACTIVE na mesma `conversation_id`;
2. o `case_id` pertence ao binding;
3. o `goal_id` pertence ao case;
4. o goal alvo já está `ACTIVE`;
5. a operação não cria case, pessoa, fact ou efeito externo.

O evento apenas torna explícito qual case/goal já autorizado recebe a mensagem.
Ele não ultrapassa `HUMAN_ACTIVE` e não reativa goal suspenso.

### `RESUME_CASE`

Receipt de retomada, emitido somente por comando de operador `RESUME` ou por
regra oficial de retorno já prevista no reducer:

1. operador autenticado e autorizado quando a origem é o painel;
2. `expected_control_version` confere com `support_conversations.updated_at`;
3. `expected_revision` e `catalog_hash` conferem;
4. o binding permanece ACTIVE e pertence à conversa;
5. o goal alvo está `WAITING` ou `SUSPENDED`;
6. a transação muda o goal alvo para `ACTIVE`, preserva facts e incrementa a
   revisão antes de qualquer entrega.

`RESUME_CASE` nunca reativa o bot enquanto `automation_mode <> 'bot'`. Um
takeover humano prevalece sobre qualquer intenção anterior do modelo.

## Regras de encerramento e reabertura

- `RESOLVED`/`ABANDONED` são estados de goal; não são prova de operação física
  concluída.
- `CLOSED` é estado de sessão/controle. Processo administrativo, documentos,
  receipts e solicitações permanecem preservados.
- Reabertura começa uma sessão nova ligada ao mesmo processo/case por referência
  autorizada; carrega somente contexto permitido e não reenvia backlog.
- Expiração/timer não é executada nesta fase. Qualquer timer futuro precisa
  invalidar geração/revisão antiga e passar novamente pela autoridade de modo.

## Entrega e falhas

- `turn_events` registra a decisão committed; `outbound_queue` registra o
  trabalho de entrega; `SENT` só é marcado após resposta positiva do provedor.
- Timeout após envio é resultado desconhecido: não há retry automático cego.
- O worker revalida conversa, modo humano/bot, revisão, geração e status do
  outbox antes de enviar.
- Falha Gemini, persistência ou outbox deixa o estado fail-closed e não anuncia
  ato administrativo concluído.

## Invariantes de integração

1. Estado, binding, receipt, evento e outbox entram na mesma transação de commit.
2. Replay idêntico retorna o commit anterior; payload divergente falha.
3. Uma mensagem não pode vincular receipt/evento a outra conversa.
4. Nenhum LLM é autoridade de fact, autorização, identidade ou handoff.
5. Sem commit/receipt, não há envio nem afirmação de conclusão.

