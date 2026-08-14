-- C4-R6C: explicit presence/type checks make every decision validator fail closed.
begin;

create or replace function support_vnext_shadow.valid_scalar_value(p jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(p) in ('string','number','boolean','null'), false)
$$;

create or replace function support_vnext_shadow.valid_template_variables(p jsonb)
returns boolean language plpgsql immutable as $$
declare x record;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for x in select key, value from jsonb_each(p) loop
    if x.key !~ '^[a-z][a-z0-9_]{0,63}$'
       or x.key = any(array['severity','gravidade','priority','sector','setor','assigned_sector','external_route','ouvidoria','email','automatic_email','admin_decision'])
       or jsonb_typeof(x.value) not in ('string','number','boolean') then return false; end if;
  end loop;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_fact_refs(p jsonb)
returns boolean language plpgsql immutable as $$
declare x jsonb;
begin
  if jsonb_typeof(p) <> 'array' then return false; end if;
  for x in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'object' or not support_vnext_shadow.closed_object(x,array['type','id'])
       or not (x ? 'type') or not (x ? 'id')
       or jsonb_typeof(x->'type') <> 'string' or jsonb_typeof(x->'id') <> 'string'
       or not coalesce(x->>'type' in ('PRICE','DOCUMENT','HOURS','CONDITION','MESSAGE','ASSET'),false)
       or not coalesce(support_vnext_shadow.is_uuid_text(x->>'id'),false) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_question_schema(p jsonb)
returns boolean language plpgsql immutable as $$
declare s jsonb; e jsonb;
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['question_code','expected_answer_schema'])
     or not (p ? 'question_code') or not (p ? 'expected_answer_schema')
     or jsonb_typeof(p->'question_code') <> 'string' or p->>'question_code' !~ '^[A-Z][A-Z0-9_]{0,63}$' then return false; end if;
  s := p->'expected_answer_schema';
  if jsonb_typeof(s) <> 'object' or not support_vnext_shadow.closed_object(s,array['type','minimum','maximum','enum'])
     or not (s ? 'type') or jsonb_typeof(s->'type') <> 'string' or s->>'type' <> 'integer' then return false; end if;
  if s ? 'minimum' and jsonb_typeof(s->'minimum') <> 'number' then return false; end if;
  if s ? 'maximum' and jsonb_typeof(s->'maximum') <> 'number' then return false; end if;
  if s ? 'enum' then
    if jsonb_typeof(s->'enum') <> 'array' then return false; end if;
    for e in select value from jsonb_array_elements(s->'enum') loop
      if jsonb_typeof(e) <> 'number' or e #>> '{}' !~ '^-?[0-9]+$' then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_plan_field_values(p jsonb)
