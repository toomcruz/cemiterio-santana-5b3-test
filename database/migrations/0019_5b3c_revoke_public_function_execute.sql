-- 5B.3-C: PostgreSQL grants EXECUTE to PUBLIC by default on every new function.
-- Migrations 0011/0013/0014 created (or recreated) validator, guard and helper
-- functions after the last blanket revoke, so PUBLIC kept EXECUTE on them,
-- violating the P15 privilege matrix. Revoke PUBLIC once more, at the end of the
-- migration chain, so it also covers 0015-0018. Role-specific grants live in
-- separate ACL entries and are not affected by revoking from PUBLIC.
begin;

revoke all on all functions in schema support_vnext_shadow from public;
revoke all on all routines in schema support_vnext_shadow from public;

do $$
declare leftover text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into leftover
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'support_vnext_shadow'
     and has_function_privilege('public', p.oid, 'EXECUTE');
  if leftover is not null then
    raise exception 'PUBLIC still holds EXECUTE on: %', leftover using errcode='55000';
  end if;
end $$;

commit;
