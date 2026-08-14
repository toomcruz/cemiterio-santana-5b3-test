-- FASE 5B.2-C — runtime restricted to explicit RPCs. NÃO EXECUTAR.
begin;

create or replace function support_vnext_shadow.resolve_shadow_session(
  p_conversation_id uuid, p_scope_code text, p_requested_session_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
declare s support_vnext_shadow.conversation_sessions; r support_vnext_shadow.support_ruleset_release; sid uuid;
begin
  if coalesce(btrim(p_scope_code),'')='' then raise exception 'Scope required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('support_vnext_shadow:conversation:' || p_conversation_id::text,0));
  select * into s from support_vnext_shadow.conversation_sessions where conversation_id=p_conversation_id and status<>'CLOSED' order by opened_at desc limit 1 for update;
  if found then
    select * into r from support_vnext_shadow.support_ruleset_release where release_id=s.release_id;
    if r.status='REVOKED' or r.revoked_at is not null then
      return jsonb_build_object('status','REVOKED','session',to_jsonb(s),'release',to_jsonb(r),'blocking_reason',r.revocation_mode);
    end if;
    return jsonb_build_object('status','SESSION_PINNED','session',to_jsonb(s),'release',to_jsonb(r));
  end if;
  select * into r from support_vnext_shadow.support_ruleset_release
   where scope_code=p_scope_code and support_vnext_shadow.release_is_runtime_usable(release_id,now())
   order by effective_from desc limit 1 for share;
  if not found then return jsonb_build_object('status','NOT_FOUND','blocking_reason','NO_PUBLISHED_EFFECTIVE_RELEASE'); end if;
  sid:=coalesce(p_requested_session_id,extensions.gen_random_uuid());
  insert into support_vnext_shadow.conversation_sessions(session_id,conversation_id,release_id,status,automation_mode,last_inbound_at)
  values(sid,p_conversation_id,r.release_id,'ACTIVE','BOT_ACTIVE',now())
  on conflict (conversation_id) where (status <> 'CLOSED') do nothing;
  select * into s from support_vnext_shadow.conversation_sessions where conversation_id=p_conversation_id and status<>'CLOSED' order by opened_at desc limit 1;
  if s.release_id <> r.release_id then
    select * into r from support_vnext_shadow.support_ruleset_release where release_id=s.release_id;
    return jsonb_build_object('status','SESSION_PINNED','session',to_jsonb(s),'release',to_jsonb(r));
  end if;
  return jsonb_build_object('status','SESSION_PINNED','session',to_jsonb(s),'release',to_jsonb(r));
end $$;

create or replace function support_vnext_shadow.get_runtime_decision_rules(
  p_release_id uuid, p_intent_code text, p_service_code text, p_location_type text
) returns jsonb
language sql security definer set search_path=support_vnext_shadow,pg_catalog as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.priority,x.rule_code),'[]'::jsonb)
  from (
    select r.* from support_vnext_shadow.decision_rule r
    left join support_vnext_shadow.knowledge_intent i on i.intent_id=r.scope_intent_id
    left join support_vnext_shadow.knowledge_service s on s.service_id=r.scope_service_id
    where r.release_id=p_release_id and r.enabled and r.record_status='PUBLISHED'
      and support_vnext_shadow.release_is_runtime_usable(p_release_id,now())
      and (r.scope_intent_id is null or i.intent_code=p_intent_code)
      and (r.scope_service_id is null or s.service_code=p_service_code)
      and (r.scope_location_type is null or r.scope_location_type=p_location_type)
  ) x
$$;

create or replace function support_vnext_shadow.store_shadow_decision(p_plan jsonb, p_session_id uuid, p_topic_id uuid)
returns uuid
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog as $$
declare p_release uuid; p_decision uuid; p_state bigint;
begin
  p_release:=(p_plan->>'release_id')::uuid; p_decision:=(p_plan->>'decision_id')::uuid; p_state:=(p_plan->>'state_version')::bigint;
  if not support_vnext_shadow.release_is_runtime_usable(p_release,now()) and p_plan->>'outcome' <> 'A_CONFIRMAR' then raise exception 'Release unavailable for permitted decision' using errcode='22023'; end if;
  insert into support_vnext_shadow.decision_plans(decision_id,correlation_id,release_id,session_id,topic_id,expected_state_version,outcome,actions,plan,expires_at)
  values(p_decision,(p_plan->>'correlation_id')::uuid,p_release,p_session_id,p_topic_id,p_state,p_plan->>'outcome',coalesce(array(select jsonb_array_elements_text(p_plan->'actions')),'{}'),p_plan,(p_plan->>'expires_at')::timestamptz);
  return p_decision;
