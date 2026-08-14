-- C4-R5E installation template. Run only with psql against the isolated project.
-- This is intentionally NOT a migration: it grants a capability to an existing,
-- controlled LOGIN role and never creates a login, password, or credential.
-- Example:
--   psql "$ISOLATED_DATABASE_URL" -v installation_admin_role='isolated_release_operator' \
--     -f database/install/010_provision_operational_roles.sql
\set ON_ERROR_STOP on
\if :{?installation_admin_role}
\else
  \echo 'installation_admin_role is required; no grant was applied'
  \quit
\endif

begin;
select set_config('support_vnext_shadow.installation_admin_role', :'installation_admin_role', true);
do $$
declare r pg_roles;
begin
  select * into r from pg_roles where rolname=current_setting('support_vnext_shadow.installation_admin_role', true);
  if not found then
    raise exception 'installation_admin_role does not exist' using errcode = '22023';
  end if;
  if r.rolname in ('service_role', 'anon', 'authenticated') then
    raise exception 'runtime/public roles cannot receive publisher capability' using errcode = '42501';
  end if;
  if not r.rolcanlogin then
    raise exception 'installation_admin_role must be a LOGIN identity' using errcode = '42501';
  end if;
  if r.rolinherit then
    raise exception 'installation_admin_role must be NOINHERIT; use SET ROLE explicitly' using errcode = '42501';
  end if;
  if r.rolsuper then
    raise exception 'installation_admin_role must not be SUPERUSER' using errcode = '42501';
  end if;
end $$;
select format('grant support_vnext_publisher to %I', :'installation_admin_role')\gexec
commit;

-- The recipient must explicitly SET ROLE support_vnext_publisher. The capability
-- role is NOLOGIN/NOINHERIT and has no direct table DML.
