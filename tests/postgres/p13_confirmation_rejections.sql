\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
\ir fixtures/confirmation_flow_fixture.sql

create table if not exists support_vnext_test.p13_invalid_scenarios(test_run_id uuid primary key,scenario_code text not null unique);
create or replace function support_vnext_test.p13_expect_rejected(p_confirmation_id uuid,p_confirmation_nonce uuid,p_classification_id uuid,p_inbound_message_id uuid,p_case text) returns void language plpgsql as $$
declare result jsonb;
begin
  result:=support_vnext_shadow.confirm_request_transaction(p_confirmation_id,p_confirmation_nonce,p_classification_id,p_inbound_message_id,'P13-'||p_case);
  if coalesce(result->>'outcome','') not in ('REJECTED','NOT_FOUND') then raise exception 'P13 % expected controlled rejection, got %',p_case,result using errcode='P0001'; end if;
end $$;
create or replace function support_vnext_test.p13_assert_no_request(p_confirmation_id uuid,p_case text) returns void language plpgsql as $$
begin
  if exists(select 1 from support_vnext_shadow.service_requests where confirmation_id=p_confirmation_id) then raise exception 'P13 % created a service_request',p_case using errcode='P0001'; end if;
  if exists(select 1 from support_vnext_shadow.service_requests where confirmation_id=p_confirmation_id and protocol is not null) then raise exception 'P13 % created a protocol',p_case using errcode='P0001'; end if;
end $$;
create or replace function support_vnext_test.p13_new_closed_topic(p_session_id uuid,p_intent_id uuid,p_service_id uuid) returns uuid language plpgsql as $$
declare topic uuid:=extensions.gen_random_uuid();
begin
  insert into support_vnext_shadow.conversation_topics(topic_id,session_id,intent_id,service_id,status,closed_at) values(topic,p_session_id,p_intent_id,p_service_id,'CLOSED',now());
  return topic;
end $$;

