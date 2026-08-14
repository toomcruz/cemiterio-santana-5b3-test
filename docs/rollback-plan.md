# Rollback C4 — somente ambiente isolado após revisão

Há duas modalidades explícitas; não execute ambas como se fossem equivalentes.

## Rollback operacional: preservar evidência

Execute `database/rollback/0012_operational_off.sql` para colocar todas as flags em
`OFF`/kill switch e revogar `USAGE`/`EXECUTE` de runtime, publisher e auditor. Ele
preserva releases, classificações, autorizações, solicitações, protocolos e auditoria;
nenhum fallback para `service_*`, legado, n8n ou provedor externo é ativado.

## Rollback físico: instalação descartável

Execute `database/rollback/0012_full_physical_rollback.sql` somente quando a política
de retenção permitir eliminar todos os dados C4 no projeto isolado. O script remove a
superfície integral do schema vNext (RPCs, overloads, triggers, grants, RLS/policies,
classifier authority, flags, tabelas e tipos) e remove capability roles apenas após
preflight de ownership. Ele nunca remove login administrativo externo, `auth`,
`extensions.pgcrypto`, `service_*`, legado ou schema Supabase.

Valide em conexão nova com `tests/postgres/p00_rollback_surface.sql` usando
`-v rollback_phase=PRE` antes da modalidade escolhida, `-v rollback_phase=POST_OPERATIONAL`
após o operacional ou `-v rollback_phase=POST` após o físico. O teste não faz parte
de P01–P15.

O inventário cumulativo e a ordem de remoção estão em `docs/runtime-object-manifest.md`.
