-- FASE 5B.2-C3. Local shadow package only. Do not execute before independent review.
begin;

-- A persisted classifier result is immutable evidence; authorization may only reference it.
alter table support_vnext_shadow.inbound_classifications
  alter column confirmation_id drop not null,
  add column if not exists classification_status text not null default 'OK'
    check (classification_status in ('OK','AMBIGUOUS','BLOCKED')),
  add column if not exists source text not null default 'DETERMINISTIC'
    check (source in ('DETERMINISTIC')),
  add column if not exists consumed_at timestamptz null,
  add column if not exists consumed_by_request_id uuid null;
alter table support_vnext_shadow.inbound_classifications
  drop constraint if exists inbound_classifications_classification_code_check,
  add constraint inbound_classifications_classification_code_check check (classification_code in ('CONFIRMATION_AFFIRMATIVE','OTHER'));

alter table support_vnext_shadow.confirmation_authorizations
  alter column classification_id set not null;

create unique index if not exists inbound_classification_confirmation_uq
  on support_vnext_shadow.inbound_classifications(confirmation_id)
  where classification_code = 'CONFIRMATION_AFFIRMATIVE' and classification_status = 'OK';

create or replace function support_vnext_shadow.persist_inbound_classification(
  p_classification_id uuid, p_inbound_message_id uuid, p_session_id uuid, p_topic_id uuid,
  p_release_id uuid, p_classification_code text, p_classification_status text, p_source text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; h char(64);
begin
  if p_classification_code not in ('CONFIRMATION_AFFIRMATIVE','OTHER')
     or p_classification_status not in ('OK','AMBIGUOUS','BLOCKED') or p_source <> 'DETERMINISTIC' then
    raise exception 'invalid classifier evidence' using errcode='22023';
  end if;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if s.session_id is null or t.topic_id is null or s.release_id<>p_release_id or t.session_id<>p_session_id or s.status='CLOSED' then
    raise exception 'classification state/release mismatch' using errcode='22023';
  end if;
  h:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object(
    'classification_id',p_classification_id,'inbound_message_id',p_inbound_message_id,
    'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,
    'classification_code',p_classification_code,'classification_status',p_classification_status,'source',p_source));
  insert into support_vnext_shadow.inbound_classifications(
    classification_id,inbound_message_id,confirmation_id,session_id,topic_id,release_id,
    classification_code,classification_status,source,classification_hash
  ) values (
    p_classification_id,p_inbound_message_id,null,p_session_id,p_topic_id,p_release_id,
    p_classification_code,p_classification_status,p_source,h
  );
  return jsonb_build_object('classification_id',p_classification_id,'classification_hash',h,'status','PERSISTED');
end $$;

-- The classifier creates confirmation evidence only when a pending confirmation is present.
create or replace function support_vnext_shadow.persist_confirmation_classification(
  p_classification_id uuid,p_confirmation_id uuid,p_inbound_message_id uuid,p_session_id uuid,
  p_topic_id uuid,p_release_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare c support_vnext_shadow.pending_confirmations; s support_vnext_shadow.conversation_sessions;
        t support_vnext_shadow.conversation_topics; h char(64);
begin
  select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id for share;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if c.confirmation_id is null or s.session_id is null or t.topic_id is null or c.status<>'PENDING' or c.expires_at<=now() or c.session_id<>p_session_id
     or c.topic_id<>p_topic_id or c.release_id<>p_release_id or s.status='CLOSED' or t.session_id<>p_session_id then
    raise exception 'invalid pending confirmation for classifier evidence' using errcode='22023';
  end if;
  h:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object(
    'classification_id',p_classification_id,'inbound_message_id',p_inbound_message_id,
    'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,
    'classification_code','CONFIRMATION_AFFIRMATIVE','classification_status','OK','source','DETERMINISTIC'));
  insert into support_vnext_shadow.inbound_classifications(
    classification_id,inbound_message_id,confirmation_id,session_id,topic_id,release_id,
    classification_code,classification_status,source,classification_hash
  ) values (p_classification_id,p_inbound_message_id,p_confirmation_id,p_session_id,p_topic_id,p_release_id,
    'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC',h);
  return jsonb_build_object('classification_id',p_classification_id,'classification_hash',h,'status','PERSISTED');
