\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
select pg_temp.publish_release('P03_SCOPE') as release_id \gset
select pg_temp.expect_error(format('delete from support_vnext_shadow.support_ruleset_release where release_id=%L',:'release_id'),'55000');
select pg_temp.assert_true(exists(select 1 from support_vnext_shadow.support_ruleset_release where release_id=:'release_id'::uuid),'P03 release still exists');
\echo 'PASS P03 published release DELETE rejected'
rollback;
