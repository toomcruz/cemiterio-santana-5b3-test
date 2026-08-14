-- FASE 5B.2-C. Artefato local; NÃO EXECUTAR sem revisão 5B.2-R.
begin;

-- Hash is refreshed only before publication; publication recalculates it again.
create or replace function support_vnext_shadow.refresh_draft_release_content_hash(p_release_id uuid, p_actor text)
returns char(64) language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare h char(64); r support_vnext_shadow.support_ruleset_release;
begin
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status not in ('DRAFT','IN_REVIEW','APPROVED') then raise exception 'Only unpublished release can be hashed' using errcode='55000'; end if;
 h:=support_vnext_shadow.compute_release_content_hash(p_release_id);
 update support_vnext_shadow.support_ruleset_release set content_hash=h,updated_at=now(),updated_by=p_actor,row_version=row_version+1 where release_id=p_release_id;
 return h;
end $$;

-- Runtime response is database-authoritative and never accepts a caller response_plan.
create or replace function support_vnext_shadow.get_renderer_decision_context(p_decision_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare d support_vnext_shadow.decision_plans; r support_vnext_shadow.support_ruleset_release;
begin
 select * into d from support_vnext_shadow.decision_plans where decision_id=p_decision_id;
 if not found or d.expires_at<=now() or d.outcome='A_CONFIRMAR' or not support_vnext_shadow.release_is_runtime_usable(d.release_id,now()) then raise exception 'Decision cannot render facts' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=d.release_id;
 return jsonb_build_object('decision_id',d.decision_id,'release_id',d.release_id,'outcome',d.outcome,'response_plan',d.plan->'response_plan','expires_at',d.expires_at,'content_hash',r.content_hash);
end $$;

-- Closed complaint shape: no arbitrary nested object is accepted. Attachments are UUID strings only.
create or replace function support_vnext_shadow.valid_complaint_payload_strict(p jsonb) returns boolean language sql immutable as $$
 select jsonb_typeof(p)='object'
 and not exists(select 1 from jsonb_object_keys(p) k where k not in ('relato','attachment_ids'))
 and (not p ? 'relato' or jsonb_typeof(p->'relato')='string')
 and (not p ? 'attachment_ids' or (jsonb_typeof(p->'attachment_ids')='array' and not exists(select 1 from jsonb_array_elements_text(p->'attachment_ids') x where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')))
 $$;
alter table support_vnext_shadow.service_requests drop constraint if exists service_requests_complaint_payload_closed;
alter table support_vnext_shadow.service_requests add constraint service_requests_complaint_payload_closed check (category_code<>'RECLAMACAO' or support_vnext_shadow.valid_complaint_payload_strict(request_payload));

-- Retire insecure pre-hardening RPC overloads so there is no alternate public contract.
drop function if exists support_vnext_shadow.propose_request_transaction(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,char(64),timestamptz,bigint,bigint,uuid);
drop function if exists support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text,text,char(64),text);

create or replace function support_vnext_shadow.get_request_confirmation_status(p_confirmation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare c support_vnext_shadow.pending_confirmations; q support_vnext_shadow.service_requests;
begin select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id; if not found then return jsonb_build_object('status','NOT_FOUND','reason_codes',jsonb_build_array('CONFIRMATION_NOT_FOUND')); end if;
 if c.status='PENDING' and c.expires_at<=now() then update support_vnext_shadow.pending_confirmations set status='EXPIRED' where confirmation_id=c.confirmation_id; c.status:='EXPIRED'; end if;
 select * into q from support_vnext_shadow.service_requests where confirmation_id=c.confirmation_id;
 return jsonb_build_object('status',case when q.request_id is not null then 'ALREADY_CONFIRMED' when c.status='EXPIRED' then 'EXPIRED' when c.status='DECLINED' then 'DECLINED' else 'PROPOSED' end,'confirmation',to_jsonb(c)-'confirmation_nonce','request_id',q.request_id,'protocol',q.protocol,'reason_codes',jsonb_build_array('DATABASE_STATUS'));
end $$;

create or replace function support_vnext_shadow.decline_request_transaction_v2(p_confirmation_id uuid,p_confirmation_nonce uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare c support_vnext_shadow.pending_confirmations;
begin select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id for update; if not found then return jsonb_build_object('status','NOT_FOUND','reason_codes',jsonb_build_array('CONFIRMATION_NOT_FOUND')); end if;
 if c.confirmation_nonce<>p_confirmation_nonce then return jsonb_build_object('status','REJECTED','reason_codes',jsonb_build_array('NONCE_MISMATCH')); end if;
 if c.status='PENDING' and c.expires_at>now() then update support_vnext_shadow.pending_confirmations set status='DECLINED' where confirmation_id=p_confirmation_id; end if;
 return support_vnext_shadow.get_request_confirmation_status(p_confirmation_id);
end $$;

-- Authorizations are one-to-one with an inbound affirmative message and are consumed by CONFIRM.
create unique index if not exists confirmation_authorization_unconsumed_inbound_uq on support_vnext_shadow.confirmation_authorizations(inbound_message_id);

-- Feature mode is resolved in the DB with caller-provided ordered candidates; ENABLED cannot be returned.
create or replace function support_vnext_shadow.resolve_shadow_feature(p_flag_key text,p_candidates jsonb)
returns jsonb language sql security definer set search_path=pg_catalog,support_vnext_shadow as $$
 with c as (select value->>'target_type' target_type,value->>'target_value' target_value,ord from jsonb_array_elements(coalesce(p_candidates,'[]')) with ordinality x(value,ord)),
 m as (select t.mode,c.ord from support_vnext_shadow.feature_flag_targets t join c on c.target_type=t.target_type and c.target_value is not distinct from t.target_value where t.flag_key=p_flag_key and t.effective_from<=now() and (t.effective_to is null or t.effective_to>now()) order by c.ord,t.effective_from desc limit 1),
 g as (select default_mode as mode from support_vnext_shadow.feature_flags where flag_key=p_flag_key)
 select jsonb_build_object('mode',case when coalesce((select mode::text from m),(select mode::text from g),'OFF')='SHADOW_ONLY' then 'SHADOW_ONLY' else 'OFF' end) $$;

-- These wrappers intentionally accept no client clock. Existing v5B.1 job functions,
-- if retained, are invoked with database now() only and remain shadow/outbox-only.
create or replace function support_vnext_shadow.schedule_inactivity_transaction_v2(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
declare s support_vnext_shadow.conversation_sessions;
begin select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for update; if not found or s.status='CLOSED' or s.automation_mode='HUMAN_ACTIVE' then return jsonb_build_object('status','SKIPPED'); end if;
 return jsonb_build_object('status','SCHEDULED','generation',s.inactivity_generation,'warning_seconds',180,'close_seconds',120); end $$;
create or replace function support_vnext_shadow.cancel_inactivity_transaction_v2(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow as $$
begin update support_vnext_shadow.conversation_sessions set inactivity_generation=inactivity_generation+1,status='ACTIVE' where session_id=p_session_id and status<>'CLOSED'; return jsonb_build_object('status','CANCELLED'); end $$;
create or replace function support_vnext_shadow.run_due_inactivity_jobs_v2(p_worker text,p_limit integer)
returns jsonb language sql security definer set search_path=pg_catalog,support_vnext_shadow as $$ select jsonb_build_array() $$;

revoke all on all tables in schema support_vnext_shadow from public,anon,authenticated,service_role;
revoke all on all functions in schema support_vnext_shadow from public,anon,authenticated;
grant usage on schema support_vnext_shadow to service_role;
grant execute on function support_vnext_shadow.refresh_draft_release_content_hash(uuid,text),support_vnext_shadow.get_renderer_decision_context(uuid),support_vnext_shadow.get_request_confirmation_status(uuid),support_vnext_shadow.decline_request_transaction_v2(uuid,uuid,text),support_vnext_shadow.resolve_shadow_feature(text,jsonb) to service_role;
grant execute on function support_vnext_shadow.schedule_inactivity_transaction_v2(uuid),support_vnext_shadow.cancel_inactivity_transaction_v2(uuid),support_vnext_shadow.run_due_inactivity_jobs_v2(text,integer) to service_role;
commit;
