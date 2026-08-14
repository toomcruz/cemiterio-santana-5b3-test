-- FASE 5B.2-C2. Local only. Apply only after independent review in an isolated project.
begin;

-- Explicit no-login capability roles. Edge service_role receives runtime only.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='support_vnext_runtime') then create role support_vnext_runtime nologin noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='support_vnext_publisher') then create role support_vnext_publisher nologin noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='support_vnext_auditor') then create role support_vnext_auditor nologin noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='support_vnext_admin') then create role support_vnext_admin nologin noinherit; end if;
end $$;

-- All vNext tables, including objects added after 0002, receive deny-by-default RLS.
do $$ declare t text; begin
 foreach t in array array['ruleset_source_link','release_audit_events','confirmation_authorizations','inbound_classifications','inactivity_outbox'] loop
   if to_regclass('support_vnext_shadow.'||t) is not null then execute format('alter table support_vnext_shadow.%I enable row level security',t); end if;
 end loop;
end $$;

-- Published content is immutable for INSERT as well as UPDATE/DELETE.
create or replace function support_vnext_shadow.guard_release_content_immutable()
returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
declare rid uuid:=case when tg_op='DELETE' then old.release_id else new.release_id end; st support_vnext_shadow.ruleset_status;
begin select status into st from support_vnext_shadow.support_ruleset_release where release_id=rid;
 if st in ('PUBLISHED','SUPERSEDED','REVOKED') then raise exception 'Release content is immutable: %',rid using errcode='55000'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['knowledge_service','knowledge_intent','knowledge_condition','knowledge_asset','knowledge_document_requirement','knowledge_price','knowledge_hours','knowledge_hours_exception','knowledge_message_template','decision_handoff_policy','decision_request_policy','decision_sla_policy','decision_conversation_policy','decision_session_policy','decision_rule','ruleset_source_link'] loop
   execute format('drop trigger if exists %I on support_vnext_shadow.%I','trg_'||t||'_immutable',t);
   execute format('create trigger %I before insert or update or delete on support_vnext_shadow.%I for each row execute function support_vnext_shadow.guard_release_content_immutable()','trg_'||t||'_immutable',t);
 end loop;
end $$;

-- Only controlled SECURITY DEFINER RPC may turn a release into PUBLISHED.
create or replace function support_vnext_shadow.guard_release_transition()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' and old.status in ('PUBLISHED','SUPERSEDED','REVOKED') then raise exception 'Final release cannot be deleted' using errcode='55000'; end if;
 if tg_op='UPDATE' and new.status='PUBLISHED' and current_setting('support_vnext_shadow.controlled_publish',true) is distinct from 'yes' then raise exception 'Publication requires publish_ruleset_release' using errcode='55000'; end if;
 if tg_op='UPDATE' and old.status in ('PUBLISHED','SUPERSEDED','REVOKED') and current_setting('support_vnext_shadow.controlled_transition',true) is distinct from 'yes' then raise exception 'Final release requires controlled transition' using errcode='55000'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists trg_ruleset_release_guard on support_vnext_shadow.support_ruleset_release;
create trigger trg_ruleset_release_guard before update or delete on support_vnext_shadow.support_ruleset_release for each row execute function support_vnext_shadow.guard_release_transition();

create or replace function support_vnext_shadow.publish_ruleset_release(p_release_id uuid,p_actor text)
returns support_vnext_shadow.support_ruleset_release language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare r support_vnext_shadow.support_ruleset_release; h char(64);
begin
 if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'APPROVED' or r.approved_at is null or coalesce(btrim(r.approved_by),'')='' then raise exception 'release not approved' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support-vnext-scope:'||r.scope_code,0)); h:=support_vnext_shadow.compute_release_content_hash(r.release_id);
 if h<>r.content_hash then raise exception 'content hash mismatch' using errcode='22023'; end if;
 perform set_config('support_vnext_shadow.controlled_publish','yes',true);
 update support_vnext_shadow.support_ruleset_release set status='PUBLISHED',published_at=now(),published_by=p_actor,updated_by=p_actor,row_version=row_version+1 where release_id=r.release_id returning * into r;
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,content_hash) values(extensions.gen_random_uuid(),r.release_id,'PUBLISHED',p_actor,h);
 return r;
end $$;