end $$;

create or replace function support_vnext_shadow.append_shadow_audit_event(p_event jsonb)
returns void
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
begin
  if jsonb_typeof(p_event)<>'object' or support_vnext_shadow.jsonb_contains_forbidden_key(p_event,array['message','body','attachment','authorization','secret','token','phone','document_content']) then
    raise exception 'Unsafe audit payload' using errcode='22023';
  end if;
  insert into support_vnext_shadow.state_events(event_id,correlation_id,component,component_version,event_type,outcome,actor_type,conversation_id,session_id,topic_id,release_id,decision_id,metadata_redacted,payload_hash)
  values(extensions.gen_random_uuid(),(p_event->>'correlation_id')::uuid,p_event->>'component',p_event->>'component_version',p_event->>'event_type',p_event->>'outcome',p_event->>'actor_type',nullif(p_event->>'conversation_id','')::uuid,nullif(p_event->>'session_id','')::uuid,nullif(p_event->>'topic_id','')::uuid,nullif(p_event->>'release_id','')::uuid,nullif(p_event->>'decision_id','')::uuid,coalesce(p_event->'metadata_redacted','{}'::jsonb),nullif(p_event->>'payload_hash','')::char(64));
end $$;

create or replace function support_vnext_shadow.record_shadow_comparison(p_input jsonb)
returns uuid
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
declare cid uuid:=extensions.gen_random_uuid();
begin
  if support_vnext_shadow.jsonb_contains_forbidden_key(p_input,array['message','body','prompt','attachment','phone','email','document_content']) then raise exception 'Unsafe shadow summary' using errcode='22023'; end if;
  insert into support_vnext_shadow.shadow_comparisons(comparison_id,correlation_id,conversation_id,session_id,release_id,legacy_summary,new_summary,difference_codes,review_status)
  values(cid,(p_input->>'correlation_id')::uuid,nullif(p_input->>'conversation_id','')::uuid,nullif(p_input->>'session_id','')::uuid,nullif(p_input->>'release_id','')::uuid,coalesce(p_input->'legacy','{}'::jsonb),coalesce(p_input->'new_summary','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(p_input->'difference_codes')),'{}'),case when coalesce(jsonb_array_length(p_input->'difference_codes'),0)=0 then 'MATCH' else 'PENDING' end);
  return cid;
end $$;

create or replace function support_vnext_shadow.authorize_confirmation_inbound(
  p_confirmation_id uuid, p_confirmation_nonce uuid, p_inbound_message_id uuid,
  p_session_id uuid, p_topic_id uuid, p_release_id uuid, p_classification_hash char(64)
) returns jsonb
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
declare c support_vnext_shadow.pending_confirmations; s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; aid uuid:=extensions.gen_random_uuid();
begin
  select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for update;
  if not found or c.status<>'PENDING' or c.expires_at<=now() or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id or s.status='CLOSED' or t.session_id<>p_session_id or not support_vnext_shadow.release_is_runtime_usable(c.release_id,now()) then raise exception 'Confirmation authorization is not valid' using errcode='22023'; end if;
  insert into support_vnext_shadow.confirmation_authorizations(authorization_id,confirmation_id,inbound_message_id,session_id,topic_id,release_id,classification_hash,classification_code)
  values(aid,c.confirmation_id,p_inbound_message_id,p_session_id,p_topic_id,p_release_id,p_classification_hash,'CONFIRMATION_AFFIRMATIVE');
  return jsonb_build_object('authorization_id',aid,'confirmation_id',c.confirmation_id,'inbound_message_id',p_inbound_message_id,'authorized_at',now());
end $$;

create or replace function support_vnext_shadow.propose_request_transaction(p_decision_id uuid, p_actor text)
returns jsonb
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
declare d support_vnext_shadow.decision_plans; s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; pol support_vnext_shadow.decision_request_policy; tpl support_vnext_shadow.knowledge_message_template; snapshot jsonb; subject text; seconds integer; cid uuid:=extensions.gen_random_uuid(); nonce uuid:=extensions.gen_random_uuid(); proposal_hash char(64);
begin
  select * into d from support_vnext_shadow.decision_plans where decision_id=p_decision_id for update;
  if not found or d.outcome<>'PERMITTED' or d.expires_at<=now() or coalesce(d.plan#>>'{request_plan,mode}','NONE')<>'PROPOSE' then raise exception 'Decision cannot propose a request' using errcode='22023'; end if;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=d.session_id for update;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=d.topic_id for update;
  select * into pol from support_vnext_shadow.decision_request_policy where request_policy_id=(d.plan#>>'{request_plan,request_policy_id}')::uuid for share;
  if s.release_id<>d.release_id or s.state_version<>d.expected_state_version or t.session_id<>s.session_id or t.topic_version<>coalesce((d.plan#>>'{validation_requirements,expected_topic_version}')::bigint,t.topic_version) or s.status='CLOSED' or not support_vnext_shadow.release_is_runtime_usable(d.release_id,now()) or pol.release_id<>d.release_id or pol.record_status<>'PUBLISHED' or not pol.allow_create or not pol.confirmation_required then raise exception 'Decision/state/policy is not actionable' using errcode='22023'; end if;
  seconds:=nullif(pol.confirmation_expiry_policy->>'seconds','')::integer;
  if seconds is null or seconds<60 or seconds>3600 then raise exception 'Published confirmation expiry policy is invalid' using errcode='22023'; end if;
  select * into tpl from support_vnext_shadow.knowledge_message_template where template_id=pol.subject_template_id and release_id=d.release_id and record_status='PUBLISHED';
  if not found or tpl.render_mode not in ('DETERMINISTIC','FIELD_TEMPLATE') then raise exception 'Subject template is not actionable' using errcode='22023'; end if;
  subject:=coalesce(d.plan#>>'{request_plan,proposal_subject}','');
  if subject='' or subject<>tpl.body then raise exception 'Decision must contain the approved resolved subject' using errcode='22023'; end if;
  snapshot:=jsonb_build_object('release_id',d.release_id,'request_policy_id',pol.request_policy_id,'category_code',pol.request_category_code,'subject',subject,'fields',coalesce(d.plan#>'{request_plan,proposal_fields}','{}'::jsonb),'document_ids',coalesce(d.plan#>'{request_plan,document_ids}','[]'::jsonb));
  if pol.request_category_code='RECLAMACAO' and not support_vnext_shadow.valid_complaint_payload(snapshot->'fields') then raise exception 'Complaint payload violates closed schema' using errcode='22023'; end if;
  proposal_hash:=support_vnext_shadow.canonical_jsonb_sha256(snapshot);
  insert into support_vnext_shadow.pending_confirmations(confirmation_id,confirmation_nonce,conversation_id,session_id,topic_id,release_id,request_policy_id,proposal_snapshot,proposal_hash,expires_at,expected_state_version,expected_topic_version,decision_id)
  values(cid,nonce,s.conversation_id,s.session_id,t.topic_id,d.release_id,pol.request_policy_id,snapshot,proposal_hash,now()+make_interval(secs=>seconds),s.state_version,t.topic_version,d.decision_id);
  return jsonb_build_object('confirmation_id',cid,'confirmation_nonce',nonce,'expires_at',now()+make_interval(secs=>seconds),'proposal_hash',proposal_hash);
end $$;

create or replace function support_vnext_shadow.confirm_request_transaction(p_confirmation_id uuid,p_confirmation_nonce uuid,p_inbound_message_id uuid,p_actor text)
returns jsonb
language plpgsql security definer set search_path=support_vnext_shadow,pg_catalog,extensions as $$
declare c support_vnext_shadow.pending_confirmations; a support_vnext_shadow.confirmation_authorizations; s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; pol support_vnext_shadow.decision_request_policy; existing support_vnext_shadow.service_requests; computed char(64); ikey char(64); rid uuid:=extensions.gen_random_uuid(); next_value bigint; protocol_value text;
begin
  select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
  if not found then return jsonb_build_object('outcome','NOT_FOUND'); end if;
  if c.status='CONSUMED' and c.request_id is not null then select * into existing from support_vnext_shadow.service_requests where request_id=c.request_id; return jsonb_build_object('outcome','ALREADY_CONFIRMED','request_id',existing.request_id,'protocol',existing.protocol); end if;
  select * into a from support_vnext_shadow.confirmation_authorizations where confirmation_id=c.confirmation_id and inbound_message_id=p_inbound_message_id and consumed_at is null for update;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=c.session_id for update;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=c.topic_id for update;
  select * into pol from support_vnext_shadow.decision_request_policy where request_policy_id=c.request_policy_id for share;
  computed:=support_vnext_shadow.canonical_jsonb_sha256(c.proposal_snapshot);
  if not found or a.confirmation_id is null or c.status<>'PENDING' or c.expires_at<=now() or c.proposal_hash<>computed or s.status='CLOSED' or s.state_version<>c.expected_state_version or t.topic_version<>c.expected_topic_version or pol.release_id<>c.release_id or pol.record_status<>'PUBLISHED' or not pol.allow_create or not pol.confirmation_required or not support_vnext_shadow.release_is_runtime_usable(c.release_id,now()) then return jsonb_build_object('outcome','REJECTED'); end if;
  if coalesce(btrim(pol.protocol_scope),'')='' or coalesce(btrim(pol.protocol_prefix),'')='' then return jsonb_build_object('outcome','INVALID_PROTOCOL_POLICY'); end if;
  ikey:=encode(extensions.digest(c.session_id::text||':'||c.topic_id::text||':'||c.confirmation_nonce::text||':'||c.proposal_hash,'sha256'),'hex')::char(64);
  select * into existing from support_vnext_shadow.service_requests where idempotency_key=ikey for update;
  if found then update support_vnext_shadow.pending_confirmations set status='CONSUMED',request_id=existing.request_id,confirmed_inbound_message_id=p_inbound_message_id,consumed_at=now() where confirmation_id=c.confirmation_id; update support_vnext_shadow.confirmation_authorizations set consumed_at=now(),consumed_by_request_id=existing.request_id where authorization_id=a.authorization_id; return jsonb_build_object('outcome','ALREADY_CONFIRMED','request_id',existing.request_id,'protocol',existing.protocol); end if;
  insert into support_vnext_shadow.service_requests(request_id,confirmation_id,conversation_id,session_id,topic_id,release_id,category_code,subject,request_payload,idempotency_key,status,created_by) values(rid,c.confirmation_id,c.conversation_id,c.session_id,c.topic_id,c.release_id,c.proposal_snapshot->>'category_code',c.proposal_snapshot->>'subject',coalesce(c.proposal_snapshot->'fields','{}'::jsonb),ikey,'OPEN',p_actor);
  insert into support_vnext_shadow.protocol_sequences(sequence_scope,current_value) values(pol.protocol_scope,1) on conflict(sequence_scope) do update set current_value=support_vnext_shadow.protocol_sequences.current_value+1,updated_at=now() returning current_value into next_value;
  protocol_value:=pol.protocol_prefix||'-'||lpad(next_value::text,8,'0');
  update support_vnext_shadow.service_requests set protocol=protocol_value,protocol_issued_at=now() where request_id=rid;
  update support_vnext_shadow.pending_confirmations set status='CONSUMED',request_id=rid,confirmed_inbound_message_id=p_inbound_message_id,consumed_at=now() where confirmation_id=c.confirmation_id;
  update support_vnext_shadow.confirmation_authorizations set consumed_at=now(),consumed_by_request_id=rid where authorization_id=a.authorization_id;
  return jsonb_build_object('outcome','CONFIRMED','request_id',rid,'protocol',protocol_value);
end $$;

-- The 5B package has no runtime ENABLED mode and no direct table DML.
revoke all on all tables in schema support_vnext_shadow from service_role;
revoke all on all functions in schema support_vnext_shadow from public, anon, authenticated;
grant execute on function support_vnext_shadow.resolve_shadow_session(uuid,text,uuid) to service_role;
grant execute on function support_vnext_shadow.get_runtime_decision_rules(uuid,text,text,text) to service_role;
grant execute on function support_vnext_shadow.store_shadow_decision(jsonb,uuid,uuid) to service_role;
grant execute on function support_vnext_shadow.append_shadow_audit_event(jsonb) to service_role;
grant execute on function support_vnext_shadow.record_shadow_comparison(jsonb) to service_role;
grant execute on function support_vnext_shadow.authorize_confirmation_inbound(uuid,uuid,uuid,uuid,uuid,uuid,char(64)) to service_role;
grant execute on function support_vnext_shadow.propose_request_transaction(uuid,text) to service_role;
grant execute on function support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text) to service_role;

commit;