end $$;

create or replace function support_vnext_shadow.authorize_persisted_confirmation(
  p_classification_id uuid,p_confirmation_id uuid,p_confirmation_nonce uuid,p_inbound_message_id uuid,
  p_session_id uuid,p_topic_id uuid,p_release_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare c support_vnext_shadow.pending_confirmations; cl support_vnext_shadow.inbound_classifications; a uuid:=extensions.gen_random_uuid();
begin
  select * into c from support_vnext_shadow.pending_confirmations
    where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
  select * into cl from support_vnext_shadow.inbound_classifications where classification_id=p_classification_id for update;
  if c.confirmation_id is null or cl.classification_id is null or c.status<>'PENDING' or c.expires_at<=now() or cl.classification_code<>'CONFIRMATION_AFFIRMATIVE'
     or cl.classification_status<>'OK' or cl.consumed_at is not null or cl.confirmation_id<>c.confirmation_id
     or cl.inbound_message_id<>p_inbound_message_id or cl.session_id<>p_session_id or cl.topic_id<>p_topic_id
     or cl.release_id<>p_release_id or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id then
    raise exception 'classification cannot authorize confirmation' using errcode='22023';
  end if;
  insert into support_vnext_shadow.confirmation_authorizations(
    authorization_id,confirmation_id,inbound_message_id,session_id,topic_id,release_id,
    classification_hash,classification_code,classification_id
  ) values (a,c.confirmation_id,p_inbound_message_id,p_session_id,p_topic_id,p_release_id,
    cl.classification_hash,'CONFIRMATION_AFFIRMATIVE',cl.classification_id);
  return jsonb_build_object('authorization_id',a,'classification_id',cl.classification_id,'classification_hash',cl.classification_hash,'status','AUTHORIZED');
end $$;

-- Final confirmation requires the exact classification evidence and consumes both records atomically.
create or replace function support_vnext_shadow.confirm_request_transaction(
  p_confirmation_id uuid,p_confirmation_nonce uuid,p_classification_id uuid,p_inbound_message_id uuid,p_actor text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare c support_vnext_shadow.pending_confirmations; a support_vnext_shadow.confirmation_authorizations;
  cl support_vnext_shadow.inbound_classifications; s support_vnext_shadow.conversation_sessions;
  t support_vnext_shadow.conversation_topics; pol support_vnext_shadow.decision_request_policy;
  existing support_vnext_shadow.service_requests; computed char(64); ikey char(64); rid uuid:=extensions.gen_random_uuid(); next_value bigint; protocol_value text;
begin
  if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
  select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
  if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
  if c.status='CONSUMED' and c.request_id is not null then
    select * into existing from support_vnext_shadow.service_requests where request_id=c.request_id;
    return jsonb_build_object('outcome','ALREADY_CONFIRMED','request_id',existing.request_id,'protocol',existing.protocol);
  end if;
  select * into a from support_vnext_shadow.confirmation_authorizations where confirmation_id=c.confirmation_id and classification_id=p_classification_id and inbound_message_id=p_inbound_message_id and consumed_at is null for update;
  select * into cl from support_vnext_shadow.inbound_classifications where classification_id=p_classification_id for update;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=c.session_id for update;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=c.topic_id for update;
  select * into pol from support_vnext_shadow.decision_request_policy where request_policy_id=c.request_policy_id for share;
  computed:=support_vnext_shadow.canonical_jsonb_sha256(c.proposal_snapshot);
  if not found or a.authorization_id is null or cl.classification_id is null or cl.consumed_at is not null
     or cl.classification_code<>'CONFIRMATION_AFFIRMATIVE' or cl.classification_status<>'OK'
     or cl.confirmation_id<>c.confirmation_id or cl.inbound_message_id<>p_inbound_message_id
     or cl.session_id<>c.session_id or cl.topic_id<>c.topic_id or cl.release_id<>c.release_id
     or c.status<>'PENDING' or c.expires_at<=now() or c.proposal_hash<>computed or s.status='CLOSED'
     or s.state_version<>c.expected_state_version or t.topic_version<>c.expected_topic_version
     or pol.release_id<>c.release_id or pol.record_status<>'PUBLISHED' or not pol.allow_create
     or not pol.confirmation_required or not support_vnext_shadow.release_is_runtime_usable(c.release_id,now()) then
    return jsonb_build_object('outcome','REJECTED');
  end if;
  ikey:=encode(extensions.digest(c.session_id::text||':'||c.topic_id::text||':'||c.confirmation_nonce::text||':'||c.proposal_hash,'sha256'),'hex')::char(64);
  select * into existing from support_vnext_shadow.service_requests where idempotency_key=ikey for update;
  if found then
    update support_vnext_shadow.pending_confirmations set status='CONSUMED',request_id=existing.request_id,confirmed_inbound_message_id=p_inbound_message_id,consumed_at=now() where confirmation_id=c.confirmation_id;
    update support_vnext_shadow.confirmation_authorizations set consumed_at=now(),consumed_by_request_id=existing.request_id where authorization_id=a.authorization_id;
    update support_vnext_shadow.inbound_classifications set status='CONSUMED',consumed_at=now(),consumed_by_request_id=existing.request_id where classification_id=cl.classification_id;
    return jsonb_build_object('outcome','ALREADY_CONFIRMED','request_id',existing.request_id,'protocol',existing.protocol);
  end if;
  if coalesce(btrim(pol.protocol_scope),'')='' or coalesce(btrim(pol.protocol_prefix),'')='' then return jsonb_build_object('outcome','INVALID_PROTOCOL_POLICY'); end if;
  insert into support_vnext_shadow.service_requests(request_id,confirmation_id,conversation_id,session_id,topic_id,release_id,category_code,subject,request_payload,idempotency_key,status,created_by)
    values(rid,c.confirmation_id,c.conversation_id,c.session_id,c.topic_id,c.release_id,c.proposal_snapshot->>'category_code',c.proposal_snapshot->>'subject',coalesce(c.proposal_snapshot->'fields','{}'::jsonb),ikey,'OPEN',p_actor);
  insert into support_vnext_shadow.protocol_sequences(sequence_scope,current_value) values(pol.protocol_scope,1)
    on conflict(sequence_scope) do update set current_value=support_vnext_shadow.protocol_sequences.current_value+1,updated_at=now() returning current_value into next_value;
  protocol_value:=pol.protocol_prefix||'-'||lpad(next_value::text,8,'0');
  update support_vnext_shadow.service_requests set protocol=protocol_value,protocol_issued_at=now() where request_id=rid;
  update support_vnext_shadow.pending_confirmations set status='CONSUMED',request_id=rid,confirmed_inbound_message_id=p_inbound_message_id,consumed_at=now() where confirmation_id=c.confirmation_id;
  update support_vnext_shadow.confirmation_authorizations set consumed_at=now(),consumed_by_request_id=rid where authorization_id=a.authorization_id;
  update support_vnext_shadow.inbound_classifications set status='CONSUMED',consumed_at=now(),consumed_by_request_id=rid where classification_id=cl.classification_id;
  return jsonb_build_object('outcome','CONFIRMED','request_id',rid,'protocol',protocol_value);
end $$;

-- A closed plan references release-owned records only; no administrative literal is accepted.
create or replace function support_vnext_shadow.closed_object(p jsonb,p_keys text[]) returns boolean language sql immutable as $$
  select jsonb_typeof(p)='object' and not exists(select 1 from jsonb_object_keys(p) k where not(k=any(p_keys))) $$;
create or replace function support_vnext_shadow.valid_decision_plan(p jsonb) returns boolean language sql immutable as $$
 select support_vnext_shadow.closed_object(p,array['schema_version','decision_id','correlation_id','release_id','state_version','outcome','actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements','a_confirmar_restrictions','expires_at'])
 and p->>'schema_version'='1.0' and p->>'outcome' in ('PERMITTED','BLOCKED','A_CONFIRMAR')
 and jsonb_typeof(p->'actions')='array' and jsonb_typeof(p->'reason_codes')='array'
 and support_vnext_shadow.closed_object(p->'state_patch',array['expected_state_version','operations'])
 and jsonb_typeof(p->'state_patch'->'operations')='array'
 and support_vnext_shadow.closed_object(p->'validation_requirements',array['session_must_be_active','topic_id','expected_topic_version','human_must_be_inactive','confirmation_nonce_required','required_document_ids','provider_delivery_required'])
 and (coalesce(p->'response_plan','null'::jsonb)='null'::jsonb or (support_vnext_shadow.closed_object(p->'response_plan',array['mode','template_id','template_variables','allowed_fact_refs','asset_ids','question','max_questions']) and p->'response_plan'->>'mode' in ('DETERMINISTIC','FIELD_TEMPLATE')))
 and (coalesce(p->'request_plan','null'::jsonb)='null'::jsonb or (support_vnext_shadow.closed_object(p->'request_plan',array['mode','request_policy_id','subject_template_id','proposal_field_values','document_ids','confirmation_required']) and p->'request_plan'->>'mode' in ('NONE','PROPOSE')))
 and (coalesce(p->'document_plan','null'::jsonb)='null'::jsonb or support_vnext_shadow.closed_object(p->'document_plan',array['mode','requirement_ids','asset_ids','human_review_required']))
 and (coalesce(p->'handoff_plan','null'::jsonb)='null'::jsonb or support_vnext_shadow.closed_object(p->'handoff_plan',array['mode','handoff_policy_id','reason_code','queue_code','pause_bot']))
 and case when p->>'outcome'='A_CONFIRMAR' then coalesce(p->'response_plan','null'::jsonb)='null'::jsonb and coalesce(p->'request_plan','null'::jsonb)='null'::jsonb and coalesce(p->'document_plan','null'::jsonb)='null'::jsonb and coalesce(p->'handoff_plan','null'::jsonb)='null'::jsonb and not ((p->'actions') ?| array['CRIAR_SOLICITACAO','SOLICITAR_CONFIRMACAO','ENVIAR_DOCUMENTO','TRANSFERIR_HUMANO']) else true end $$;

create or replace function support_vnext_shadow.validate_decision_rule_shape() returns trigger
language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
begin
 if jsonb_typeof(new.when_expression)<>'object' or not support_vnext_shadow.closed_object(new.when_expression,array['intent_code','service_code','location_type','message_role','requires_pending_confirmation'])
    or jsonb_typeof(new.then_plan)<>'object' or not support_vnext_shadow.valid_decision_plan(new.then_plan) then
   raise exception 'decision rule uses invalid closed schema' using errcode='22023';
 end if;
 return new;
end $$;

-- Request subject is resolved from a published template, never from a caller supplied string.
create or replace function support_vnext_shadow.propose_request_transaction(p_decision_id uuid,p_actor text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare d support_vnext_shadow.decision_plans; s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; pol support_vnext_shadow.decision_request_policy; tpl support_vnext_shadow.knowledge_message_template; snapshot jsonb; seconds integer; cid uuid:=extensions.gen_random_uuid(); nonce uuid:=extensions.gen_random_uuid(); proposal_hash char(64);
begin
 select * into d from support_vnext_shadow.decision_plans where decision_id=p_decision_id for update;
 if not found or d.outcome<>'PERMITTED' or d.expires_at<=now() or d.plan#>>'{request_plan,mode}'<>'PROPOSE' then raise exception 'Decision cannot propose a request' using errcode='22023'; end if;
 select * into s from support_vnext_shadow.conversation_sessions where session_id=d.session_id for update; select * into t from support_vnext_shadow.conversation_topics where topic_id=d.topic_id for update;
 select * into pol from support_vnext_shadow.decision_request_policy where request_policy_id=(d.plan#>>'{request_plan,request_policy_id}')::uuid for share;
 if s.release_id<>d.release_id or s.state_version<>d.expected_state_version or t.session_id<>s.session_id or s.status='CLOSED' or pol.release_id<>d.release_id or pol.record_status<>'PUBLISHED' or not pol.allow_create or not pol.confirmation_required or not support_vnext_shadow.release_is_runtime_usable(d.release_id,now()) then raise exception 'Decision/state/policy is not actionable' using errcode='22023'; end if;
 select * into tpl from support_vnext_shadow.knowledge_message_template where template_id=pol.subject_template_id and release_id=d.release_id and record_status='PUBLISHED';
 if not found or tpl.render_mode not in ('DETERMINISTIC','FIELD_TEMPLATE') then raise exception 'Subject template is not actionable' using errcode='22023'; end if;
 seconds:=nullif(pol.confirmation_expiry_policy->>'seconds','')::integer; if seconds is null or seconds<60 or seconds>3600 then raise exception 'Published confirmation expiry policy is invalid' using errcode='22023'; end if;
 snapshot:=jsonb_build_object('release_id',d.release_id,'request_policy_id',pol.request_policy_id,'category_code',pol.request_category_code,'subject',tpl.body,'fields',coalesce(d.plan#>'{request_plan,proposal_field_values}','{}'::jsonb),'document_ids',coalesce(d.plan#>'{request_plan,document_ids}','[]'::jsonb));
 if pol.request_category_code='RECLAMACAO' and not support_vnext_shadow.valid_complaint_payload_strict(snapshot->'fields') then raise exception 'Complaint payload violates closed schema' using errcode='22023'; end if;
 proposal_hash:=support_vnext_shadow.canonical_jsonb_sha256(snapshot);
 insert into support_vnext_shadow.pending_confirmations(confirmation_id,confirmation_nonce,conversation_id,session_id,topic_id,release_id,request_policy_id,proposal_snapshot,proposal_hash,expires_at,expected_state_version,expected_topic_version,decision_id) values(cid,nonce,s.conversation_id,s.session_id,t.topic_id,d.release_id,pol.request_policy_id,snapshot,proposal_hash,now()+make_interval(secs=>seconds),s.state_version,t.topic_version,d.decision_id);
 return jsonb_build_object('confirmation_id',cid,'confirmation_nonce',nonce,'expires_at',now()+make_interval(secs=>seconds),'proposal_hash',proposal_hash);
end $$;

-- Restore strict publication and EXPLICIT_REBIND validation.
create or replace function support_vnext_shadow.transition_ruleset_release(p_release_id uuid,p_to_status support_vnext_shadow.ruleset_status,p_actor text,p_reason text default null,p_revocation_mode text default null,p_replacement_release_id uuid default null)
returns support_vnext_shadow.support_ruleset_release language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare r support_vnext_shadow.support_ruleset_release; replacement support_vnext_shadow.support_ruleset_release;
begin
 if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'PUBLISHED' or p_to_status not in ('SUPERSEDED','REVOKED') then raise exception 'invalid final transition' using errcode='55000'; end if;
 if p_to_status='REVOKED' then
   if coalesce(btrim(p_reason),'')='' or p_revocation_mode not in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW') then raise exception 'invalid revocation' using errcode='22023'; end if;
   if p_revocation_mode='EXPLICIT_REBIND' then
     select * into replacement from support_vnext_shadow.support_ruleset_release where release_id=p_replacement_release_id for share;
     if not found or replacement.release_id=r.release_id or replacement.scope_code<>r.scope_code or replacement.status<>'PUBLISHED' or replacement.revoked_at is not null or not support_vnext_shadow.release_is_runtime_usable(replacement.release_id,now()) then raise exception 'invalid replacement release' using errcode='22023'; end if;
   elsif p_replacement_release_id is not null then raise exception 'replacement only allowed for explicit rebind' using errcode='22023'; end if;
 end if;
 perform set_config('support_vnext_shadow.controlled_transition','yes',true);
 if p_to_status='REVOKED' then update support_vnext_shadow.support_ruleset_release set status='REVOKED',revoked_at=now(),revoked_by=p_actor,revocation_reason=p_reason,revocation_mode=p_revocation_mode,replacement_release_id=p_replacement_release_id,updated_by=p_actor where release_id=p_release_id returning * into r; else update support_vnext_shadow.support_ruleset_release set status='SUPERSEDED',updated_by=p_actor where release_id=p_release_id returning * into r; end if;
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,reason,content_hash) values(extensions.gen_random_uuid(),p_release_id,p_to_status::text,p_actor,p_reason,r.content_hash); return r;
end $$;

-- Session policy controls inactivity; server clock, locks, generation and outbox remain authoritative.
create or replace function support_vnext_shadow.schedule_inactivity_transaction_v2(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; pol support_vnext_shadow.decision_session_policy; g bigint; due timestamptz;
begin
 select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update;
 select * into pol from support_vnext_shadow.decision_session_policy where release_id=s.release_id and record_status='PUBLISHED' order by policy_code limit 1 for share;
 if not found then raise exception 'published session policy required' using errcode='22023'; end if;
 if s.status='CLOSED' or (pol.suppress_when_human_active and (s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.handoffs h where h.session_id=s.session_id and h.status='ACTIVE'))) or (pol.suppress_when_request_active and exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS'))) then return jsonb_build_object('status','SKIPPED'); end if;
 g:=s.inactivity_generation+1; due:=now()+make_interval(secs=>pol.warning_after_seconds);
 update support_vnext_shadow.inactivity_jobs set status='CANCELLED' where session_id=s.session_id and status='SCHEDULED'; update support_vnext_shadow.conversation_sessions set status='WARNING_PENDING',last_inbound_at=now(),warning_due_at=due,close_due_at=null,inactivity_generation=g,state_version=state_version+1 where session_id=s.session_id; insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,g,'WARNING',due); return jsonb_build_object('status','SCHEDULED','generation',g,'warning_due_at',due);
end $$;

create or replace function support_vnext_shadow.run_due_inactivity_jobs_v2(p_worker text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare j support_vnext_shadow.inactivity_jobs; s support_vnext_shadow.conversation_sessions; pol support_vnext_shadow.decision_session_policy; a jsonb:='[]'::jsonb;
begin
 for j in select * from support_vnext_shadow.inactivity_jobs where status='SCHEDULED' and due_at<=now() order by due_at limit greatest(1,least(coalesce(p_limit,50),200)) for update skip locked loop
  select * into s from support_vnext_shadow.conversation_sessions where session_id=j.session_id for update;
  select * into pol from support_vnext_shadow.decision_session_policy where release_id=s.release_id and record_status='PUBLISHED' order by policy_code limit 1 for share;
  if not found or j.generation<>s.inactivity_generation or s.status='CLOSED' or (pol.suppress_when_human_active and (s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.handoffs h where h.session_id=s.session_id and h.status='ACTIVE'))) or (pol.suppress_when_request_active and exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS'))) then update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','SKIPPED')); continue; end if;
  if j.job_type='WARNING' and s.status='WARNING_PENDING' then update support_vnext_shadow.conversation_sessions set status='WARNING_SENT',warning_sent_at=now(),close_due_at=now()+make_interval(secs=>pol.close_after_warning_seconds),state_version=state_version+1 where session_id=s.session_id; insert into support_vnext_shadow.inactivity_outbox(outbox_id,session_id,generation,kind,provider_window_open,status) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'INACTIVITY_WARNING',now()<=s.provider_window_expires_at,'PENDING') on conflict(session_id,generation,kind) do nothing; insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'CLOSE',now()+make_interval(secs=>pol.close_after_warning_seconds)) on conflict(session_id,generation,job_type) do nothing; update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','WARNING_OUTBOXED')); elsif j.job_type='CLOSE' and s.status='WARNING_SENT' then update support_vnext_shadow.conversation_sessions set status='CLOSED',closed_at=now(),close_reason='INACTIVITY_SILENT',close_due_at=null,state_version=state_version+1 where session_id=s.session_id; update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','CLOSED_SILENTLY')); else update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; end if;
 end loop; return a;
end $$;

-- Explicit, least-privilege capabilities. A deployment operator grants membership outside runtime.
revoke all on function support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function support_vnext_shadow.publish_ruleset_release(uuid,text),support_vnext_shadow.transition_ruleset_release(uuid,support_vnext_shadow.ruleset_status,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function support_vnext_shadow.publish_ruleset_release(uuid,text),support_vnext_shadow.transition_ruleset_release(uuid,support_vnext_shadow.ruleset_status,text,text,text,uuid) to support_vnext_publisher;
commit;