create or replace function support_vnext_shadow.transition_ruleset_release(p_release_id uuid,p_to_status support_vnext_shadow.ruleset_status,p_actor text,p_reason text default null,p_revocation_mode text default null,p_replacement_release_id uuid default null)
returns support_vnext_shadow.support_ruleset_release language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare r support_vnext_shadow.support_ruleset_release;
begin select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'PUBLISHED' or p_to_status not in ('SUPERSEDED','REVOKED') then raise exception 'invalid final transition' using errcode='55000'; end if;
 if p_to_status='REVOKED' and (coalesce(btrim(p_reason),'')='' or p_revocation_mode not in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW')) then raise exception 'invalid revocation' using errcode='22023'; end if;
 perform set_config('support_vnext_shadow.controlled_transition','yes',true);
 if p_to_status='REVOKED' then update support_vnext_shadow.support_ruleset_release set status='REVOKED',revoked_at=now(),revoked_by=p_actor,revocation_reason=p_reason,revocation_mode=p_revocation_mode,replacement_release_id=p_replacement_release_id,updated_by=p_actor where release_id=p_release_id returning * into r;
 else update support_vnext_shadow.support_ruleset_release set status='SUPERSEDED',updated_by=p_actor where release_id=p_release_id returning * into r; end if;
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,reason,content_hash) values(extensions.gen_random_uuid(),p_release_id,p_to_status::text,p_actor,p_reason,r.content_hash);
 return r;
end $$;

