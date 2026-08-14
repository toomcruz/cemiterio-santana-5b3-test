\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
\ir fixtures/confirmation_flow_fixture.sql
select extensions.gen_random_uuid() as test_run_id \gset
select support_vnext_test.create_confirmation_fixture(:'test_run_id'::uuid,false);
select pg_temp.assert_true((select status='PUBLISHED' from support_vnext_shadow.support_ruleset_release r join support_vnext_test.confirmation_fixture_context c on c.release_id=r.release_id where c.test_run_id=:'test_run_id'::uuid),'release published');
select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.service_requests x join support_vnext_test.confirmation_fixture_context c on c.confirmation_id=x.confirmation_id where c.test_run_id=:'test_run_id'::uuid),'no request before CONFIRM');
select pg_temp.assert_true((select pc.status='PENDING' and im.inbound_message_id=ic.inbound_message_id and ca.classification_id=ic.classification_id and pc.session_id=c.session_id and pc.topic_id=c.topic_id and pc.release_id=c.release_id from support_vnext_test.confirmation_fixture_context c join support_vnext_shadow.pending_confirmations pc on pc.confirmation_id=c.confirmation_id join support_vnext_shadow.inbound_messages im on im.inbound_message_id=c.inbound_message_id join support_vnext_shadow.inbound_classifications ic on ic.classification_id=c.classification_id join support_vnext_shadow.confirmation_authorizations ca on ca.authorization_id=c.authorization_id where c.test_run_id=:'test_run_id'::uuid),'pending, inbound, classification and authorization coherent');
\echo 'PASS P00 confirmation fixture sanity'
rollback;
