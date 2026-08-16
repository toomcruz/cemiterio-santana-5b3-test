\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

-- Closed contract: expected signatures are static. pg_proc is observed only.
-- Resolving each expected text with to_regprocedure and comparing OIDs means a
-- new overload of a known name is still an unclassified physical function.
create temporary table p15_expected_functions (
  function_identity text primary key,
  classification text not null check (classification in ('RUNTIME_RPC','PUBLISHER_RPC','AUDIT_RPC','INTERNAL_HELPER','VALIDATOR','TRIGGER_FUNCTION')),
  expected_public boolean not null, expected_anon boolean not null,
  expected_authenticated boolean not null, expected_service_role boolean not null,
  expected_publisher boolean not null, expected_auditor boolean not null
) on commit drop;

insert into p15_expected_functions values
-- service_role runtime facades
('support_vnext_shadow.resolve_shadow_session(uuid,text,uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.get_runtime_decision_rules(uuid,text,text,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.store_shadow_decision(jsonb,uuid,uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.append_shadow_audit_event(jsonb)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.record_shadow_comparison(jsonb)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.propose_request_transaction(uuid,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.get_renderer_decision_context(uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.get_request_confirmation_status(uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.decline_request_transaction_v2(uuid,uuid,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.resolve_shadow_feature(text,jsonb)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.schedule_inactivity_transaction_v2(uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.cancel_inactivity_transaction_v2(uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.run_due_inactivity_jobs_v2(text,integer)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.classifier_assertion_material(uuid,char(64),uuid,uuid,uuid,uuid,text,text,text,uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','RUNTIME_RPC',false,false,false,true,false,false),
-- publisher capability facades
('support_vnext_shadow.publish_ruleset_release(uuid,text)','PUBLISHER_RPC',false,false,false,false,true,false),
('support_vnext_shadow.transition_ruleset_release(uuid,support_vnext_shadow.ruleset_status,text,text,text,uuid)','PUBLISHER_RPC',false,false,false,false,true,false),
('support_vnext_shadow.refresh_draft_release_content_hash(uuid,text)','PUBLISHER_RPC',false,false,false,false,true,false),
-- internal helpers
('support_vnext_shadow.authorize_confirmation_inbound(uuid,uuid,uuid,uuid,uuid,uuid,char(64))','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.canonical_jsonb_sha256(jsonb)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.compute_release_content_hash(uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.release_snapshot_json(uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.release_is_runtime_usable(uuid,timestamptz)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.resolve_published_release(text,timestamptz)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.explicit_rebind_session_release(uuid,uuid,uuid,text,text)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.decline_request_transaction(uuid,uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.schedule_inactivity_transaction(uuid,timestamptz)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.cancel_inactivity_transaction(uuid,timestamptz)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.claim_due_inactivity_jobs(timestamptz,text,integer)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.process_inactivity_job(uuid,timestamptz,text)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.resolve_session_policy_for_session(uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.closed_object(jsonb,text[])','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.json_array_of_strings(jsonb)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.json_uuid_array(jsonb)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.json_has_forbidden_key(jsonb)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.jsonb_contains_forbidden_key(jsonb,text[])','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.is_valid_uuid_string(text)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.is_uuid_text(text)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.is_timestamptz_text(text)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.validate_request_release_coherence()','TRIGGER_FUNCTION',false,false,false,false,false,false),
-- validators
('support_vnext_shadow.valid_complaint_payload(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_complaint_payload_strict(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_proposal_fields(jsonb,jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_scalar_value(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_template_variables(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_fact_refs(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_question_schema(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_plan_field_values(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_state_patch_operation(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_state_patch(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_response_plan(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_request_plan(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_document_plan(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_handoff_plan(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_validation_requirements(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_decision_plan(jsonb)','VALIDATOR',false,false,false,false,false,false),
('support_vnext_shadow.valid_decision_rule_when(jsonb)','VALIDATOR',false,false,false,false,false,false),
-- trigger functions
('support_vnext_shadow.touch_updated_at()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_published_content_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_published_release_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_confirmation_proposal_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_request_payload_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_state_event_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_request_policy_document_scope()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.guard_release_content_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.guard_release_transition()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.guard_published_source_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.prevent_published_source_mutation()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.guard_inbound_message_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.guard_inbound_classification_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow._allow_release_transition()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_decision_rule_shape()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_decision_rule_scope()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_topic_release_coherence()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_confirmation_release_coherence()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.validate_decision_release_coherence()','TRIGGER_FUNCTION',false,false,false,false,false,false),
-- 5B.4-B.2 (migration 0020): persistencia conversacional.
('support_vnext_shadow.conv_get_state(uuid)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.conv_apply_transition(uuid,bigint,jsonb,character)','RUNTIME_RPC',false,false,false,true,false,false),
('support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,character)','AUDIT_RPC',false,false,false,false,false,false),
('support_vnext_shadow.conv_rollback_to_seq(uuid,bigint,text,text)','AUDIT_RPC',false,false,false,false,false,false),
('support_vnext_shadow.conv_apply_ops(uuid,bigint,jsonb,boolean,uuid,text[])','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.conv_commit_transition(uuid,bigint,jsonb,character,support_vnext_shadow.conv_event_kind,boolean,uuid,text[])','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.conv_state_canonical(uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.conv_state_hash(uuid)','INTERNAL_HELPER',false,false,false,false,false,false),
('support_vnext_shadow.conv_events_append_only()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_facts_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_facts_case_coherence()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_cases_immutable()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_goals_transition_guard()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_goals_overlay_guard()','TRIGGER_FUNCTION',false,false,false,false,false,false),
('support_vnext_shadow.conv_question_stack_guard()','TRIGGER_FUNCTION',false,false,false,false,false,false);

