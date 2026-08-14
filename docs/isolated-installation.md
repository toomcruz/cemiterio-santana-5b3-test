# Instalação isolada e capability roles

Este pacote não cria identidades `LOGIN`, senhas, tokens ou credenciais. As roles
`support_vnext_publisher` e `support_vnext_auditor` são capabilities `NOLOGIN` e
`NOINHERIT`; elas não são contas operacionais.

## Publisher controlado

1. No projeto isolado, escolha uma identidade administrativa já existente e controlada.
2. Aplique migrations `0001` a `0012` e mantenha as flags em `OFF`/`SHADOW_ONLY`.
3. Execute, via `psql`, `database/install/010_provision_operational_roles.sql` com
   `-v installation_admin_role='<INSTALLATION_ADMIN_ROLE>'`.
4. A identidade entra explicitamente em `SET ROLE support_vnext_publisher` somente
   para `refresh_draft_release_content_hash`, `publish_ruleset_release` e
   `transition_ruleset_release`.
5. Para rotação ou desligamento, execute
   `database/install/011_revoke_operational_roles.sql` com a mesma variável e
   registre a mudança no procedimento de implantação.

Nunca conceda a capability a `service_role`, `anon` ou `authenticated`. O publisher
não recebe DML direto de conteúdo ou requests; as RPCs de publicação são
`SECURITY DEFINER` com `search_path` explícito e escrevem `release_audit_events` com
actor, timestamp, release e transição. O valor de `actor` é rótulo auditável da ação;
a identidade técnica é a sessão que assumiu a capability.

## Auditor

`support_vnext_auditor` continua sem mutação e sem publicação. Caso uma identidade
de auditoria precise de acesso, ela deve receber somente a superfície de leitura
explicitamente aprovada em uma etapa posterior; não reutilize publisher ou runtime.

## Estado de validação

Os scripts e testes PostgreSQL estão **prontos para execução**, mas não foram
executados neste pacote. CI estático verifica formato, lint, type-check e estrutura;
ele não substitui a validação PostgreSQL isolada da Fase 5B.3.