returns boolean language plpgsql immutable as $$
declare x record; a jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for x in select key,value from jsonb_each(p) loop
    if x.key !~ '^[a-z][a-z0-9_]{0,63}$'
       or x.key = any(array['subject','category','category_code','sector','setor','severity','gravidade','priority','external_route']) then return false; end if;
    if support_vnext_shadow.valid_scalar_value(x.value) then continue; end if;
    if jsonb_typeof(x.value) <> 'array' then return false; end if;
    for a in select value from jsonb_array_elements(x.value) loop
      if jsonb_typeof(a) <> 'string' or not coalesce(support_vnext_shadow.is_uuid_text(a #>> '{}'),false) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_state_patch_operation(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not (p ? 'op') or jsonb_typeof(p->'op') <> 'string' then return false; end if;
  case p->>'op'
    when 'CREATE_SESSION' then return support_vnext_shadow.closed_object(p,array['op','session_id','release_id']) and p ?& array['session_id','release_id'] and jsonb_typeof(p->'session_id')='string' and jsonb_typeof(p->'release_id')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'session_id'),false) and coalesce(support_vnext_shadow.is_uuid_text(p->>'release_id'),false);
    when 'CREATE_TOPIC' then return support_vnext_shadow.closed_object(p,array['op','topic_id','intent_code','service_code']) and p ?& array['topic_id','intent_code'] and jsonb_typeof(p->'topic_id')='string' and jsonb_typeof(p->'intent_code')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false) and p->>'intent_code' ~ '^[A-Z][A-Z0-9_]{0,63}$' and (not (p ? 'service_code') or (jsonb_typeof(p->'service_code')='string' and p->>'service_code' ~ '^[A-Z][A-Z0-9_]{0,63}$'));
    when 'SET_TOPIC_STATUS' then return support_vnext_shadow.closed_object(p,array['op','topic_id','status']) and p ?& array['topic_id','status'] and jsonb_typeof(p->'topic_id')='string' and jsonb_typeof(p->'status')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false) and coalesce(p->>'status' in ('ACTIVE','WAITING_INPUT','WAITING_DOCUMENT','WAITING_CONFIRMATION','WAITING_HUMAN','READY_FOR_REVIEW','SCHEDULE_REQUIRED','COMPLETED','BLOCKED','A_CONFIRMAR','CANCELLED'),false);
    when 'SET_PENDING_QUESTION' then return support_vnext_shadow.closed_object(p,array['op','topic_id','question_code']) and p ?& array['topic_id','question_code'] and jsonb_typeof(p->'topic_id')='string' and jsonb_typeof(p->'question_code')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false) and p->>'question_code' ~ '^[A-Z][A-Z0-9_]{0,63}$';
    when 'CLEAR_PENDING_QUESTION' then return support_vnext_shadow.closed_object(p,array['op','topic_id']) and p ? 'topic_id' and jsonb_typeof(p->'topic_id')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false);
    when 'MERGE_COLLECTED_DATA' then return support_vnext_shadow.closed_object(p,array['op','topic_id','allowed_fields']) and p ?& array['topic_id','allowed_fields'] and jsonb_typeof(p->'topic_id')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false) and support_vnext_shadow.valid_plan_field_values(p->'allowed_fields');
    when 'SET_AUTOMATION_MODE' then return support_vnext_shadow.closed_object(p,array['op','mode']) and p ? 'mode' and jsonb_typeof(p->'mode')='string' and coalesce(p->>'mode' in ('BOT_ACTIVE','HUMAN_ACTIVE'),false);
    when 'SCHEDULE_INACTIVITY', 'CANCEL_INACTIVITY' then return support_vnext_shadow.closed_object(p,array['op','session_id']) and p ? 'session_id' and jsonb_typeof(p->'session_id')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'session_id'),false);
    when 'CLOSE_SESSION' then return support_vnext_shadow.closed_object(p,array['op','session_id','reason']) and p ?& array['session_id','reason'] and jsonb_typeof(p->'session_id')='string' and jsonb_typeof(p->'reason')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'session_id'),false) and p->>'reason' ~ '^[A-Z][A-Z0-9_]{0,63}$';
    else return false;
  end case;
end $$;

