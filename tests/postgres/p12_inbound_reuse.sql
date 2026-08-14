\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
\ir fixtures/confirmation_flow_fixture.sql

create or replace function support_vnext_test.p12_expect_consumed_authorization_rejected(
  p_classification_id uuid,p_confirmation_id uuid,p_confirmation_nonce uuid,p_inbound_message_id uuid,
  p_session_id uuid,p_topic_id uuid,p_release_id uuid,p_case text
) returns void language plpgsql as $$
begin
  perform support_vnext_shadow.authorize_persisted_confirmation(
    p_classification_id,p_confirmation_id,p_confirmation_nonce,p_inbound_message_id,p_session_id,p_topic_id,p_release_id
  );
  raise exception 'P12 % unexpectedly authorized consumed evidence',p_case using errcode='P0001';
exception when others then
  if sqlstate='P0001' then raise; end if;
  if sqlstate<>'22023' then
    raise exception 'P12 % expected SQLSTATE 22023 for consumed evidence, got %',p_case,sqlstate using errcode='P0001';
  end if;
end $$;

select extensions.gen_random_uuid() as test_run_id \gset
select support_vnext_test.create_confirmation_fixture(:'test_run_id'::uuid,false);
select confirmation_id,confirmation_nonce,inbound_message_id,classification_id,authorization_id,session_id,topic_id,decision_id,release_id
from support_vnext_test.confirmation_fixture_context where test_run_id=:'test_run_id'::uuid \gset

select support_vnext_shadow.confirm_request_transaction(
  :'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P12-initial-confirm'
) as initial_result \gset
select pg_temp.assert_true(:'initial_result'::jsonb->>'outcome'='CONFIRMED','P12 initial confirmation succeeded');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid),'P12 initial confirmation created exactly one service_request');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid and protocol is not null),'P12 initial confirmation created exactly one protocol');

select support_vnext_shadow.persist_shadow_inbound_message(:'inbound_message_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'support_vnext_test inbound '||:'inbound_message_id');
select support_vnext_test.p12_expect_consumed_authorization_rejected(:'classification_id'::uuid,:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'inbound_message_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'P12-A inbound_message_id reuse');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid),'P12-A inbound reuse created no request');

select support_vnext_test.p12_expect_consumed_authorization_rejected(:'classification_id'::uuid,:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'inbound_message_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'P12-B classification_id reuse');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.confirmation_authorizations where confirmation_id=:'confirmation_id'::uuid),'P12-B classification reuse created no authorization');

select support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P12-C-authorization-reuse') as p12_c_result \gset
select pg_temp.assert_true(:'p12_c_result'::jsonb->>'outcome'='ALREADY_CONFIRMED','P12-C authorization reuse is idempotent');

select support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P12-D-nonce-reuse') as p12_d_result \gset
select pg_temp.assert_true(:'p12_d_result'::jsonb->>'outcome'='ALREADY_CONFIRMED','P12-D nonce reuse is idempotent');

select support_vnext_test.p12_expect_consumed_authorization_rejected(:'classification_id'::uuid,:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'inbound_message_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'P12-E confirmation_id reuse');
select pg_temp.assert_true((select status='CONSUMED' and request_id is not null from support_vnext_shadow.pending_confirmations where confirmation_id=:'confirmation_id'::uuid),'P12-E confirmation remains final');

select support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P12-full-replay') as full_replay_result \gset
select pg_temp.assert_true(:'full_replay_result'::jsonb->>'outcome'='ALREADY_CONFIRMED','P12 full artifact replay is idempotent');

select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid),'P12 final service_request count is one');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid and protocol is not null),'P12 final protocol count is one');
select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid and protocol is null),'P12 no request orphan exists');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.confirmation_authorizations where authorization_id=:'authorization_id'::uuid and consumed_at is not null and consumed_by_request_id=(select request_id from support_vnext_shadow.pending_confirmations where confirmation_id=:'confirmation_id'::uuid)),'P12 authorization consumed once by the persisted request');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.inbound_classifications where classification_id=:'classification_id'::uuid and status='CONSUMED' and consumed_at is not null and consumed_by_request_id=(select request_id from support_vnext_shadow.pending_confirmations where confirmation_id=:'confirmation_id'::uuid)),'P12 classification remains consumed');
select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.confirmation_authorizations where confirmation_id=:'confirmation_id'::uuid and authorization_id<>:'authorization_id'::uuid),'P12 no second effective authorization exists');
\echo 'PASS P12 consumed inbound/classification/authorization/nonce/confirmation reuse guards'
rollback;
