-- C4-R5E revocation template. Run only with psql against the isolated project.
-- Example:
--   psql "$ISOLATED_DATABASE_URL" -v installation_admin_role='isolated_release_operator' \
--     -f database/install/011_revoke_operational_roles.sql
\set ON_ERROR_STOP on
\if :{?installation_admin_role}
\else
  \echo 'installation_admin_role is required; no revoke was applied'
  \quit
\endif

begin;
select set_config('support_vnext_shadow.installation_admin_role', :'installation_admin_role', true);
do $$
begin
  if to_regrole(current_setting('support_vnext_shadow.installation_admin_role', true)) is null then
    raise exception 'installation_admin_role does not exist' using errcode = '22023';
  end if;
end $$;
select format('revoke support_vnext_publisher from %I', :'installation_admin_role')
\gexec
commit;
