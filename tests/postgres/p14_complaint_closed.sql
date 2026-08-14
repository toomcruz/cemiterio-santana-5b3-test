\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
\ir fixtures/confirmation_flow_fixture.sql

create table if not exists support_vnext_test.p14_scenarios(
  test_run_id uuid primary key,
  scenario_code text not null unique,
  scenario_kind text not null check (scenario_kind in ('VALID','REJECTED'))
);

create or replace function support_vnext_test.p14_confirm_valid_complaint(
  p_case text,p_fields jsonb
) returns void language plpgsql as $$
declare c support_vnext_test.complaint_proposal_fixture_context;
  proposal jsonb; authorization jsonb; result jsonb;
  inbound_id uuid:=extensions.gen_random_uuid(); classification_id uuid:=extensions.gen_random_uuid();
  run_id uuid:=extensions.gen_random_uuid(); confirmation_id uuid; confirmation_nonce uuid; authorization_id uuid;
begin
  select * into c from support_vnext_test.create_complaint_proposal_fixture(run_id,p_fields);
  insert into support_vnext_test.p14_scenarios values(run_id,p_case,'VALID');
  perform pg_temp.assert_true((select intent_code='RECLAMACAO_INTERNA' from support_vnext_shadow.knowledge_intent where intent_id=c.intent_id),'P14 fixture uses the invisible RECLAMACAO_INTERNA intent: '||p_case);
  proposal:=support_vnext_shadow.propose_request_transaction(c.decision_id,'P14-'||p_case||'-PROPOSE');
  confirmation_id:=(proposal->>'confirmation_id')::uuid;
  confirmation_nonce:=(proposal->>'confirmation_nonce')::uuid;
  if confirmation_id is null or confirmation_nonce is null then raise exception 'P14 % did not create a pending confirmation',p_case using errcode='P0001'; end if;
  perform support_vnext_test.persist_test_inbound_classification(classification_id,inbound_id,confirmation_id,c.session_id,c.topic_id,c.release_id);
  authorization:=support_vnext_shadow.authorize_persisted_confirmation(classification_id,confirmation_id,confirmation_nonce,inbound_id,c.session_id,c.topic_id,c.release_id);
  authorization_id:=(authorization->>'authorization_id')::uuid;
  if authorization_id is null then raise exception 'P14 % did not create confirmation authorization',p_case using errcode='P0001'; end if;
  result:=support_vnext_shadow.confirm_request_transaction(confirmation_id,confirmation_nonce,classification_id,inbound_id,'P14-'||p_case||'-CONFIRM');
  if result->>'outcome'<>'CONFIRMED' then raise exception 'P14 % confirmation result was %',p_case,result using errcode='P0001'; end if;

  perform pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r where r.confirmation_id=confirmation_id),'P14 valid request count is one: '||p_case);
  perform pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r where r.confirmation_id=confirmation_id and r.protocol is not null),'P14 valid protocol count is one: '||p_case);
  perform pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r join support_vnext_shadow.pending_confirmations pc on pc.confirmation_id=r.confirmation_id where r.confirmation_id=confirmation_id and r.category_code='RECLAMACAO' and r.request_payload=p_fields and r.session_id=c.session_id and r.topic_id=c.topic_id and r.release_id=c.release_id and pc.decision_id=c.decision_id and pc.request_policy_id=c.request_policy_id),'P14 request preserves complaint state and policy: '||p_case);
  perform pg_temp.assert_true((select not (r.request_payload ?| array['severity','gravidade','sector','setor','assigned_sector','external_route','ouvidoria','email','automatic_email','priority']) from support_vnext_shadow.service_requests r where r.confirmation_id=confirmation_id),'P14 request has no prohibited complaint routing fields: '||p_case);
  perform pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.confirmation_authorizations a where a.authorization_id=authorization_id and a.consumed_at is not null),'P14 authorization consumed once: '||p_case);
  perform pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.inbound_classifications i where i.classification_id=classification_id and i.status='CONSUMED' and i.consumed_at is not null),'P14 classification consumed once: '||p_case);
  perform pg_temp.assert_true((select status='CONSUMED' and request_id=(result->>'request_id')::uuid from support_vnext_shadow.pending_confirmations where confirmation_id=confirmation_id),'P14 pending confirmation finalized: '||p_case);
end $$;

