-- C4-R5E complete physical rollback for a disposable isolated installation.
-- It removes only the package schema/capability roles. It never touches auth,
-- service_*, Supabase schemas, pgcrypto, or any legacy object.
begin;

-- First eliminate all executable/granted vNext surfaces, including SECURITY DEFINER RPCs.
revoke all on all functions in schema support_vnext_shadow
  from public, anon, authenticated, service_role, support_vnext_runtime,
       support_vnext_publisher, support_vnext_auditor, support_vnext_admin;
revoke all on all tables in schema support_vnext_shadow
  from public, anon, authenticated, service_role, support_vnext_runtime,
       support_vnext_publisher, support_vnext_auditor, support_vnext_admin;
revoke all on schema support_vnext_shadow
  from public, anon, authenticated, service_role, support_vnext_runtime,
       support_vnext_publisher, support_vnext_auditor, support_vnext_admin;

-- support_vnext_shadow is wholly owned by this package. CASCADE removes all
-- tables, columns, constraints, indexes, triggers, policies, functions,
-- overloads, classifier_authorities, types, flags, and grants in it.
drop schema if exists support_vnext_shadow cascade;

-- Capability roles are package-only. Refuse to drop one that owns an object
-- outside the removed schema; do not drop an installation LOGIN role.
do $$
declare
  capability text;
  membership record;
begin
  foreach capability in array array[
    'support_vnext_runtime', 'support_vnext_publisher', 'support_vnext_auditor', 'support_vnext_admin'
  ] loop
    if to_regrole(capability) is null then
      continue;
    end if;
    if exists (
      select 1
      from pg_class c
      join pg_roles r on r.oid = c.relowner
      where r.rolname = capability
    ) or exists (
      select 1
      from pg_proc p
      join pg_roles r on r.oid = p.proowner
      where r.rolname = capability
    ) then
      raise exception 'physical rollback refused: capability role % owns external object', capability
        using errcode = '55000';
    end if;
    for membership in
      select member_role.rolname as member_name
      from pg_auth_members m
      join pg_roles capability_role on capability_role.oid = m.roleid
      join pg_roles member_role on member_role.oid = m.member
      where capability_role.rolname = capability
    loop
      execute format('revoke %I from %I', capability, membership.member_name);
    end loop;
    execute format('drop role %I', capability);
  end loop;
end $$;

-- Shared pgcrypto and every external schema/object remain intact.
commit;
