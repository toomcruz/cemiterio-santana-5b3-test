-- Executed only by PostgreSQL tests in a disposable isolated database.
create schema if not exists support_vnext_test;
create table if not exists support_vnext_test.classifier_authority_fixture_context(
 authority_key_id uuid primary key, verifier_secret text not null, created_at timestamptz not null default now());

create or replace function support_vnext_test.ensure_classifier_authority()
returns support_vnext_test.classifier_authority_fixture_context language plpgsql as $$
declare r support_vnext_test.classifier_authority_fixture_context;
begin
 select * into r from support_vnext_test.classifier_authority_fixture_context limit 1;
 if found then return r; end if;
 r.authority_key_id:=extensions.gen_random_uuid(); r.verifier_secret:='test-only-classifier-authority-not-for-runtime';
 insert into support_vnext_shadow.classifier_authorities(authority_key_id,authority_name,verifier_secret,created_by)
 values(r.authority_key_id,'support-vnext-test-classifier',r.verifier_secret,'support_vnext_test');
 insert into support_vnext_test.classifier_authority_fixture_context select r.*;
 return r;
end $$;

create or replace function support_vnext_test.persist_test_inbound_classification(
 p_classification_id uuid,p_inbound_message_id uuid,p_confirmation_id uuid,p_session_id uuid,p_topic_id uuid,p_release_id uuid,
 p_classification_code text default 'CONFIRMATION_AFFIRMATIVE',p_classification_status text default 'OK'
) returns jsonb language plpgsql as $$
declare a support_vnext_test.classifier_authority_fixture_context; ch char(64); nonce uuid:=extensions.gen_random_uuid(); material char(64); assertion text;
begin
 perform support_vnext_shadow.persist_shadow_inbound_message(p_inbound_message_id,p_session_id,p_topic_id,p_release_id,'support_vnext_test inbound '||p_inbound_message_id::text);
 if p_classification_code='CONFIRMATION_AFFIRMATIVE' then
   a:=support_vnext_test.ensure_classifier_authority();
   select content_hash into ch from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id;
   material:=support_vnext_shadow.classifier_assertion_material(p_inbound_message_id,ch,p_confirmation_id,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,'support-vnext-test-classifier-v1',nonce);
   assertion:=encode(extensions.hmac(material,a.verifier_secret,'sha256'),'hex');
   return support_vnext_shadow.persist_inbound_classification(p_classification_id,p_inbound_message_id,p_confirmation_id,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,'DETERMINISTIC','support-vnext-test-classifier-v1',a.authority_key_id,nonce,assertion);
 end if;
 return support_vnext_shadow.persist_inbound_classification(p_classification_id,p_inbound_message_id,null,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,'DETERMINISTIC','support-vnext-test-classifier-v1',null,null,null);
end $$;

create table if not exists support_vnext_test.confirmation_fixture_context(
 test_run_id uuid primary key, release_id uuid not null, intent_id uuid not null, service_id uuid not null, template_id uuid not null, request_policy_id uuid not null, conversation_id uuid not null, session_id uuid not null, topic_id uuid not null, decision_id uuid not null, confirmation_id uuid not null, confirmation_nonce uuid not null, inbound_message_id uuid not null, classification_id uuid not null, authorization_id uuid null, created_at timestamptz not null default now());

-- This context stops immediately before PROPOSE. It lets tests exercise the real
-- proposal RPC with both accepted and rejected complaint payloads.
create table if not exists support_vnext_test.complaint_proposal_fixture_context(
 test_run_id uuid primary key, release_id uuid not null, intent_id uuid not null,
 service_id uuid not null, template_id uuid not null, request_policy_id uuid not null,
 conversation_id uuid not null, session_id uuid not null, topic_id uuid not null,
 decision_id uuid not null, proposal_field_values jsonb not null, created_at timestamptz not null default now());