create or replace function support_vnext_shadow.valid_state_patch(p jsonb)
returns boolean language plpgsql immutable as $$
declare x jsonb;
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['expected_state_version','operations'])
     or not (p ?& array['expected_state_version','operations']) or jsonb_typeof(p->'expected_state_version') <> 'number'
     or p->>'expected_state_version' !~ '^[0-9]+$' or jsonb_typeof(p->'operations') <> 'array' then return false; end if;
  for x in select value from jsonb_array_elements(p->'operations') loop
    if support_vnext_shadow.valid_state_patch_operation(x) is not true then return false; end if;
  end loop;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_response_plan(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['mode','template_id','template_variables','allowed_fact_refs','asset_ids','question','max_questions'])
     or not (p ? 'mode') or jsonb_typeof(p->'mode') <> 'string' or not coalesce(p->>'mode' in ('DETERMINISTIC','FIELD_TEMPLATE','GEMINI'),false) then return false; end if;
  if p ? 'template_id' and (jsonb_typeof(p->'template_id') <> 'string' or not coalesce(support_vnext_shadow.is_uuid_text(p->>'template_id'),false)) then return false; end if;
  if p ? 'template_variables' and support_vnext_shadow.valid_template_variables(p->'template_variables') is not true then return false; end if;
  if p ? 'allowed_fact_refs' and support_vnext_shadow.valid_fact_refs(p->'allowed_fact_refs') is not true then return false; end if;
  if p ? 'asset_ids' and support_vnext_shadow.json_uuid_array(p->'asset_ids') is not true then return false; end if;
  if p ? 'question' and support_vnext_shadow.valid_question_schema(p->'question') is not true then return false; end if;
  if p ? 'max_questions' and (jsonb_typeof(p->'max_questions') <> 'number' or p->>'max_questions' not in ('0','1')) then return false; end if;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_request_plan(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['mode','request_policy_id','subject_template_id','proposal_field_values','document_ids','confirmation_required'])
     or not (p ? 'mode') or jsonb_typeof(p->'mode') <> 'string' then return false; end if;
  if p->>'mode'='NONE' then return not (p ?| array['request_policy_id','subject_template_id','proposal_field_values','document_ids','confirmation_required']); end if;
  return p->>'mode'='PROPOSE' and p ?& array['request_policy_id','subject_template_id','proposal_field_values','confirmation_required']
    and jsonb_typeof(p->'request_policy_id')='string' and jsonb_typeof(p->'subject_template_id')='string'
    and coalesce(support_vnext_shadow.is_uuid_text(p->>'request_policy_id'),false) and coalesce(support_vnext_shadow.is_uuid_text(p->>'subject_template_id'),false)
    and support_vnext_shadow.valid_plan_field_values(p->'proposal_field_values') is true
    and jsonb_typeof(p->'confirmation_required')='boolean' and p->'confirmation_required'='true'::jsonb
    and (not (p ? 'document_ids') or support_vnext_shadow.json_uuid_array(p->'document_ids') is true);
end $$;

create or replace function support_vnext_shadow.valid_document_plan(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['mode','requirement_ids','asset_ids','human_review_required'])
     or not (p ? 'mode') or jsonb_typeof(p->'mode') <> 'string' or not coalesce(p->>'mode' in ('NONE','REQUEST','ACCEPT','SEND'),false) then return false; end if;
  return (not (p ? 'requirement_ids') or support_vnext_shadow.json_uuid_array(p->'requirement_ids') is true)
     and (not (p ? 'asset_ids') or support_vnext_shadow.json_uuid_array(p->'asset_ids') is true)
     and (not (p ? 'human_review_required') or jsonb_typeof(p->'human_review_required')='boolean');
end $$;

create or replace function support_vnext_shadow.valid_handoff_plan(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['mode','handoff_policy_id','reason_code','queue_code','pause_bot'])
     or not (p ? 'mode') or jsonb_typeof(p->'mode') <> 'string' then return false; end if;
  if p->>'mode'='NONE' then return not (p ?| array['handoff_policy_id','reason_code','queue_code','pause_bot']); end if;
  return p->>'mode' in ('PROPOSE','ACTIVATE') and p ?& array['handoff_policy_id','reason_code','pause_bot']
    and jsonb_typeof(p->'handoff_policy_id')='string' and jsonb_typeof(p->'reason_code')='string' and jsonb_typeof(p->'pause_bot')='boolean'
    and coalesce(support_vnext_shadow.is_uuid_text(p->>'handoff_policy_id'),false) and p->>'reason_code' ~ '^[A-Z][A-Z0-9_]{0,63}$'
    and (not (p ? 'queue_code') or jsonb_typeof(p->'queue_code') in ('string','null'));
end $$;