do $$
declare f record; e record; r text; expected_execute boolean; expected_oid oid; table_name text;
  expected_tables text[] := array['support_ruleset_release','knowledge_source','knowledge_service','knowledge_intent','knowledge_condition','knowledge_asset','knowledge_document_requirement','knowledge_price','knowledge_hours','knowledge_hours_exception','knowledge_message_template','decision_handoff_policy','decision_request_policy','decision_sla_policy','decision_conversation_policy','decision_session_policy','decision_rule','conversation_sessions','session_release_transitions','conversation_topics','pending_questions','message_batches','received_documents','pending_confirmations','inbound_messages','inbound_classifications','confirmation_authorizations','service_requests','handoffs','inactivity_jobs','inactivity_outbox','state_events','decision_plans','protocol_sequences','feature_flags','feature_flag_targets','shadow_comparisons','classifier_authorities','ruleset_source_link','release_audit_events','conv_conversation_state','conv_cases','conv_goals','conv_facts','conv_fact_derivations','conv_question_stack','conv_pending_actions','conv_authoritative_signals','conv_events'];
begin
  perform pg_temp.assert_true(not has_schema_privilege('public','support_vnext_shadow','USAGE'),'P15 PUBLIC has no shadow schema usage');
  -- Expected-inexistent detection.
  for e in select * from p15_expected_functions loop
    expected_oid := to_regprocedure(e.function_identity);
    perform pg_temp.assert_true(expected_oid is not null,format('P15 expected function missing: %s',e.function_identity));
  end loop;
  -- All physical OIDs, including SECURITY DEFINER and INVOKER, must classify.
  for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='support_vnext_shadow' loop
    select * into e from p15_expected_functions where to_regprocedure(function_identity)=f.oid;
    perform pg_temp.assert_true(found,format('P15 unclassified function overload: %s',f.oid::regprocedure));
    if f.prosecdef then
      perform pg_temp.assert_true(f.proconfig is not null and exists(select 1 from unnest(f.proconfig) c where c like 'search_path=%'),format('P15 SECURITY DEFINER %s has safe search_path',f.oid::regprocedure));
    end if;
    foreach r in array array['public','anon','authenticated','service_role','support_vnext_publisher','support_vnext_auditor'] loop
      expected_execute := case r when 'public' then e.expected_public when 'anon' then e.expected_anon when 'authenticated' then e.expected_authenticated when 'service_role' then e.expected_service_role when 'support_vnext_publisher' then e.expected_publisher when 'support_vnext_auditor' then e.expected_auditor end;
      perform pg_temp.assert_true(has_function_privilege(r,f.oid,'EXECUTE')=expected_execute,format('P15 RPC matrix %s %s expected=%s',r,f.oid::regprocedure,expected_execute));
    end loop;
  end loop;
  -- Table matrix is static; the physical catalogue may not add a table silently.
  for table_name in select c.relname::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='support_vnext_shadow' and c.relkind in ('r','p') loop
    perform pg_temp.assert_true(table_name=any(expected_tables),format('P15 unclassified table %s',table_name));
  end loop;
  foreach r in array array['public','anon','authenticated','service_role','support_vnext_publisher','support_vnext_auditor'] loop
    foreach table_name in array expected_tables loop
      if to_regclass('support_vnext_shadow.'||table_name) is not null then
        perform pg_temp.assert_true(not has_table_privilege(r,'support_vnext_shadow.'||table_name,'SELECT'),format('P15 SELECT matrix %s %s',r,table_name));
        perform pg_temp.assert_true(not has_table_privilege(r,'support_vnext_shadow.'||table_name,'INSERT'),format('P15 INSERT matrix %s %s',r,table_name));
        perform pg_temp.assert_true(not has_table_privilege(r,'support_vnext_shadow.'||table_name,'UPDATE'),format('P15 UPDATE matrix %s %s',r,table_name));
        perform pg_temp.assert_true(not has_table_privilege(r,'support_vnext_shadow.'||table_name,'DELETE'),format('P15 DELETE matrix %s %s',r,table_name));
      end if;
    end loop;
  end loop;
end $$;

select pg_temp.assert_true(to_regprocedure('support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text)') is null,'P15 retired confirm overload absent');
select pg_temp.assert_true(to_regprocedure('support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid)') is null,'P15 retired inbound overload absent');
select pg_temp.assert_true(to_regprocedure('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text)') is null,'P15 retired classification overload absent');
select pg_temp.assert_true(to_regprocedure('support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid)') is null,'P15 retired persist_confirmation_classification wrapper absent');
\echo 'PASS P15 closed full-signature role, table, RPC, retired-overload and SECURITY DEFINER privilege matrix'
rollback;