create or replace function support_vnext_test.create_complaint_proposal_fixture(
  p_test_run_id uuid,p_proposal_field_values jsonb
) returns support_vnext_test.complaint_proposal_fixture_context language plpgsql as $$
declare r support_vnext_test.complaint_proposal_fixture_context; n int; plan jsonb;
begin
 if exists(select 1 from support_vnext_test.complaint_proposal_fixture_context where test_run_id=p_test_run_id) then
   select * into r from support_vnext_test.complaint_proposal_fixture_context where test_run_id=p_test_run_id;
   if r.proposal_field_values<>p_proposal_field_values then raise exception 'fixture run id has different proposal fields' using errcode='22023'; end if;
   return r;
 end if;
 select coalesce(max(release_sequence),0)+1 into n from support_vnext_shadow.support_ruleset_release;
 r.test_run_id:=p_test_run_id; r.release_id:=extensions.gen_random_uuid(); r.intent_id:=extensions.gen_random_uuid(); r.service_id:=extensions.gen_random_uuid(); r.template_id:=extensions.gen_random_uuid(); r.request_policy_id:=extensions.gen_random_uuid(); r.conversation_id:=extensions.gen_random_uuid(); r.session_id:=extensions.gen_random_uuid(); r.topic_id:=extensions.gen_random_uuid(); r.decision_id:=extensions.gen_random_uuid(); r.proposal_field_values:=p_proposal_field_values;
 insert into support_vnext_shadow.support_ruleset_release(release_id,release_code,release_sequence,scope_code,status,effective_from,content_hash,change_summary,approved_at,approved_by,created_by,updated_by) values(r.release_id,'FIX-'||replace(r.release_id::text,'-',''),n,'TEST_'||p_test_run_id::text,'DRAFT',now()-interval '1 minute',repeat('0',64),'fixture',now(),'fixture','fixture','fixture');
 insert into support_vnext_shadow.knowledge_service(service_id,release_id,logical_service_id,service_code,public_name,internal_name,availability_status,scope_summary,record_status,created_by) values(r.service_id,r.release_id,extensions.gen_random_uuid(),'TEST_SERVICE','Teste','Teste','ACTIVE','fixture','PUBLISHED','fixture');
 insert into support_vnext_shadow.knowledge_intent(intent_id,release_id,logical_intent_id,intent_code,display_name,visibility,intent_kind,description,record_status,created_by) values(r.intent_id,r.release_id,extensions.gen_random_uuid(),'RECLAMACAO_INTERNA','Teste','INTERNAL','COMPLAINT','fixture','PUBLISHED','fixture');
 insert into support_vnext_shadow.knowledge_message_template(template_id,release_id,logical_template_id,template_code,template_kind,render_mode,body,record_status,created_by) values(r.template_id,r.release_id,extensions.gen_random_uuid(),'TEST_SUBJECT','REQUEST','DETERMINISTIC','Solicitação de teste','PUBLISHED','fixture');
 insert into support_vnext_shadow.decision_request_policy(request_policy_id,release_id,policy_code,scope_intent_id,scope_service_id,request_category_code,subject_template_id,confirmation_template_id,confirmation_expiry_policy,required_data_schema,allow_create,protocol_scope,protocol_prefix,record_status,created_by) values(r.request_policy_id,r.release_id,'TEST_REQUEST',r.intent_id,r.service_id,'RECLAMACAO',r.template_id,r.template_id,'{"seconds":600}','{"properties":{"relato":{"type":"string"},"attachment_ids":{"type":"uuid_array"}},"required":[]}',true,'TEST_'||p_test_run_id::text,'TST','PUBLISHED','fixture');
 perform support_vnext_shadow.refresh_draft_release_content_hash(r.release_id,'fixture');
 update support_vnext_shadow.support_ruleset_release set status='APPROVED' where release_id=r.release_id;
 perform support_vnext_shadow.publish_ruleset_release(r.release_id,'fixture');
 insert into support_vnext_shadow.conversation_sessions(session_id,conversation_id,release_id,last_inbound_at) values(r.session_id,r.conversation_id,r.release_id,now());
 insert into support_vnext_shadow.conversation_topics(topic_id,session_id,intent_id,service_id) values(r.topic_id,r.session_id,r.intent_id,r.service_id);
 plan:=jsonb_build_object('schema_version','1.0','decision_id',r.decision_id,'correlation_id',extensions.gen_random_uuid(),'release_id',r.release_id,'state_version',1,'outcome','PERMITTED','actions',jsonb_build_array('SOLICITAR_CONFIRMACAO'),'response_plan',null,'state_patch',jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array()),'request_plan',jsonb_build_object('mode','PROPOSE','request_policy_id',r.request_policy_id,'subject_template_id',r.template_id,'proposal_field_values',r.proposal_field_values,'document_ids','[]'::jsonb,'confirmation_required',true),'document_plan',null,'handoff_plan',null,'reason_codes',jsonb_build_array('TEST'),'validation_requirements','{}'::jsonb,'expires_at',now()+interval '5 minutes');
 perform support_vnext_shadow.store_shadow_decision(plan,r.session_id,r.topic_id);
 insert into support_vnext_test.complaint_proposal_fixture_context select r.*;
 return r;