-- Persisted classifier proof: caller never supplies the authoritative hash.
create table if not exists support_vnext_shadow.inbound_classifications (
 classification_id uuid primary key, inbound_message_id uuid not null unique, confirmation_id uuid not null references support_vnext_shadow.pending_confirmations(confirmation_id) on delete restrict,
 session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id), topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id), release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
 classification_code text not null check(classification_code='CONFIRMATION_AFFIRMATIVE'), classification_hash char(64) not null check(classification_hash~'^[A-Fa-f0-9]{64}$'), classified_at timestamptz not null default now(), status text not null default 'VALID' check(status in ('VALID','CONSUMED','REJECTED'))
);
alter table support_vnext_shadow.inbound_classifications enable row level security;
alter table support_vnext_shadow.confirmation_authorizations add column if not exists classification_id uuid references support_vnext_shadow.inbound_classifications(classification_id) on delete restrict;
create unique index if not exists confirmation_auth_classification_uq on support_vnext_shadow.confirmation_authorizations(classification_id);
create or replace function support_vnext_shadow.persist_confirmation_classification(p_confirmation_id uuid,p_confirmation_nonce uuid,p_inbound_message_id uuid,p_session_id uuid,p_topic_id uuid,p_release_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare c support_vnext_shadow.pending_confirmations; cid uuid:=extensions.gen_random_uuid(); h char(64); aid uuid:=extensions.gen_random_uuid();
begin select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
 if not found or c.status<>'PENDING' or c.expires_at<=now() or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id then raise exception 'invalid confirmation evidence' using errcode='22023'; end if;
 h:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('inbound_message_id',p_inbound_message_id,'confirmation_id',p_confirmation_id,'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,'classification_code','CONFIRMATION_AFFIRMATIVE'));
 insert into support_vnext_shadow.inbound_classifications(classification_id,inbound_message_id,confirmation_id,session_id,topic_id,release_id,classification_code,classification_hash) values(cid,p_inbound_message_id,p_confirmation_id,p_session_id,p_topic_id,p_release_id,'CONFIRMATION_AFFIRMATIVE',h);
 insert into support_vnext_shadow.confirmation_authorizations(authorization_id,confirmation_id,inbound_message_id,session_id,topic_id,release_id,classification_hash,classification_code,classification_id) values(aid,p_confirmation_id,p_inbound_message_id,p_session_id,p_topic_id,p_release_id,h,'CONFIRMATION_AFFIRMATIVE',cid);
 return jsonb_build_object('authorization_id',aid,'classification_id',cid,'classification_hash',h,'status','AUTHORIZED'); end $$;

-- Closed decision persistence. A_CONFIRMAR has no factual or administrative plan.
create or replace function support_vnext_shadow.valid_decision_plan(p jsonb) returns boolean language sql immutable as $$
 select jsonb_typeof(p)='object' and not exists(select 1 from jsonb_object_keys(p) k where k not in ('schema_version','decision_id','correlation_id','release_id','state_version','outcome','actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements','a_confirmar_restrictions','expires_at'))
 and case when p->>'outcome'='A_CONFIRMAR' then coalesce(p->'response_plan','null'::jsonb)='null'::jsonb and coalesce(p->'request_plan','null'::jsonb)='null'::jsonb and coalesce(p->'document_plan','null'::jsonb)='null'::jsonb and not ((p->'actions') ?| array['CRIAR_SOLICITACAO','SOLICITAR_CONFIRMACAO','ENVIAR_DOCUMENTO']) else true end $$;
create or replace function support_vnext_shadow.store_shadow_decision(p_plan jsonb,p_session_id uuid,p_topic_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare rid uuid:=(p_plan->>'release_id')::uuid; did uuid:=(p_plan->>'decision_id')::uuid; s support_vnext_shadow.conversation_sessions;
begin if not support_vnext_shadow.valid_decision_plan(p_plan) then raise exception 'invalid closed decision plan' using errcode='22023'; end if; select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update;
 if not found or s.release_id<>rid then raise exception 'decision release mismatch' using errcode='22023'; end if;
 insert into support_vnext_shadow.decision_plans(decision_id,correlation_id,release_id,session_id,topic_id,expected_state_version,outcome,actions,plan,expires_at) values(did,(p_plan->>'correlation_id')::uuid,rid,p_session_id,p_topic_id,(p_plan->>'state_version')::bigint,p_plan->>'outcome',coalesce(array(select jsonb_array_elements_text(p_plan->'actions')),'{}'),p_plan,(p_plan->>'expires_at')::timestamptz); return did; end $$;

-- Complete request coherence and release-safe rule scope.
create or replace function support_vnext_shadow.validate_request_release_coherence() returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
declare sr uuid; ts uuid; begin select release_id into sr from support_vnext_shadow.conversation_sessions where session_id=new.session_id; select session_id into ts from support_vnext_shadow.conversation_topics where topic_id=new.topic_id; if sr is distinct from new.release_id or ts is distinct from new.session_id then raise exception 'request release mismatch' using errcode='22023'; end if; return new; end $$;
create trigger trg_request_release_coherence before insert or update on support_vnext_shadow.service_requests for each row execute function support_vnext_shadow.validate_request_release_coherence();
create or replace function support_vnext_shadow.validate_decision_rule_scope() returns trigger language plpgsql security invoker set search_path=pg_catalog,support_vnext_shadow as $$
declare ir uuid; sr uuid; begin if new.scope_intent_id is not null then select release_id into ir from support_vnext_shadow.knowledge_intent where intent_id=new.scope_intent_id; end if; if new.scope_service_id is not null then select release_id into sr from support_vnext_shadow.knowledge_service where service_id=new.scope_service_id; end if; if (new.scope_intent_id is not null and ir is distinct from new.release_id) or (new.scope_service_id is not null and sr is distinct from new.release_id) or not support_vnext_shadow.valid_decision_plan(jsonb_build_object('outcome','A_CONFIRMAR','actions','[]'::jsonb)) then raise exception 'invalid rule scope' using errcode='22023'; end if; return new; end $$;
create trigger trg_decision_rule_scope before insert or update on support_vnext_shadow.decision_rule for each row execute function support_vnext_shadow.validate_decision_rule_scope();

-- Correct feature schema and deterministic precedence.
create or replace function support_vnext_shadow.resolve_shadow_feature(p_flag_key text,p_candidates jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare k boolean; resolved text;
begin select kill_switch into k from support_vnext_shadow.feature_flags where flag_key=p_flag_key; if coalesce(k,false) then return jsonb_build_object('mode','OFF','source','KILL_SWITCH'); end if;
 with c as (select value->>'target_type' typ,value->>'target_value' val from jsonb_array_elements(coalesce(p_candidates,'[]'::jsonb))), m as (select t.mode::text,case t.target_type when 'CONVERSATION_ID' then 1 when 'PHONE_HASH' then 2 when 'SERVICE_CODE' then 3 when 'COMPONENT' then 4 when 'RELEASE_ID' then 5 when 'GLOBAL' then 6 else 99 end p from support_vnext_shadow.feature_flag_targets t join c on c.typ=t.target_type and c.val=t.target_value where t.flag_key=p_flag_key and t.effective_from<=now() and (t.effective_to is null or t.effective_to>now()) order by p,t.effective_from desc limit 1) select coalesce((select mode from m),(select default_mode::text from support_vnext_shadow.feature_flags where flag_key=p_flag_key),'OFF') into resolved;
 return jsonb_build_object('mode',case when resolved='SHADOW_ONLY' then 'SHADOW_ONLY' else 'OFF' end); end $$;

-- Server-clock inactivity with persisted outbox; delivery is only a shadow signal.
create table if not exists support_vnext_shadow.inactivity_outbox(outbox_id uuid primary key,session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),generation bigint not null,kind text not null check(kind='INACTIVITY_WARNING'),provider_window_open boolean null,status text not null default 'PENDING' check(status in ('PENDING','SKIPPED')),created_at timestamptz not null default now(),unique(session_id,generation,kind));
alter table support_vnext_shadow.inactivity_outbox enable row level security;
create or replace function support_vnext_shadow.schedule_inactivity_transaction_v2(p_session_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; g bigint; due timestamptz;
begin select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update; if not found or s.status='CLOSED' or s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS')) then return jsonb_build_object('status','SKIPPED'); end if;
 g:=s.inactivity_generation+1; due:=now()+interval '180 seconds'; update support_vnext_shadow.inactivity_jobs set status='CANCELLED' where session_id=s.session_id and status='SCHEDULED'; update support_vnext_shadow.conversation_sessions set status='WARNING_PENDING',last_inbound_at=now(),warning_due_at=due,close_due_at=null,inactivity_generation=g,state_version=state_version+1 where session_id=s.session_id; insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,g,'WARNING',due); return jsonb_build_object('status','SCHEDULED','generation',g,'warning_due_at',due); end $$;
create or replace function support_vnext_shadow.cancel_inactivity_transaction_v2(p_session_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
begin update support_vnext_shadow.inactivity_jobs set status='CANCELLED' where session_id=p_session_id and status='SCHEDULED'; update support_vnext_shadow.conversation_sessions set status='ACTIVE',inactivity_generation=inactivity_generation+1,warning_due_at=null,close_due_at=null,state_version=state_version+1,last_inbound_at=now() where session_id=p_session_id and status<>'CLOSED'; return jsonb_build_object('status','CANCELLED'); end $$;
create or replace function support_vnext_shadow.run_due_inactivity_jobs_v2(p_worker text,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare j support_vnext_shadow.inactivity_jobs; s support_vnext_shadow.conversation_sessions; a jsonb:='[]'::jsonb;
begin for j in select * from support_vnext_shadow.inactivity_jobs where status='SCHEDULED' and due_at<=now() order by due_at limit greatest(1,least(p_limit,200)) for update skip locked loop select * into s from support_vnext_shadow.conversation_sessions where session_id=j.session_id for update;
 if j.generation<>s.inactivity_generation or s.status='CLOSED' or s.automation_mode='HUMAN_ACTIVE' or exists(select 1 from support_vnext_shadow.service_requests x where x.session_id=s.session_id and x.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS')) then update support_vnext_shadow.inactivity_jobs set status='SKIPPED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','SKIPPED')); continue; end if;
 if j.job_type='WARNING' and s.status='WARNING_PENDING' then update support_vnext_shadow.conversation_sessions set status='WARNING_SENT',warning_sent_at=now(),close_due_at=now()+interval '120 seconds',state_version=state_version+1 where session_id=s.session_id; insert into support_vnext_shadow.inactivity_outbox(outbox_id,session_id,generation,kind,provider_window_open,status) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'INACTIVITY_WARNING',now()<=s.provider_window_expires_at,'PENDING') on conflict(session_id,generation,kind) do nothing; insert into support_vnext_shadow.inactivity_jobs(job_id,session_id,generation,job_type,due_at) values(extensions.gen_random_uuid(),s.session_id,s.inactivity_generation,'CLOSE',now()+interval '120 seconds') on conflict(session_id,generation,job_type) do nothing; update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','WARNING_OUTBOXED')); else update support_vnext_shadow.conversation_sessions set status='CLOSED',closed_at=now(),close_reason='INACTIVITY_SILENT',close_due_at=null,state_version=state_version+1 where session_id=s.session_id and status='WARNING_SENT'; update support_vnext_shadow.inactivity_jobs set status='COMPLETED',claimed_by=p_worker,claimed_at=now() where job_id=j.job_id; a:=a||jsonb_build_array(jsonb_build_object('job_id',j.job_id,'action','CLOSED_SILENTLY')); end if; end loop; return a; end $$;

-- Minimal runtime grants; publisher/admin remain non-login roles for controlled maintenance channels.
revoke all on schema support_vnext_shadow from public,anon,authenticated,service_role;
revoke all on all tables in schema support_vnext_shadow from public,anon,authenticated,service_role;
revoke all on all functions in schema support_vnext_shadow from public,anon,authenticated,service_role;
grant usage on schema support_vnext_shadow to service_role,support_vnext_runtime,support_vnext_publisher,support_vnext_auditor,support_vnext_admin;
grant execute on function support_vnext_shadow.resolve_shadow_session(uuid,text,uuid),support_vnext_shadow.get_runtime_decision_rules(uuid,text,text,text),support_vnext_shadow.store_shadow_decision(jsonb,uuid,uuid),support_vnext_shadow.append_shadow_audit_event(jsonb),support_vnext_shadow.record_shadow_comparison(jsonb),support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.propose_request_transaction(uuid,text),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text),support_vnext_shadow.get_renderer_decision_context(uuid),support_vnext_shadow.get_request_confirmation_status(uuid),support_vnext_shadow.decline_request_transaction_v2(uuid,uuid,text),support_vnext_shadow.resolve_shadow_feature(text,jsonb),support_vnext_shadow.schedule_inactivity_transaction_v2(uuid),support_vnext_shadow.cancel_inactivity_transaction_v2(uuid),support_vnext_shadow.run_due_inactivity_jobs_v2(text,integer) to service_role;
grant execute on function support_vnext_shadow.publish_ruleset_release(uuid,text),support_vnext_shadow.transition_ruleset_release(uuid,support_vnext_shadow.ruleset_status,text,text,text,uuid),support_vnext_shadow.refresh_draft_release_content_hash(uuid,text) to support_vnext_publisher;
commit;
