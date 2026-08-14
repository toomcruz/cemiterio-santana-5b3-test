-- C4-R5E operational rollback. Keep data/audit evidence; disable every vNext path.
-- Run only in an isolated project with an installation administrator.
begin;

update support_vnext_shadow.feature_flags
   set default_mode = 'OFF',
       kill_switch = true,
       updated_at = now(),
       updated_by = 'C4-R5E-OPERATIONAL-ROLLBACK';

revoke all on all functions in schema support_vnext_shadow
  from public, anon, authenticated, service_role, support_vnext_runtime,
       support_vnext_publisher, support_vnext_auditor, support_vnext_admin;
revoke usage on schema support_vnext_shadow
  from public, anon, authenticated, service_role, support_vnext_runtime,
       support_vnext_publisher, support_vnext_auditor, support_vnext_admin;

-- No legacy capability, endpoint, or fallback is enabled by this rollback.
commit;
