# Relatório de segurança — Fase 5B.1

## Controles implementados no pacote

- Schema novo `support_vnext_shadow`, sem `ALTER`, `DROP`, `UPDATE` ou consulta runtime a tabelas legadas `service_*`.
- RLS habilitado em todas as tabelas novas; `anon`, `authenticated` e `public` não recebem acesso. O acesso é de servidor por `service_role`.
- Endpoints exigem chave interna e tripla barreira de modo/flags antes do processamento.
- Releases publicadas e seu conteúdo recebem triggers de imutabilidade. Mudança de release em sessão só ocorre pela RPC explícita de revogação `EXPLICIT_REBIND` e é auditada.
- Proposta de solicitação, hash, vínculo sessão/tópico/release e versões esperadas ficam imutáveis. A criação trava confirmação/tópico/sessão e é idempotente.
- Protocolo é emitido somente após a inserção da solicitação na mesma transação; não é exposto antes do sucesso transacional.
- Reclamação bloqueia gravidade, setor/setor atribuído, Ouvidoria e e-mail externo no contrato, motor e constraint de banco.
- `A_CONFIRMAR` proíbe fatos e fluxos administrativos; não há fallback legado.
- Auditoria grava metadados redigidos e hash opcional de payload, não mensagem, anexo, número de telefone, credencial ou cadeia de pensamento.
- Gemini é opcional, via gateway interno a definir, sem acesso a credenciais de banco. Ele não pode gerar preços, documentos, prazos, SLA, horários, protocolo ou links; saída suspeita é recusada.
- Worker de inatividade não contém chamada W-API. O aviso é apenas sinal `WARNING_WOULD_SEND`; o fechamento é silencioso.

## Riscos que continuam exigindo revisão humana

- RLS baseada em `service_role` requer controle rigoroso dos secrets de Edge Functions.
- `pgcrypto` deve ser confirmado no projeto isolado antes de aplicar migration.
- O modelo/gateway Gemini ainda não possui contrato de fornecedor configurado; ele permanece desligado.
- Funções transacionais precisam de teste real de concorrência no PostgreSQL isolado.
- A futura ponte n8n deve autenticar chamadas, limitar taxa e nunca encaminhar corpo completo de mensagem a logs shadow.

## Achados bloqueadores para produção

Não há bloqueador arquitetural adicional, mas há bloqueadores de aplicação: revisão SQL, testes de concorrência, definição de gateway Gemini, configuração segura de flags/secrets e validação de releases oficiais.