end $$;

drop function if exists support_vnext_test.create_confirmation_fixture(uuid,boolean);
create function support_vnext_test.create_confirmation_fixture(p_test_run_id uuid, p_complaint boolean default false, p_prepare_evidence boolean default true)
returns support_vnext_test.confirmation_fixture_context language plpgsql as $$
declare r support_vnext_test.confirmation_fixture_context; n int; plan jsonb; proposal jsonb; auth jsonb;
begin
 if exists(select 1 from support_vnext_test.confirmation_fixture_context where test_run_id=p_test_run_id) then select * into r from support_vnext_test.confirmation_fixture_context where test_run_id=p_test_run_id; return r; end if;
 select coalesce(max(release_sequence),0)+1 into n from support_vnext_shadow.support_ruleset_release;
 r.test_run_id:=p_test_run_id; r.release_id:=extensions.gen_random_uuid(); r.intent_id:=extensions.gen_random_uuid(); r.service_id:=extensions.gen_random_uuid(); r.template_id:=extensions.gen_random_uuid(); r.request_policy_id:=extensions.gen_random_uuid(); r.conversation_id:=extensions.gen_random_uuid(); r.session_id:=extensions.gen_random_uuid(); r.topic_id:=extensions.gen_random_uuid(); r.decision_id:=extensions.gen_random_uuid(); r.inbound_message_id:=extensions.gen_random_uuid(); r.classification_id:=extensions.gen_random_uuid();
 insert into support_vnext_shadow.support_ruleset_release(release_id,release_code,release_sequence,scope_code,status,effective_from,content_hash,change_summary,approved_at,approved_by,created_by,updated_by) values(r.release_id,'FIX-'||replace(r.release_id::text,'-',''),n,'TEST_'||p_test_run_id::text,'DRAFT',now()-interval '1 minute',repeat('0',64),'fixture',now(),'fixture','fixture','fixture');
 insert into support_vnext_shadow.knowledge_service(service_id,release_id,logical_service_id,service_code,public_name,internal_name,availability_status,scope_summary,record_status,created_by) values(r.service_id,r.release_id,extensions.gen_random_uuid(),'TEST_SERVICE','Teste','Teste','ACTIVE','fixture','PUBLISHED','fixture');
 insert into support_vnext_shadow.knowledge_intent(intent_id,release_id,logical_intent_id,intent_code,display_name,visibility,intent_kind,description,record_status,created_by) values(r.intent_id,r.release_id,extensions.gen_random_uuid(),case when p_complaint then 'RECLAMACAO_INTERNA' else 'TEST_INTENT' end,'Teste',case when p_complaint then 'INTERNAL' else 'SYSTEM' end,case when p_complaint then 'COMPLAINT' else 'SYSTEM' end,'fixture','PUBLISHED','fixture');
 insert into support_vnext_shadow.knowledge_message_template(template_id,release_id,logical_template_id,template_code,template_kind,render_mode,body,record_status,created_by) values(r.template_id,r.release_id,extensions.gen_random_uuid(),'TEST_SUBJECT','REQUEST','DETERMINISTIC','Solicitação de teste','PUBLISHED','fixture');
 insert into support_vnext_shadow.decision_request_policy(request_policy_id,release_id,policy_code,scope_intent_id,scope_service_id,request_category_code,subject_template_id,confirmation_template_id,confirmation_expiry_policy,required_data_schema,allow_create,protocol_scope,protocol_prefix,record_status,created_by) values(r.request_policy_id,r.release_id,'TEST_REQUEST',r.intent_id,r.service_id,case when p_complaint then 'RECLAMACAO' else 'TEST' end,r.template_id,r.template_id,'{"seconds":600}','{"properties":{"relato":{"type":"string"},"attachment_ids":{"type":"uuid_array"}},"required":[]}',true,'TEST_'||p_test_run_id::text,'TST','PUBLISHED','fixture');
 perform support_vnext_shadow.refresh_draft_release_content_hash(r.release_id,'fixture'); update support_vnext_shadow.support_ruleset_release set status='APPROVED' where release_id=r.release_id; perform support_vnext_shadow.publish_ruleset_release(r.release_id,'fixture');
 insert into support_vnext_shadow.conversation_sessions(session_id,conversation_id,release_id,last_inbound_at) values(r.session_id,r.conversation_id,r.release_id,now());
 insert into support_vnext_shadow.conversation_topics(topic_id,session_id,intent_id,service_id) values(r.topic_id,r.session_id,r.intent_id,r.service_id);
 plan:=jsonb_build_object('schema_version','1.0','decision_id',r.decision_id,'correlation_id',extensions.gen_random_uuid(),'release_id',r.release_id,'state_version',1,'outcome','PERMITTED','actions',jsonb_build_array('SOLICITAR_CONFIRMACAO'),'response_plan',null,'state_patch',jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array()),'request_plan',jsonb_build_object('mode','PROPOSE','request_policy_id',r.request_policy_id,'subject_template_id',r.template_id,'proposal_field_values',case when p_complaint then jsonb_build_object('relato','teste','attachment_ids',jsonb_build_array(extensions.gen_random_uuid()::text)) else '{}'::jsonb end,'document_ids','[]'::jsonb,'confirmation_required',true),'document_plan',null,'handoff_plan',null,'reason_codes',jsonb_build_array('TEST'),'validation_requirements','{}'::jsonb,'expires_at',now()+interval '5 minutes');
 perform support_vnext_shadow.store_shadow_decision(plan,r.session_id,r.topic_id); proposal:=support_vnext_shadow.propose_request_transaction(r.decision_id,'fixture'); r.confirmation_id:=(proposal->>'confirmation_id')::uuid; r.confirmation_nonce:=(proposal->>'confirmation_nonce')::uuid;
 if not p_prepare_evidence then
   insert into support_vnext_test.confirmation_fixture_context select r.*;
   return r;
 end if;
 perform support_vnext_test.persist_test_inbound_classification(r.classification_id,r.inbound_message_id,r.confirmation_id,r.session_id,r.topic_id,r.release_id);
 auth:=support_vnext_shadow.authorize_persisted_confirmation(r.classification_id,r.confirmation_id,r.confirmation_nonce,r.inbound_message_id,r.session_id,r.topic_id,r.release_id); r.authorization_id:=(auth->>'authorization_id')::uuid;
 insert into support_vnext_test.confirmation_fixture_context select r.*; return r;
end $$;
