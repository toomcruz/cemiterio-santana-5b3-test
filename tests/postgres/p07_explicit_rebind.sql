\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
select pg_temp.publish_release('P07_SCOPE') as revoked_id \gset
select pg_temp.expect_error(format('select support_vnext_shadow.transition_ruleset_release(%L::uuid,%L::support_vnext_shadow.ruleset_status,%L,%L,%L,%L::uuid)',:'revoked_id','REVOKED','test-fixture','test','EXPLICIT_REBIND','00000000-0000-4000-8000-000000000999'),'22023');
select pg_temp.new_approved_release('P07_SCOPE') as replacement_id \gset
select support_vnext_shadow.transition_ruleset_release(:'revoked_id'::uuid,'REVOKED','test-fixture','test','EXPLICIT_REBIND',:'replacement_id'::uuid);
select pg_temp.assert_true((select replacement_release_id=:'replacement_id'::uuid from support_vnext_shadow.support_ruleset_release where release_id=:'revoked_id'::uuid),'P07 valid replacement persisted');
\echo 'PASS P07 explicit rebind validation'
rollback;
