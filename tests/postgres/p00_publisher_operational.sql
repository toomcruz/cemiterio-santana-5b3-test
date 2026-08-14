\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
do $$ begin
  if to_regrole('p00_publisher_operator') is null then create role p00_publisher_operator login noinherit nosuperuser; end if;
  if to_regrole('p00_unprivileged_operator') is null then create role p00_unprivileged_operator login noinherit nosuperuser; end if;
  if to_regrole('p00_inherit_operator') is null then create role p00_inherit_operator login inherit nosuperuser; end if;
end $$;
select pg_temp.assert_true((select rolcanlogin and not rolinherit and not rolsuper from pg_roles where rolname='p00_publisher_operator'),'PUB-10 operator is LOGIN NOINHERIT NOSUPERUSER');
select pg_temp.expect_error($q$do $$declare r pg_roles; begin select * into r from pg_roles where rolname='p00_inherit_operator'; if r.rolinherit then raise exception 'publisher provisioning requires NOINHERIT' using errcode='42501'; end if; end$$;$q$,'42501');
select pg_temp.assert_true((select rolinherit from pg_roles where rolname='p00_inherit_operator'),'PUB-08 INHERIT identity is rejected by provisioning precondition');
select pg_temp.assert_true(not has_function_privilege('service_role','support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-01 service_role cannot publish');
select pg_temp.assert_true(not has_function_privilege('p00_unprivileged_operator','support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-02 role without membership cannot publish');
grant support_vnext_publisher to p00_publisher_operator;
select pg_temp.assert_true(pg_has_role('p00_publisher_operator','support_vnext_publisher','member'),'PUB-03 membership attached to external identity');
select pg_temp.assert_true(not has_table_privilege('p00_publisher_operator','support_vnext_shadow.service_requests','INSERT,UPDATE,DELETE'),'PUB-04 publisher has no request DML');
select pg_temp.assert_true(not has_function_privilege('p00_publisher_operator','support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)','EXECUTE'),'PUB-05 publisher cannot confirm');
select pg_temp.assert_true(not has_function_privilege('support_vnext_auditor','support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-06 auditor cannot publish');
grant p00_publisher_operator to current_user;
SET ROLE p00_publisher_operator;
select pg_temp.assert_true(current_user='p00_publisher_operator' and not has_function_privilege(current_user,'support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-11 NOINHERIT operator has no implicit capability');
SET ROLE support_vnext_publisher;
select pg_temp.assert_true(current_user='support_vnext_publisher' and has_function_privilege(current_user,'support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-10 SET ROLE activates publisher capability');
RESET ROLE;
select pg_temp.assert_true(current_user='p00_publisher_operator' and not has_function_privilege(current_user,'support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-12 RESET ROLE deactivates capability');
revoke support_vnext_publisher from p00_publisher_operator;
select pg_temp.assert_true(not has_function_privilege('p00_publisher_operator','support_vnext_shadow.publish_ruleset_release(uuid,text)','EXECUTE'),'PUB-07 revoked membership removes publication privilege');
select pg_temp.assert_true(not pg_has_role('p00_publisher_operator','support_vnext_publisher','member'),'PUB-13 REVOKE removes membership');
select pg_temp.expect_error('set role support_vnext_publisher','42501');
RESET ROLE;
revoke p00_publisher_operator from current_user;
select pg_temp.assert_true(not pg_has_role('p00_unprivileged_operator','support_vnext_publisher','set'),'PUB-09 unprivileged NOINHERIT cannot SET ROLE');
drop role p00_publisher_operator;
drop role p00_unprivileged_operator;
drop role p00_inherit_operator;
rollback;
