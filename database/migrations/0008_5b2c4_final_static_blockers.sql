-- FASE 5B.2-C4. Artefato local; nunca executar antes da reauditoria independente.
begin;

-- C4-01: inbound é evidência independente. A classificação nunca é inventada pela autorização.
create table support_vnext_shadow.inbound_messages (
  inbound_message_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id) on delete restrict,
  topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id) on delete restrict,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id) on delete restrict,
  message_digest char(64) not null check (message_digest ~ '^[A-Fa-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  source text not null check (source='SHADOW_INBOUND'),
  unique (session_id, inbound_message_id)
);
alter table support_vnext_shadow.inbound_messages enable row level security;

alter table support_vnext_shadow.inbound_classifications
  add constraint inbound_classifications_inbound_fk foreign key (inbound_message_id)
  references support_vnext_shadow.inbound_messages(inbound_message_id) on delete restrict;

create or replace function support_vnext_shadow.persist_shadow_inbound_message(
  p_inbound_message_id uuid, p_session_id uuid, p_topic_id uuid, p_release_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; d char(64);
begin
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if s.session_id is null or t.topic_id is null or s.release_id<>p_release_id or t.session_id<>s.session_id or s.status='CLOSED' then
    raise exception 'inbound state/release mismatch' using errcode='22023';
  end if;
  d:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('inbound_message_id',p_inbound_message_id,'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id));
  insert into support_vnext_shadow.inbound_messages(inbound_message_id,session_id,topic_id,release_id,message_digest)
  values(p_inbound_message_id,p_session_id,p_topic_id,p_release_id,d)
  on conflict(inbound_message_id) do nothing;
  if not exists(select 1 from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id and session_id=p_session_id and topic_id=p_topic_id and release_id=p_release_id) then
    raise exception 'inbound id already belongs to different state' using errcode='22023';
  end if;
  return jsonb_build_object('inbound_message_id',p_inbound_message_id,'status','PERSISTED');
end $$;

-- Replace the C3 classifier persistence overload. It accepts a classifier result; it does not derive it.
drop function if exists support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid);
create or replace function support_vnext_shadow.persist_inbound_classification(
  p_classification_id uuid, p_inbound_message_id uuid, p_confirmation_id uuid, p_session_id uuid,
  p_topic_id uuid, p_release_id uuid, p_classification_code text, p_classification_status text, p_source text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics;
  i support_vnext_shadow.inbound_messages; c support_vnext_shadow.pending_confirmations; h char(64);
begin
  if p_classification_code not in ('CONFIRMATION_AFFIRMATIVE','OTHER') or p_classification_status not in ('OK','AMBIGUOUS','BLOCKED') or p_source<>'DETERMINISTIC' then
    raise exception 'invalid persisted classifier result' using errcode='22023';
  end if;
  select * into i from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id for share;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if i.inbound_message_id is null or s.session_id is null or t.topic_id is null or i.session_id<>p_session_id or i.topic_id<>p_topic_id or i.release_id<>p_release_id or s.release_id<>p_release_id or t.session_id<>p_session_id or s.status='CLOSED' then
    raise exception 'classification does not belong to persisted inbound/state' using errcode='22023';
  end if;
  if p_classification_code='CONFIRMATION_AFFIRMATIVE' then
    select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id for share;
    if c.confirmation_id is null or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id then raise exception 'affirmative classification confirmation mismatch' using errcode='22023'; end if;
  elsif p_confirmation_id is not null then raise exception 'non-confirmation classification cannot carry confirmation' using errcode='22023'; end if;
  h:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('classification_id',p_classification_id,'inbound_message_id',p_inbound_message_id,'confirmation_id',p_confirmation_id,'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,'classification_code',p_classification_code,'classification_status',p_classification_status,'source',p_source));
  insert into support_vnext_shadow.inbound_classifications(classification_id,inbound_message_id,confirmation_id,session_id,topic_id,release_id,classification_code,classification_status,source,classification_hash)
  values(p_classification_id,p_inbound_message_id,p_confirmation_id,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,p_source,h);
  return jsonb_build_object('classification_id',p_classification_id,'classification_hash',h,'status','PERSISTED');
end $$;

-- C4-02: remove the bypass overload, leaving only confirmation with classifier evidence.
revoke all on function support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,support_vnext_runtime;
drop function if exists support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text);

-- C4-03: deep closed schema helpers. JSON is permitted only in enumerated typed positions.
create or replace function support_vnext_shadow.json_array_of_strings(p jsonb) returns boolean language sql immutable as $$
  select jsonb_typeof(p)='array' and not exists(select 1 from jsonb_array_elements(p) e where jsonb_typeof(e)<>'string') $$;
create or replace function support_vnext_shadow.json_uuid_array(p jsonb) returns boolean language sql immutable as $$
  select support_vnext_shadow.json_array_of_strings(p) and not exists(select 1 from jsonb_array_elements_text(p) e where e !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') $$;
create or replace function support_vnext_shadow.json_has_forbidden_key(p jsonb) returns boolean
language plpgsql immutable as $$
declare k text; v jsonb;
begin
 if jsonb_typeof(p)='object' then
   for k,v in select key,value from jsonb_each(p) loop
     if lower(k) in ('price','amount','valor','taxa','deadline','prazo','sla','hours','horario','required_document','documento_obrigatorio','administrative_text','response_text','legacy_fallback','service_star') or support_vnext_shadow.json_has_forbidden_key(v) then return true; end if;
   end loop;
 elsif jsonb_typeof(p)='array' then
   for v in select value from jsonb_array_elements(p) loop if support_vnext_shadow.json_has_forbidden_key(v) then return true; end if; end loop;
 end if;
 return false;
end $$;
create or replace function support_vnext_shadow.valid_state_patch(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['expected_state_version','operations'])
 and jsonb_typeof(p->'expected_state_version')='number' and jsonb_typeof(p->'operations')='array'
 and not exists(select 1 from jsonb_array_elements(p->'operations') o where jsonb_typeof(o)<>'object' or not support_vnext_shadow.closed_object(o,array['op','topic_id','session_id','status','question_code','allowed_fields','mode']) or o->>'op' not in ('CREATE_TOPIC','SET_TOPIC_STATUS','SET_PENDING_QUESTION','CLEAR_PENDING_QUESTION','MERGE_COLLECTED_DATA','SET_AUTOMATION_MODE','SCHEDULE_INACTIVITY','CANCEL_INACTIVITY','CLOSE_SESSION')) $$;
create or replace function support_vnext_shadow.valid_response_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['mode','template_id','template_variables','allowed_fact_refs','asset_ids','question','max_questions'])
 and p->>'mode' in ('DETERMINISTIC','FIELD_TEMPLATE')
 and (p ? 'template_id') and (p->>'template_id') ~* '^[0-9a-f-]{36}$'
 and jsonb_typeof(coalesce(p->'template_variables','{}'::jsonb))='object'
 and support_vnext_shadow.json_uuid_array(coalesce(p->'asset_ids','[]'::jsonb))
 and jsonb_typeof(coalesce(p->'allowed_fact_refs','[]'::jsonb))='array' $$;
create or replace function support_vnext_shadow.valid_request_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['mode','request_policy_id','subject_template_id','proposal_field_values','document_ids','confirmation_required'])
 and p->>'mode' in ('NONE','PROPOSE') and ((p->>'mode'='NONE') or ((p->>'request_policy_id')~*'^[0-9a-f-]{36}$' and (p->>'subject_template_id')~*'^[0-9a-f-]{36}$' and jsonb_typeof(coalesce(p->'proposal_field_values','{}'::jsonb))='object' and support_vnext_shadow.json_uuid_array(coalesce(p->'document_ids','[]'::jsonb)) and p->'confirmation_required'='true'::jsonb)) $$;
create or replace function support_vnext_shadow.valid_document_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['mode','requirement_ids','asset_ids','human_review_required']) and p->>'mode' in ('NONE','REQUEST','ACCEPT','SEND') and support_vnext_shadow.json_uuid_array(coalesce(p->'requirement_ids','[]'::jsonb)) and support_vnext_shadow.json_uuid_array(coalesce(p->'asset_ids','[]'::jsonb)) and jsonb_typeof(coalesce(p->'human_review_required','false'::jsonb))='boolean' $$;
create or replace function support_vnext_shadow.valid_handoff_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['mode','handoff_policy_id','reason_code','queue_code','pause_bot']) and p->>'mode' in ('NONE','PROPOSE','ACTIVATE') and ((p->>'mode'='NONE') or ((p->>'handoff_policy_id')~*'^[0-9a-f-]{36}$' and jsonb_typeof(p->'pause_bot')='boolean')) $$;
create or replace function support_vnext_shadow.valid_decision_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['schema_version','decision_id','correlation_id','release_id','state_version','outcome','actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements','a_confirmar_restrictions','expires_at'])
 and p->>'schema_version'='1.0' and p->>'outcome' in ('PERMITTED','BLOCKED','A_CONFIRMAR') and (p->>'release_id')~*'^[0-9a-f-]{36}$'
 and support_vnext_shadow.json_array_of_strings(p->'actions') and not exists(select 1 from jsonb_array_elements_text(p->'actions') a where a not in ('RESPONDER','FAZER_PERGUNTA','ENVIAR_DOCUMENTO','SOLICITAR_CONFIRMACAO','CRIAR_SOLICITACAO','TRANSFERIR_HUMANO','AGUARDAR_DOCUMENTO','ENCERRAR','NAO_RESPONDER_SEM_CONFIRMACAO'))
 and support_vnext_shadow.json_array_of_strings(p->'reason_codes') and support_vnext_shadow.valid_state_patch(p->'state_patch')
 and support_vnext_shadow.closed_object(p->'validation_requirements',array['session_must_be_active','topic_id','expected_topic_version','human_must_be_inactive','confirmation_nonce_required','required_document_ids','provider_delivery_required'])
 and (p->'response_plan'='null'::jsonb or support_vnext_shadow.valid_response_plan(p->'response_plan'))
 and (p->'request_plan'='null'::jsonb or support_vnext_shadow.valid_request_plan(p->'request_plan'))
 and (p->'document_plan'='null'::jsonb or support_vnext_shadow.valid_document_plan(p->'document_plan'))
 and (p->'handoff_plan'='null'::jsonb or support_vnext_shadow.valid_handoff_plan(p->'handoff_plan'))
 and case when p->>'outcome'='A_CONFIRMAR' then p->'response_plan'='null'::jsonb and p->'request_plan'='null'::jsonb and p->'document_plan'='null'::jsonb and p->'handoff_plan'='null'::jsonb and not ((p->'actions') ?| array['CRIAR_SOLICITACAO','SOLICITAR_CONFIRMACAO','ENVIAR_DOCUMENTO','TRANSFERIR_HUMANO']) and not support_vnext_shadow.json_has_forbidden_key(p) else true end $$;

