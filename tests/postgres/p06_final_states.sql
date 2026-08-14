\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
select pg_temp.publish_release('P06_SCOPE') as release_id \gset
select support_vnext_shadow.transition_ruleset_release(:'release_id'::uuid,'SUPERSEDED','test-fixture');
select pg_temp.expect_error(format('update support_vnext_shadow.support_ruleset_release set status=%L where release_id=%L','PUBLISHED',:'release_id'),'55000');
select pg_temp.publish_release('P06_REVOKED_SCOPE') as revoked_id \gset
select support_vnext_shadow.transition_ruleset_release(:'revoked_id'::uuid,'REVOKED','test-fixture','test','BLOCK_FACTS',null);
select pg_temp.expect_error(format('update support_vnext_shadow.support_ruleset_release set status=%L where release_id=%L','PUBLISHED',:'revoked_id'),'55000');
\echo 'PASS P06 final state resurrection rejected'
rollback;