create or replace function support_vnext_shadow.valid_validation_requirements(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['session_must_be_active','topic_id','expected_topic_version','human_must_be_inactive','confirmation_nonce_required','required_document_ids','provider_delivery_required','idempotency_key']) then return false; end if;
  return (not (p ? 'session_must_be_active') or jsonb_typeof(p->'session_must_be_active')='boolean')
    and (not (p ? 'human_must_be_inactive') or jsonb_typeof(p->'human_must_be_inactive')='boolean')
    and (not (p ? 'confirmation_nonce_required') or jsonb_typeof(p->'confirmation_nonce_required')='boolean')
    and (not (p ? 'provider_delivery_required') or jsonb_typeof(p->'provider_delivery_required')='boolean')
    and (not (p ? 'required_document_ids') or support_vnext_shadow.json_uuid_array(p->'required_document_ids') is true)
    and (not (p ? 'topic_id') or (jsonb_typeof(p->'topic_id')='string' and coalesce(support_vnext_shadow.is_uuid_text(p->>'topic_id'),false)))
    and (not (p ? 'expected_topic_version') or (jsonb_typeof(p->'expected_topic_version')='number' and p->>'expected_topic_version' ~ '^[0-9]+$'))
    and (not (p ? 'idempotency_key') or (jsonb_typeof(p->'idempotency_key')='string' and p->>'idempotency_key' ~ '^[A-Za-z0-9._:-]{1,128}$'));
end $$;

create or replace function support_vnext_shadow.valid_decision_plan(p jsonb)
returns boolean language plpgsql immutable as $$
declare x jsonb;
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['schema_version','decision_id','correlation_id','release_id','state_version','outcome','actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements','a_confirmar_restrictions','expires_at'])
     or not (p ?& array['schema_version','outcome','actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements'])
     or jsonb_typeof(p->'schema_version') <> 'string' or p->>'schema_version' <> '1.0'
     or jsonb_typeof(p->'outcome') <> 'string' or not coalesce(p->>'outcome' in ('PERMITTED','BLOCKED','A_CONFIRMAR'),false)
     or support_vnext_shadow.json_array_of_strings(p->'actions') is not true
     or support_vnext_shadow.json_array_of_strings(p->'reason_codes') is not true
     or support_vnext_shadow.valid_state_patch(p->'state_patch') is not true
     or support_vnext_shadow.valid_validation_requirements(p->'validation_requirements') is not true then return false; end if;
  for x in select value from jsonb_array_elements(p->'actions') loop
    if x #>> '{}' not in ('RESPONDER','FAZER_PERGUNTA','ENVIAR_DOCUMENTO','SOLICITAR_CONFIRMACAO','CRIAR_SOLICITACAO','TRANSFERIR_HUMANO','AGUARDAR_DOCUMENTO','ENCERRAR','NAO_RESPONDER_SEM_CONFIRMACAO') then return false; end if;
  end loop;
  for x in select value from jsonb_array_elements(p->'reason_codes') loop
    if x #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,63}$' then return false; end if;
  end loop;
  if p ? 'release_id' and (jsonb_typeof(p->'release_id')<>'string' or not coalesce(support_vnext_shadow.is_uuid_text(p->>'release_id'),false)) then return false; end if;
  if p ? 'decision_id' and (jsonb_typeof(p->'decision_id')<>'string' or not coalesce(support_vnext_shadow.is_uuid_text(p->>'decision_id'),false)) then return false; end if;
  if p ? 'correlation_id' and (jsonb_typeof(p->'correlation_id')<>'string' or not coalesce(support_vnext_shadow.is_uuid_text(p->>'correlation_id'),false)) then return false; end if;
  if p ? 'state_version' and (jsonb_typeof(p->'state_version')<>'number' or p->>'state_version' !~ '^[0-9]+$') then return false; end if;
  if p ? 'expires_at' and (jsonb_typeof(p->'expires_at')<>'string' or not coalesce(support_vnext_shadow.is_timestamptz_text(p->>'expires_at'),false)) then return false; end if;
  if p->'response_plan' <> 'null'::jsonb and support_vnext_shadow.valid_response_plan(p->'response_plan') is not true then return false; end if;
  if p->'request_plan' <> 'null'::jsonb and support_vnext_shadow.valid_request_plan(p->'request_plan') is not true then return false; end if;
  if p->'document_plan' <> 'null'::jsonb and support_vnext_shadow.valid_document_plan(p->'document_plan') is not true then return false; end if;
  if p->'handoff_plan' <> 'null'::jsonb and support_vnext_shadow.valid_handoff_plan(p->'handoff_plan') is not true then return false; end if;
  if p ? 'a_confirmar_restrictions' then
    if support_vnext_shadow.json_array_of_strings(p->'a_confirmar_restrictions') is not true then return false; end if;
    for x in select value from jsonb_array_elements(p->'a_confirmar_restrictions') loop
      if x #>> '{}' not in ('NO_PRICE','NO_DEADLINE','NO_SLA','NO_REQUIRED_DOCUMENT','NO_ADMINISTRATIVE_PROPOSAL','NO_LEGACY_FALLBACK') then return false; end if;
    end loop;
  end if;
  if p->>'outcome'='A_CONFIRMAR' and (p->'response_plan' <> 'null'::jsonb or p->'request_plan' <> 'null'::jsonb or p->'document_plan' <> 'null'::jsonb or p->'handoff_plan' <> 'null'::jsonb or (p->'actions') ?| array['CRIAR_SOLICITACAO','SOLICITAR_CONFIRMACAO','ENVIAR_DOCUMENTO','TRANSFERIR_HUMANO'] or support_vnext_shadow.json_has_forbidden_key(p)) then return false; end if;
  return true;
