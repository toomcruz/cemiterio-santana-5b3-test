-- FASE 5B.1 rollback local. NÃO EXECUTAR SEM REVISÃO.
-- Não remove objetos legados. Esta reversão só é segura antes de releases publicadas ou solicitações vNext.

do $$
begin
  if exists (select 1 from support_vnext_shadow.support_ruleset_release where status in ('PUBLISHED','REVOKED','SUPERSEDED'))
     or exists (select 1 from support_vnext_shadow.service_requests)
     or exists (select 1 from support_vnext_shadow.state_events) then
    raise exception 'Rollback bloqueado: schema vNext contém histórico que deve ser preservado';
  end if;
end;
$$;

drop trigger if exists trg_ruleset_release_guard on support_vnext_shadow.support_ruleset_release;
drop trigger if exists trg_session_touch on support_vnext_shadow.conversation_sessions;
drop trigger if exists trg_confirmation_touch on support_vnext_shadow.pending_confirmations;
drop trigger if exists trg_request_touch on support_vnext_shadow.service_requests;
drop trigger if exists trg_job_touch on support_vnext_shadow.inactivity_jobs;
drop trigger if exists trg_confirmation_proposal_immutable on support_vnext_shadow.pending_confirmations;
drop trigger if exists trg_request_payload_immutable on support_vnext_shadow.service_requests;
drop trigger if exists trg_state_events_append_only on support_vnext_shadow.state_events;
drop trigger if exists trg_request_policy_document_scope on support_vnext_shadow.decision_request_policy;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'knowledge_service', 'knowledge_intent', 'knowledge_condition', 'knowledge_asset',
    'knowledge_document_requirement', 'knowledge_price', 'knowledge_hours', 'knowledge_hours_exception',
    'knowledge_message_template', 'decision_handoff_policy', 'decision_request_policy',
    'decision_sla_policy', 'decision_conversation_policy', 'decision_session_policy', 'decision_rule'
  ] loop
    execute format('drop trigger if exists %I on support_vnext_shadow.%I', 'trg_' || tbl || '_immutable', tbl);
  end loop;
  foreach tbl in array array[
    'support_ruleset_release', 'knowledge_source', 'knowledge_service', 'knowledge_intent',
    'knowledge_condition', 'knowledge_asset', 'knowledge_document_requirement', 'knowledge_price',
    'knowledge_hours', 'knowledge_hours_exception', 'knowledge_message_template',
    'decision_handoff_policy', 'decision_request_policy', 'decision_sla_policy',
    'decision_conversation_policy', 'decision_session_policy', 'decision_rule',
    'conversation_sessions', 'session_release_transitions', 'conversation_topics',
    'pending_questions', 'message_batches', 'received_documents', 'pending_confirmations',
    'service_requests', 'handoffs', 'inactivity_jobs', 'state_events', 'decision_plans',
    'protocol_sequences', 'feature_flags', 'feature_flag_targets', 'shadow_comparisons'
  ] loop
    execute format('drop policy if exists runtime_service_only on support_vnext_shadow.%I', tbl);
    execute format('alter table support_vnext_shadow.%I disable row level security', tbl);
  end loop;
end;
$$;

drop function if exists support_vnext_shadow.confirm_request_transaction(uuid, uuid, uuid, uuid, text, text, char(64), text);
drop function if exists support_vnext_shadow.propose_request_transaction(uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, char(64), timestamptz, bigint, bigint, uuid);
drop function if exists support_vnext_shadow.decline_request_transaction(uuid, uuid);
drop function if exists support_vnext_shadow.explicit_rebind_session_release(uuid, uuid, uuid, text, text);
drop function if exists support_vnext_shadow.process_inactivity_job(uuid, timestamptz, text);
drop function if exists support_vnext_shadow.claim_due_inactivity_jobs(timestamptz, text, integer);
drop function if exists support_vnext_shadow.cancel_inactivity_transaction(uuid, timestamptz);
drop function if exists support_vnext_shadow.schedule_inactivity_transaction(uuid, timestamptz);
drop function if exists support_vnext_shadow.resolve_published_release(text, timestamptz);
drop function if exists support_vnext_shadow.prevent_request_payload_mutation();
drop function if exists support_vnext_shadow.prevent_confirmation_proposal_mutation();
drop function if exists support_vnext_shadow.validate_request_policy_document_scope();
drop function if exists support_vnext_shadow.prevent_state_event_mutation();
drop function if exists support_vnext_shadow.prevent_published_release_mutation();
drop function if exists support_vnext_shadow.prevent_published_content_mutation();
drop function if exists support_vnext_shadow.touch_updated_at();