create or replace function support_vnext_shadow.valid_proposal_fields(p_fields jsonb,p_schema jsonb) returns boolean language plpgsql immutable as $$
declare k text; v jsonb; expected text;
begin
 if jsonb_typeof(p_fields)<>'object' or jsonb_typeof(p_schema)<>'object' or not support_vnext_shadow.closed_object(p_schema,array['properties','required']) or jsonb_typeof(coalesce(p_schema->'properties','{}'::jsonb))<>'object' or not support_vnext_shadow.json_array_of_strings(coalesce(p_schema->'required','[]'::jsonb)) then return false; end if;
 for k,v in select key,value from jsonb_each(p_fields) loop
   if not (p_schema->'properties' ? k) or k in ('subject','category','category_code','sector','setor','severity','gravidade') then return false; end if;
   expected:=p_schema#>>array['properties',k,'type'];
   if expected not in ('string','number','integer','boolean','null') or (expected='string' and jsonb_typeof(v)<>'string') or (expected='number' and jsonb_typeof(v)<>'number') or (expected='integer' and (jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^-?[0-9]+$')) or (expected='boolean' and jsonb_typeof(v)<>'boolean') or (expected='null' and v<>'null'::jsonb) then return false; end if;
 end loop;
 return not exists(select 1 from jsonb_array_elements_text(coalesce(p_schema->'required','[]'::jsonb)) r where not(p_fields ? r));
end $$;
create or replace function support_vnext_shadow.propose_request_transaction(p_decision_id uuid,p_actor text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare d support_vnext_shadow.decision_plans; s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; pol support_vnext_shadow.decision_request_policy; tpl support_vnext_shadow.knowledge_message_template; snapshot jsonb; seconds integer; cid uuid:=extensions.gen_random_uuid(); nonce uuid:=extensions.gen_random_uuid(); proposal_hash char(64); fields jsonb;
begin
 select * into d from support_vnext_shadow.decision_plans where decision_id=p_decision_id for update;
 if not found or d.outcome<>'PERMITTED' or d.expires_at<=now() or d.plan#>>'{request_plan,mode}'<>'PROPOSE' then raise exception 'decision cannot propose a request' using errcode='22023'; end if;
 select * into s from support_vnext_shadow.conversation_sessions where session_id=d.session_id for update; select * into t from support_vnext_shadow.conversation_topics where topic_id=d.topic_id for update;
 select * into pol from support_vnext_shadow.decision_request_policy where request_policy_id=(d.plan#>>'{request_plan,request_policy_id}')::uuid for share;
 fields:=coalesce(d.plan#>'{request_plan,proposal_field_values}','{}'::jsonb);
 if s.release_id<>d.release_id or s.state_version<>d.expected_state_version or t.session_id<>s.session_id or s.status='CLOSED' or pol.release_id<>d.release_id or pol.record_status<>'PUBLISHED' or not pol.allow_create or not pol.confirmation_required or not support_vnext_shadow.release_is_runtime_usable(d.release_id,now()) or not support_vnext_shadow.valid_proposal_fields(fields,pol.required_data_schema) then raise exception 'decision/state/policy fields are not actionable' using errcode='22023'; end if;
 select * into tpl from support_vnext_shadow.knowledge_message_template where template_id=pol.subject_template_id and release_id=d.release_id and record_status='PUBLISHED'; if not found or tpl.render_mode not in ('DETERMINISTIC','FIELD_TEMPLATE') then raise exception 'subject template is not actionable' using errcode='22023'; end if;
 seconds:=nullif(pol.confirmation_expiry_policy->>'seconds','')::integer; if seconds is null or seconds<60 or seconds>3600 then raise exception 'published confirmation expiry policy is invalid' using errcode='22023'; end if;
 snapshot:=jsonb_build_object('release_id',d.release_id,'request_policy_id',pol.request_policy_id,'category_code',pol.request_category_code,'subject',tpl.body,'fields',fields,'document_ids',coalesce(d.plan#>'{request_plan,document_ids}','[]'::jsonb));
 if pol.request_category_code='RECLAMACAO' and not support_vnext_shadow.valid_complaint_payload_strict(snapshot->'fields') then raise exception 'complaint payload violates closed schema' using errcode='22023'; end if;
 proposal_hash:=support_vnext_shadow.canonical_jsonb_sha256(snapshot);
 insert into support_vnext_shadow.pending_confirmations(confirmation_id,confirmation_nonce,conversation_id,session_id,topic_id,release_id,request_policy_id,proposal_snapshot,proposal_hash,expires_at,expected_state_version,expected_topic_version,decision_id) values(cid,nonce,s.conversation_id,s.session_id,t.topic_id,d.release_id,pol.request_policy_id,snapshot,proposal_hash,now()+make_interval(secs=>seconds),s.state_version,t.topic_version,d.decision_id);
 return jsonb_build_object('confirmation_id',cid,'confirmation_nonce',nonce,'expires_at',now()+make_interval(secs=>seconds),'proposal_hash',proposal_hash);
end $$;

-- Published source material itself is immutable once it is linked to a final release.
create or replace function support_vnext_shadow.guard_published_source_immutable() returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
declare sid uuid:=case when tg_op='DELETE' then old.source_id else new.source_id end;
begin
 if exists(select 1 from support_vnext_shadow.ruleset_source_link l join support_vnext_shadow.support_ruleset_release r on r.release_id=l.release_id where l.source_id=sid and r.status in ('PUBLISHED','SUPERSEDED','REVOKED')) then raise exception 'source linked to final release is immutable' using errcode='55000'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists trg_knowledge_source_final_immutable on support_vnext_shadow.knowledge_source;
create trigger trg_knowledge_source_final_immutable before update or delete on support_vnext_shadow.knowledge_source for each row execute function support_vnext_shadow.guard_published_source_immutable();

-- EXPLICIT_REBIND is atomic: the replacement is approved, hash-valid and becomes PUBLISHED in the same deferred-constraint transaction that revokes the old release. No committed overlap is possible.
alter table support_vnext_shadow.support_ruleset_release drop constraint support_ruleset_release_one_effective_published;
alter table support_vnext_shadow.support_ruleset_release add constraint support_ruleset_release_one_effective_published exclude using gist (scope_code with =,tstzrange(effective_from,coalesce(effective_to,'infinity'::timestamptz),'[)') with &&) where (status='PUBLISHED' and revoked_at is null) deferrable initially immediate;
create or replace function support_vnext_shadow.transition_ruleset_release(p_release_id uuid,p_to_status support_vnext_shadow.ruleset_status,p_actor text,p_reason text default null,p_revocation_mode text default null,p_replacement_release_id uuid default null)
returns support_vnext_shadow.support_ruleset_release language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare r support_vnext_shadow.support_ruleset_release; replacement support_vnext_shadow.support_ruleset_release; h char(64);
begin
 if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'PUBLISHED' or p_to_status not in ('SUPERSEDED','REVOKED') then raise exception 'invalid final transition' using errcode='55000'; end if;
 if p_to_status='REVOKED' then
   if coalesce(btrim(p_reason),'')='' or p_revocation_mode not in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW') then raise exception 'invalid revocation' using errcode='22023'; end if;
   if p_revocation_mode='EXPLICIT_REBIND' then
     select * into replacement from support_vnext_shadow.support_ruleset_release where release_id=p_replacement_release_id for update;
     if not found or replacement.release_id=r.release_id or replacement.scope_code<>r.scope_code or replacement.status<>'APPROVED' or replacement.approved_at is null or coalesce(btrim(replacement.approved_by),'')='' or not (replacement.effective_from<=now() and (replacement.effective_to is null or replacement.effective_to>now())) then raise exception 'invalid replacement release' using errcode='22023'; end if;
     h:=support_vnext_shadow.compute_release_content_hash(replacement.release_id); if h<>replacement.content_hash then raise exception 'replacement hash mismatch' using errcode='22023'; end if;
     perform pg_advisory_xact_lock(hashtextextended('support-vnext-scope:'||r.scope_code,0)); perform set_config('support_vnext_shadow.controlled_publish','yes',true); perform set_config('support_vnext_shadow.controlled_transition','yes',true); set constraints support_ruleset_release_one_effective_published deferred;
     update support_vnext_shadow.support_ruleset_release set status='PUBLISHED',published_at=now(),published_by=p_actor,updated_by=p_actor,row_version=row_version+1 where release_id=replacement.release_id;
   elsif p_replacement_release_id is not null then raise exception 'replacement only allowed for explicit rebind' using errcode='22023'; end if;
 end if;
 perform set_config('support_vnext_shadow.controlled_transition','yes',true);
 if p_to_status='REVOKED' then update support_vnext_shadow.support_ruleset_release set status='REVOKED',revoked_at=now(),revoked_by=p_actor,revocation_reason=p_reason,revocation_mode=p_revocation_mode,replacement_release_id=p_replacement_release_id,updated_by=p_actor where release_id=p_release_id returning * into r; else update support_vnext_shadow.support_ruleset_release set status='SUPERSEDED',updated_by=p_actor where release_id=p_release_id returning * into r; end if;
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,reason,content_hash) values(extensions.gen_random_uuid(),p_release_id,p_to_status::text,p_actor,p_reason,r.content_hash);
 return r;
end $$;

-- A session policy is resolved by the active topic's most-specific scope, never alphabetically.
alter table support_vnext_shadow.decision_session_policy
  add column if not exists scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  add column if not exists scope_location_type text null check (scope_location_type is null or scope_location_type in ('QUADRA_GERAL','JAZIGO','OSSUARIO')),
  add column if not exists priority integer not null default 0 check (priority >= 0);
create index if not exists decision_session_policy_resolution_idx on support_vnext_shadow.decision_session_policy(release_id,record_status,priority desc);
create or replace function support_vnext_shadow.resolve_session_policy_for_session(p_session_id uuid) returns support_vnext_shadow.decision_session_policy
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; p support_vnext_shadow.decision_session_policy; n integer;
begin
 select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
 select * into t from support_vnext_shadow.conversation_topics where session_id=p_session_id and status='ACTIVE' for share;
 if s.session_id is null or t.topic_id is null then raise exception 'active session/topic required for inactivity policy' using errcode='22023'; end if;
 select count(*) into n from support_vnext_shadow.decision_session_policy x where x.release_id=s.release_id and x.record_status='PUBLISHED'
   and (x.scope_service_id is null or x.scope_service_id=t.service_id) and (x.scope_intent_id is null or x.scope_intent_id=t.intent_id) and (x.scope_location_type is null or x.scope_location_type=t.location_type)
   and (select count(*) from support_vnext_shadow.decision_session_policy y where y.release_id=x.release_id and y.record_status='PUBLISHED' and (y.scope_service_id is null or y.scope_service_id=t.service_id) and (y.scope_intent_id is null or y.scope_intent_id=t.intent_id) and (y.scope_location_type is null or y.scope_location_type=t.location_type) and (y.priority > x.priority or (y.priority=x.priority and ((y.scope_service_id is not null)::int+(y.scope_intent_id is not null)::int+(y.scope_location_type is not null)::int) > ((x.scope_service_id is not null)::int+(x.scope_intent_id is not null)::int+(x.scope_location_type is not null)::int))))=0;
 if n<>1 then raise exception 'inactivity policy is ambiguous or absent' using errcode='22023'; end if;
 select * into p from support_vnext_shadow.decision_session_policy x where x.release_id=s.release_id and x.record_status='PUBLISHED' and (x.scope_service_id is null or x.scope_service_id=t.service_id) and (x.scope_intent_id is null or x.scope_intent_id=t.intent_id) and (x.scope_location_type is null or x.scope_location_type=t.location_type) order by x.priority desc,((x.scope_service_id is not null)::int+(x.scope_intent_id is not null)::int+(x.scope_location_type is not null)::int) desc limit 1;
 return p;
end $$;
create or replace function support_vnext_shadow.schedule_inactivity_transaction_v2(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; pol support_vnext_shadow.decision_session_policy; g bigint; due timestamptz;
begin
 select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update;
 pol:=support_vnext_shadow.resolve_session_policy_for_session(p_session_id);
 if s.status='CLOSED' or (pol.suppress_when_human_active and (s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.handoffs h where h.session_id=s.session_id and h.status='ACTIVE'))) or (pol.suppress_when_request_active and exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS'))) then return jsonb_build_object('status','SKIPPED'); end if;
 g:=s.inactivity_generation+1; due:=now()+make_interval(secs=>pol.warning_after_seconds);
 update support_vnext_shadow.inactivity_jobs set status='CANCELLED' where session_id=s.session_id and status='SCHEDULED';
 update support_vnext_shadow.conversation_sessions set status='WARNING_PENDING',last_inbound_at=now(),warning_due_at=due,close_due_at=null,inactivity_generation=g,state_version=state_version+1 where session_id=s.session_id;
 insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,g,'WARNING',due);
 return jsonb_build_object('status','SCHEDULED','generation',g,'warning_due_at',due);
end $$;
create or replace function support_vnext_shadow.run_due_inactivity_jobs_v2(p_worker text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare j support_vnext_shadow.inactivity_jobs; s support_vnext_shadow.conversation_sessions; pol support_vnext_shadow.decision_session_policy; a jsonb:='[]'::jsonb;
begin
 for j in select * from support_vnext_shadow.inactivity_jobs where status='SCHEDULED' and due_at<=now() order by due_at limit greatest(1,least(coalesce(p_limit,50),200)) for update skip locked loop
  select * into s from support_vnext_shadow.conversation_sessions where session_id=j.session_id for update;
  begin pol:=support_vnext_shadow.resolve_session_policy_for_session(s.session_id); exception when others then update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','POLICY_AMBIGUOUS')); continue; end;
  if j.generation<>s.inactivity_generation or s.status='CLOSED' or (pol.suppress_when_human_active and (s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.handoffs h where h.session_id=s.session_id and h.status='ACTIVE'))) or (pol.suppress_when_request_active and exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS'))) then update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','SKIPPED')); continue; end if;
  if j.job_type='WARNING' and s.status='WARNING_PENDING' then
    update support_vnext_shadow.conversation_sessions set status='WARNING_SENT',warning_sent_at=now(),close_due_at=now()+make_interval(secs=>pol.close_after_warning_seconds),state_version=state_version+1 where session_id=s.session_id;
    insert into support_vnext_shadow.inactivity_outbox(outbox_id,session_id,generation,kind,provider_window_open,status) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'INACTIVITY_WARNING',now()<=s.provider_window_expires_at,'PENDING') on conflict(session_id,generation,kind) do nothing;
    insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'CLOSE',now()+make_interval(secs=>pol.close_after_warning_seconds)) on conflict(session_id,generation,job_type) do nothing;
    update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','WARNING_OUTBOXED'));
  elsif j.job_type='CLOSE' and s.status='WARNING_SENT' then
    update support_vnext_shadow.conversation_sessions set status='CLOSED',closed_at=now(),close_reason='INACTIVITY_SILENT',close_due_at=null,state_version=state_version+1 where session_id=s.session_id;
    update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','CLOSED_SILENTLY'));
  else update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; end if;
 end loop;
 return a;
end $$;

-- The new RPC surface is explicit; all old overloads are removed from the runtime role.
revoke all on all functions in schema support_vnext_shadow from public,anon,authenticated;
grant execute on function support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid),support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text) to service_role;

commit;
