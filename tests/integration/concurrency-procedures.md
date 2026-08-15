# Procedimentos de concorrência — executar somente após 5B.2 em Supabase isolado

## Dois “sim” concorrentes

1. Criar release, sessão, tópico, template e política de teste sem fatos oficiais.
2. Criar uma confirmação pendente por `propose_request_transaction`.
3. Em duas conexões independentes, chamar simultaneamente `confirm_request_transaction` com o mesmo `confirmation_id`,
   `confirmation_nonce` e idempotency key.
4. Esperado: uma resposta `CONFIRMED`, uma `ALREADY_CONFIRMED`, uma única linha em `service_requests`, um único
   protocolo e nonce `CONSUMED`.

## Confirmação após mudança de tópico

1. Criar confirmação pendente com versões de sessão/tópico conhecidas.
2. Em uma transação, incrementar `conversation_sessions.state_version` ou `conversation_topics.topic_version` como faria
   mudança de assunto.
3. Chamar confirmação anterior.
4. Esperado: `STATE_CONFLICT`, nenhuma nova solicitação e nenhum novo protocolo.

## Nova mensagem versus encerramento

1. Agendar inatividade em `t0`; processar WARNING em `t0+180s`.
2. Na primeira conexão, chamar `cancel_inactivity_transaction` em `t0+299s`.
3. Na segunda conexão, chamar `claim_due_inactivity_jobs` e `process_inactivity_job` do CLOSE em `t0+300s`.
4. Repetir invertendo a ordem de lock.
5. Esperado: se a nova mensagem obtiver lock primeiro, job fica `SKIPPED` pela geração divergente e sessão fica
   `ACTIVE`; se CLOSE obtiver lock primeiro, a mensagem posterior deve abrir sessão nova no adaptador de estado futuro.
   Nunca deve haver mensagem final de encerramento.

## Limite

Esses procedimentos não devem usar W-API, dados pessoais ou políticas factuais. Os resultados devem ser registrados como
evidência da Fase 5B.2.
