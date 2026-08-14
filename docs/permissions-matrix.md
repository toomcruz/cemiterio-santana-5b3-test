# Matriz de privilégios vNext

| Papel | Schema | Tabelas | SELECT/INSERT/UPDATE/DELETE | RPC EXECUTE |
|---|---|---|---|---|
| `anon`, `authenticated`, `PUBLIC` | nenhum | nenhuma | nenhum | nenhum |
| `service_role` (runtime Edge) | `USAGE` | nenhum direto | nenhum | resolver sessão, regras, decisão, auditoria, comparação, confirmação, proposta/confirm/status, renderer, flags, inatividade |
| `support_vnext_runtime` | `USAGE` | nenhum direto | nenhum | reservado; não recebe grant nesta entrega |
| `support_vnext_publisher` | `USAGE` | nenhum direto | nenhum | refresh hash, publicar, revogar/superar; concedido somente pelo template `database/install/010_provision_operational_roles.sql` a uma identidade administrativa existente |
| `support_vnext_auditor` | `USAGE` | nenhum direto | nenhum | nenhum nesta entrega; leitura deve vir por procedimento futuro específico |
| `support_vnext_admin` | `USAGE` | nenhum direto | nenhum | nenhum nesta entrega |

As funções críticas são `SECURITY DEFINER`, com `search_path` explícito; `PUBLIC` perde EXECUTE antes dos grants específicos. As roles são `NOLOGIN`. A identidade administrativa só recebe `SET ROLE support_vnext_publisher` por grant explícito e documentado, nunca por `service_role`, `anon` ou `authenticated`.
# C4 operating identity

| Identidade | Login | Tabelas vNext | RPCs permitidas | Finalidade |
|---|---:|---|---|---|
| `service_role` (Edge interna) | configurada fora do pacote | sem DML direto | inbound/classificação/autorização/CONFIRM novos, renderer, estado shadow | runtime SHADOW_ONLY |
| `support_vnext_runtime` | NOLOGIN | nenhum | nenhum diretamente; capability documental | nunca publicar |
| `support_vnext_publisher` | NOLOGIN | nenhum DML direto | `publish_ruleset_release`, `transition_ruleset_release` | capability concedida por membership de identidade administrativa externa |
| `support_vnext_auditor` | NOLOGIN | leitura somente conforme política de implantação | nenhuma mutação | auditoria |
| administrador técnico | identidade de implantação controlada | migrations/ownership | manutenção fora do runtime | não é canal de atendimento |

O pacote não cria usuário de publicação. O template `database/install/010_provision_operational_roles.sql` valida antes do `GRANT` que a identidade externa existe, possui `LOGIN`, `NOINHERIT` e não é `SUPERUSER`. Se qualquer requisito falhar, o script aborta sem conceder membership. Depois do `GRANT`, o operador deve executar `SET ROLE support_vnext_publisher`, publicar, e executar `RESET ROLE`; a capacidade não é herdada implicitamente. A revogação é feita por `database/install/011_revoke_operational_roles.sql`. O procedimento completo está em `docs/isolated-installation.md`.
