\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
select pg_temp.publish_release('P02_SCOPE') as release_id \gset
select pg_temp.expect_error(format('update support_vnext_shadow.support_ruleset_release set change_summary=%L where release_id=%L','tampered',:'release_id'),'55000');
select pg_temp.assert_true((select change_summary='test fixture' from support_vnext_shadow.support_ruleset_release where release_id=:'release_id'::uuid),'P02 release remained unchanged');
\echo 'PASS P02 published release UPDATE rejected'
rollback;