-- P13-A: expired confirmation.
select extensions.gen_random_uuid() as test_run_id \gset a_
select support_vnext_test.create_confirmation_fixture(:'a_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'a_test_run_id'::uuid \gset a_
insert into support_vnext_test.p13_invalid_scenarios values(:'a_test_run_id'::uuid,'P13-A');
update support_vnext_shadow.pending_confirmations set expires_at=now()-interval '1 second' where confirmation_id=:'a_confirmation_id'::uuid;
select support_vnext_test.p13_expect_rejected(:'a_confirmation_id'::uuid,:'a_confirmation_nonce'::uuid,:'a_classification_id'::uuid,:'a_inbound_message_id'::uuid,'A expired');
select support_vnext_test.p13_assert_no_request(:'a_confirmation_id'::uuid,'A expired');

-- P13-B: evidence belongs to another topic in the same session/release.
select extensions.gen_random_uuid() as test_run_id \gset b_
select support_vnext_test.create_confirmation_fixture(:'b_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'b_test_run_id'::uuid \gset b_
insert into support_vnext_test.p13_invalid_scenarios values(:'b_test_run_id'::uuid,'P13-B');
select support_vnext_test.p13_new_closed_topic(:'b_session_id'::uuid,:'b_intent_id'::uuid,:'b_service_id'::uuid) as other_topic_id \gset b_
select extensions.gen_random_uuid() as other_inbound_id \gset b_
select extensions.gen_random_uuid() as other_classification_id \gset b_
select support_vnext_test.persist_test_inbound_classification(:'b_other_classification_id'::uuid,:'b_other_inbound_id'::uuid,null,:'b_session_id'::uuid,:'b_other_topic_id'::uuid,:'b_release_id'::uuid,'OTHER','OK');
select support_vnext_test.p13_expect_rejected(:'b_confirmation_id'::uuid,:'b_confirmation_nonce'::uuid,:'b_other_classification_id'::uuid,:'b_other_inbound_id'::uuid,'B different topic');
select support_vnext_test.p13_assert_no_request(:'b_confirmation_id'::uuid,'B different topic');

-- P13-C: state_version changed after proposal.
select extensions.gen_random_uuid() as test_run_id \gset c_
select support_vnext_test.create_confirmation_fixture(:'c_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'c_test_run_id'::uuid \gset c_
insert into support_vnext_test.p13_invalid_scenarios values(:'c_test_run_id'::uuid,'P13-C');
update support_vnext_shadow.conversation_sessions set state_version=state_version+1 where session_id=:'c_session_id'::uuid;
select support_vnext_test.p13_expect_rejected(:'c_confirmation_id'::uuid,:'c_confirmation_nonce'::uuid,:'c_classification_id'::uuid,:'c_inbound_message_id'::uuid,'C state_version');
select support_vnext_test.p13_assert_no_request(:'c_confirmation_id'::uuid,'C state_version');

-- P13-D: topic_version changed after proposal.
select extensions.gen_random_uuid() as test_run_id \gset d_
select support_vnext_test.create_confirmation_fixture(:'d_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'d_test_run_id'::uuid \gset d_
insert into support_vnext_test.p13_invalid_scenarios values(:'d_test_run_id'::uuid,'P13-D');
update support_vnext_shadow.conversation_topics set topic_version=topic_version+1 where topic_id=:'d_topic_id'::uuid;
select support_vnext_test.p13_expect_rejected(:'d_confirmation_id'::uuid,:'d_confirmation_nonce'::uuid,:'d_classification_id'::uuid,:'d_inbound_message_id'::uuid,'D topic_version');
select support_vnext_test.p13_assert_no_request(:'d_confirmation_id'::uuid,'D topic_version');

-- P13-E: separately published fixture release supplies incompatible evidence.
select extensions.gen_random_uuid() as test_run_id \gset e_a_
select support_vnext_test.create_confirmation_fixture(:'e_a_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'e_a_test_run_id'::uuid \gset e_a_
select extensions.gen_random_uuid() as test_run_id \gset e_b_
select support_vnext_test.create_confirmation_fixture(:'e_b_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'e_b_test_run_id'::uuid \gset e_b_
insert into support_vnext_test.p13_invalid_scenarios values(:'e_a_test_run_id'::uuid,'P13-E');
select support_vnext_test.p13_expect_rejected(:'e_a_confirmation_id'::uuid,:'e_a_confirmation_nonce'::uuid,:'e_b_classification_id'::uuid,:'e_b_inbound_message_id'::uuid,'E incompatible release');
select support_vnext_test.p13_assert_no_request(:'e_a_confirmation_id'::uuid,'E incompatible release');

-- P13-F: session closed before confirmation.
select extensions.gen_random_uuid() as test_run_id \gset f_
select support_vnext_test.create_confirmation_fixture(:'f_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'f_test_run_id'::uuid \gset f_
insert into support_vnext_test.p13_invalid_scenarios values(:'f_test_run_id'::uuid,'P13-F');
update support_vnext_shadow.conversation_sessions set status='CLOSED',closed_at=now() where session_id=:'f_session_id'::uuid;
select support_vnext_test.p13_expect_rejected(:'f_confirmation_id'::uuid,:'f_confirmation_nonce'::uuid,:'f_classification_id'::uuid,:'f_inbound_message_id'::uuid,'F session closed');
select support_vnext_test.p13_assert_no_request(:'f_confirmation_id'::uuid,'F session closed');

-- P13-G: evidence belongs to a different session of the same release.
select extensions.gen_random_uuid() as test_run_id \gset g_
select support_vnext_test.create_confirmation_fixture(:'g_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'g_test_run_id'::uuid \gset g_
insert into support_vnext_test.p13_invalid_scenarios values(:'g_test_run_id'::uuid,'P13-G');
select extensions.gen_random_uuid() as other_session_id \gset g_
select extensions.gen_random_uuid() as other_topic_id \gset g_
select extensions.gen_random_uuid() as other_inbound_id \gset g_
select extensions.gen_random_uuid() as other_classification_id \gset g_
insert into support_vnext_shadow.conversation_sessions(session_id,conversation_id,release_id,last_inbound_at) values(:'g_other_session_id'::uuid,extensions.gen_random_uuid(),:'g_release_id'::uuid,now());
insert into support_vnext_shadow.conversation_topics(topic_id,session_id,intent_id,service_id,status,closed_at) values(:'g_other_topic_id'::uuid,:'g_other_session_id'::uuid,:'g_intent_id'::uuid,:'g_service_id'::uuid,'CLOSED',now());
select support_vnext_test.persist_test_inbound_classification(:'g_other_classification_id'::uuid,:'g_other_inbound_id'::uuid,null,:'g_other_session_id'::uuid,:'g_other_topic_id'::uuid,:'g_release_id'::uuid,'OTHER','OK');
select support_vnext_test.p13_expect_rejected(:'g_confirmation_id'::uuid,:'g_confirmation_nonce'::uuid,:'g_other_classification_id'::uuid,:'g_other_inbound_id'::uuid,'G different session');
select support_vnext_test.p13_assert_no_request(:'g_confirmation_id'::uuid,'G different session');

-- P13-H: classification is tied to another inbound in the same topic.
select extensions.gen_random_uuid() as test_run_id \gset h_
select support_vnext_test.create_confirmation_fixture(:'h_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'h_test_run_id'::uuid \gset h_
insert into support_vnext_test.p13_invalid_scenarios values(:'h_test_run_id'::uuid,'P13-H');
select extensions.gen_random_uuid() as other_inbound_id \gset h_
select extensions.gen_random_uuid() as other_classification_id \gset h_
select support_vnext_test.persist_test_inbound_classification(:'h_other_classification_id'::uuid,:'h_other_inbound_id'::uuid,null,:'h_session_id'::uuid,:'h_topic_id'::uuid,:'h_release_id'::uuid,'OTHER','OK');
select support_vnext_test.p13_expect_rejected(:'h_confirmation_id'::uuid,:'h_confirmation_nonce'::uuid,:'h_other_classification_id'::uuid,:'h_inbound_message_id'::uuid,'H classification other inbound');
select support_vnext_test.p13_assert_no_request(:'h_confirmation_id'::uuid,'H classification other inbound');

-- P13-I: classification is tied to another topic in the same session.
select extensions.gen_random_uuid() as test_run_id \gset i_
select support_vnext_test.create_confirmation_fixture(:'i_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'i_test_run_id'::uuid \gset i_
insert into support_vnext_test.p13_invalid_scenarios values(:'i_test_run_id'::uuid,'P13-I');
select support_vnext_test.p13_new_closed_topic(:'i_session_id'::uuid,:'i_intent_id'::uuid,:'i_service_id'::uuid) as other_topic_id \gset i_
select extensions.gen_random_uuid() as other_inbound_id \gset i_
select extensions.gen_random_uuid() as other_classification_id \gset i_
select support_vnext_test.persist_test_inbound_classification(:'i_other_classification_id'::uuid,:'i_other_inbound_id'::uuid,null,:'i_session_id'::uuid,:'i_other_topic_id'::uuid,:'i_release_id'::uuid,'OTHER','OK');
select support_vnext_test.p13_expect_rejected(:'i_confirmation_id'::uuid,:'i_confirmation_nonce'::uuid,:'i_other_classification_id'::uuid,:'i_other_inbound_id'::uuid,'I classification other topic');
select support_vnext_test.p13_assert_no_request(:'i_confirmation_id'::uuid,'I classification other topic');

-- P13-J: a legitimate OTHER classification cannot confirm.
select extensions.gen_random_uuid() as test_run_id \gset j_
select support_vnext_test.create_confirmation_fixture(:'j_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'j_test_run_id'::uuid \gset j_
insert into support_vnext_test.p13_invalid_scenarios values(:'j_test_run_id'::uuid,'P13-J');
select extensions.gen_random_uuid() as other_inbound_id \gset j_
select extensions.gen_random_uuid() as other_classification_id \gset j_
select support_vnext_test.persist_test_inbound_classification(:'j_other_classification_id'::uuid,:'j_other_inbound_id'::uuid,null,:'j_session_id'::uuid,:'j_topic_id'::uuid,:'j_release_id'::uuid,'OTHER','OK');
select pg_temp.expect_error(format($q$select support_vnext_shadow.authorize_persisted_confirmation(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)$q$,:'j_other_classification_id',:'j_confirmation_id',:'j_confirmation_nonce',:'j_other_inbound_id',:'j_session_id',:'j_topic_id',:'j_release_id'),'22023');
select support_vnext_test.p13_expect_rejected(:'j_confirmation_id'::uuid,:'j_confirmation_nonce'::uuid,:'j_other_classification_id'::uuid,:'j_other_inbound_id'::uuid,'J non affirmative classification');
select support_vnext_test.p13_assert_no_request(:'j_confirmation_id'::uuid,'J non affirmative classification');

-- P13-K: only nonce is wrong.
select extensions.gen_random_uuid() as test_run_id \gset k_
select support_vnext_test.create_confirmation_fixture(:'k_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'k_test_run_id'::uuid \gset k_
insert into support_vnext_test.p13_invalid_scenarios values(:'k_test_run_id'::uuid,'P13-K');
select support_vnext_test.p13_expect_rejected(:'k_confirmation_id'::uuid,extensions.gen_random_uuid(),:'k_classification_id'::uuid,:'k_inbound_message_id'::uuid,'K wrong nonce');
select support_vnext_test.p13_assert_no_request(:'k_confirmation_id'::uuid,'K wrong nonce');

-- P13-L: a legitimately consumed authorization from fixture A cannot create a request for fixture B.
select extensions.gen_random_uuid() as test_run_id \gset l_used_
select support_vnext_test.create_confirmation_fixture(:'l_used_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'l_used_test_run_id'::uuid \gset l_used_
select support_vnext_shadow.confirm_request_transaction(:'l_used_confirmation_id'::uuid,:'l_used_confirmation_nonce'::uuid,:'l_used_classification_id'::uuid,:'l_used_inbound_message_id'::uuid,'P13-L legitimate consumption') as l_initial_result \gset
select pg_temp.assert_true(:'l_initial_result'::jsonb->>'outcome'='CONFIRMED','P13-L setup legitimately consumed authorization');
select extensions.gen_random_uuid() as test_run_id \gset l_target_
select support_vnext_test.create_confirmation_fixture(:'l_target_test_run_id'::uuid,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'l_target_test_run_id'::uuid \gset l_target_
insert into support_vnext_test.p13_invalid_scenarios values(:'l_target_test_run_id'::uuid,'P13-L');
select support_vnext_test.p13_expect_rejected(:'l_target_confirmation_id'::uuid,:'l_target_confirmation_nonce'::uuid,:'l_used_classification_id'::uuid,:'l_used_inbound_message_id'::uuid,'L consumed authorization against new confirmation');
select support_vnext_test.p13_assert_no_request(:'l_target_confirmation_id'::uuid,'L consumed authorization');

select pg_temp.assert_true((select count(*)=12 from support_vnext_test.p13_invalid_scenarios),'P13 registered all invalid scenarios');
select pg_temp.assert_true(not exists(select 1 from support_vnext_test.p13_invalid_scenarios x join support_vnext_test.confirmation_fixture_context f on f.test_run_id=x.test_run_id join support_vnext_shadow.service_requests r on r.confirmation_id=f.confirmation_id),'P13 invalid scenarios created no service_requests');
select pg_temp.assert_true(not exists(select 1 from support_vnext_test.p13_invalid_scenarios x join support_vnext_test.confirmation_fixture_context f on f.test_run_id=x.test_run_id join support_vnext_shadow.service_requests r on r.confirmation_id=f.confirmation_id where r.protocol is not null),'P13 invalid scenarios created no protocols');
select pg_temp.assert_true(not exists(select 1 from support_vnext_test.p13_invalid_scenarios x join support_vnext_test.confirmation_fixture_context f on f.test_run_id=x.test_run_id join support_vnext_shadow.confirmation_authorizations a on a.authorization_id=f.authorization_id where a.consumed_at is not null),'P13 invalid authorizations were not consumed');
select pg_temp.assert_true(not exists(select 1 from support_vnext_test.p13_invalid_scenarios x join support_vnext_test.confirmation_fixture_context f on f.test_run_id=x.test_run_id join support_vnext_shadow.pending_confirmations c on c.confirmation_id=f.confirmation_id where c.status<>'PENDING'),'P13 invalid confirmations remain pending');
\echo 'PASS P13 transactional confirmation rejection guards'
rollback;