end $$;

create or replace function support_vnext_shadow.valid_decision_rule_when(p jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(p) <> 'object' or not support_vnext_shadow.closed_object(p,array['intent_code','service_code','location_type','message_role','requires_pending_confirmation']) then return false; end if;
  return (not (p ? 'intent_code') or (jsonb_typeof(p->'intent_code')='string' and p->>'intent_code' ~ '^[A-Z][A-Z0-9_]{0,63}$'))
    and (not (p ? 'service_code') or (jsonb_typeof(p->'service_code')='string' and p->>'service_code' ~ '^[A-Z][A-Z0-9_]{0,63}$'))
    and (not (p ? 'location_type') or (jsonb_typeof(p->'location_type')='string' and coalesce(p->>'location_type' in ('QUADRA_GERAL','JAZIGO','OSSUARIO'),false)))
    and (not (p ? 'message_role') or (jsonb_typeof(p->'message_role')='string' and coalesce(p->>'message_role' in ('UNKNOWN','CONFIRMATION_AFFIRMATIVE','CONFIRMATION_NEGATIVE','COMMAND','DOCUMENT_SUBMISSION','CONTINUATION','ANSWER_TO_PENDING_QUESTION','NEW_TOPIC','TOPIC_CHANGE'),false)))
    and (not (p ? 'requires_pending_confirmation') or jsonb_typeof(p->'requires_pending_confirmation')='boolean');
end $$;

create or replace function support_vnext_shadow.validate_decision_rule_shape()
returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
begin
  if support_vnext_shadow.valid_decision_rule_when(new.when_expression) is not true
     or support_vnext_shadow.valid_decision_plan(new.then_plan) is not true then
    raise exception 'decision rule uses invalid closed schema' using errcode='22023';
  end if;
  if new.then_plan ? 'release_id' and (new.then_plan->>'release_id')::uuid <> new.release_id then
    raise exception 'decision rule plan release mismatch' using errcode='22023';
  end if;
  return new;
end $$;

-- Scope coherence is independent of the plan validator; the previous synthetic
-- incomplete plan could itself become NULL under three-valued logic.
create or replace function support_vnext_shadow.validate_decision_rule_scope()
returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
declare ir uuid; sr uuid;
begin
  if new.scope_intent_id is not null then select release_id into ir from support_vnext_shadow.knowledge_intent where intent_id=new.scope_intent_id; end if;
  if new.scope_service_id is not null then select release_id into sr from support_vnext_shadow.knowledge_service where service_id=new.scope_service_id; end if;
  if (new.scope_intent_id is not null and ir is distinct from new.release_id)
     or (new.scope_service_id is not null and sr is distinct from new.release_id) then
    raise exception 'invalid rule scope' using errcode='22023';
  end if;
  return new;
end $$;

commit;