create or replace function support_vnext_test.p14_expect_proposal_rejected(
  p_case text,p_fields jsonb
) returns void language plpgsql as $$
declare c support_vnext_test.complaint_proposal_fixture_context; run_id uuid:=extensions.gen_random_uuid(); proposal jsonb;
begin
  select * into c from support_vnext_test.create_complaint_proposal_fixture(run_id,p_fields);
  insert into support_vnext_test.p14_scenarios values(run_id,p_case,'REJECTED');
  begin
    proposal:=support_vnext_shadow.propose_request_transaction(c.decision_id,'P14-'||p_case||'-PROPOSE');
    raise exception 'P14 % unexpectedly accepted invalid complaint proposal: %',p_case,proposal using errcode='P0001';
  exception when others then
    if sqlstate='P0001' then raise; end if;
    if sqlstate<>'22023' then raise exception 'P14 % expected controlled 22023 rejection, got %',p_case,sqlstate using errcode='P0001'; end if;
  end;
  perform pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.pending_confirmations pc where pc.decision_id=c.decision_id),'P14 rejected proposal created no pending confirmation: '||p_case);
  perform pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.service_requests r where r.session_id=c.session_id),'P14 rejected proposal created no service_requests: '||p_case);
  perform pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.service_requests r where r.session_id=c.session_id and r.protocol is not null),'P14 rejected proposal created no protocol: '||p_case);
end $$;

-- VALID-01 through VALID-04: real PROPOSE → inbound → classification → authorization → CONFIRM.
select support_vnext_test.p14_confirm_valid_complaint('P14-VALID-01','{"relato":"Relato artificial P14-VALID-01"}'::jsonb);
select support_vnext_test.p14_confirm_valid_complaint('P14-VALID-02','{"relato":"Relato artificial P14-VALID-02","attachment_ids":[]}'::jsonb);
select support_vnext_test.p14_confirm_valid_complaint('P14-VALID-03','{"relato":"Relato artificial P14-VALID-03","attachment_ids":["00000000-0000-4000-8000-000000000101"]}'::jsonb);
select support_vnext_test.p14_confirm_valid_complaint('P14-VALID-04','{"relato":"Relato artificial P14-VALID-04","attachment_ids":["00000000-0000-4000-8000-000000000102","00000000-0000-4000-8000-000000000103"]}'::jsonb);

-- I01 through I12: prohibited routing/priority fields and unknown objects.
select support_vnext_test.p14_expect_proposal_rejected('P14-I01','{"relato":"x","severity":"HIGH"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I02','{"relato":"x","gravidade":"ALTA"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I03','{"relato":"x","sector":"COMERCIAL"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I04','{"relato":"x","setor":"COMERCIAL"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I05','{"relato":"x","assigned_sector":"COMERCIAL"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I06','{"relato":"x","external_route":"EMAIL"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I07','{"relato":"x","ouvidoria":"EXTERNA"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I08','{"relato":"x","email":"teste@example.invalid"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I09','{"relato":"x","automatic_email":true}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I10','{"relato":"x","priority":"HIGH"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I11','{"relato":"x","metadata":{"setor":"COMERCIAL"}}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-I12','{"relato":"x","unknown_key":"x"}'::jsonb);

-- A01 through A08: attachment_ids is the closed uuid_array, never a generic JSON array.
select support_vnext_test.p14_expect_proposal_rejected('P14-A01','{"relato":"x","attachment_ids":"00000000-0000-4000-8000-000000000201"}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A02','{"relato":"x","attachment_ids":123}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A03','{"relato":"x","attachment_ids":{}}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A04','{"relato":"x","attachment_ids":["uuid-invalido"]}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A05','{"relato":"x","attachment_ids":[123]}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A06','{"relato":"x","attachment_ids":[null]}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A07','{"relato":"x","attachment_ids":["00000000-0000-4000-8000-000000000202",123]}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-A08','{"relato":"x","attachment_ids":[["00000000-0000-4000-8000-000000000203"]]}'::jsonb);

-- The published policy declares relato as string; no extra content rule is invented.
select support_vnext_test.p14_expect_proposal_rejected('P14-R01','{"relato":123}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-R02','{"relato":{}}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-R03','{"relato":[]}'::jsonb);
select support_vnext_test.p14_expect_proposal_rejected('P14-R04','{"relato":true}'::jsonb);

select pg_temp.assert_true((select count(*)=4 from support_vnext_test.p14_scenarios where scenario_kind='VALID'),'P14 registered exactly four valid complaint scenarios');
select pg_temp.assert_true((select count(*)=24 from support_vnext_test.p14_scenarios where scenario_kind='REJECTED'),'P14 registered all forbidden, invalid attachment, and invalid relato scenarios');
select pg_temp.assert_true(not exists(select 1 from support_vnext_test.p14_scenarios s join support_vnext_test.complaint_proposal_fixture_context c on c.test_run_id=s.test_run_id join support_vnext_shadow.service_requests r on r.session_id=c.session_id where s.scenario_kind='REJECTED'),'P14 rejected scenarios created no service_requests');
\echo 'PASS P14 closed RECLAMACAO proposal, confirmation, protocol and rejection guards'
rollback;
