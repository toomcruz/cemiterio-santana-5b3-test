-- FASE 5B.2-C — ARTEFATO LOCAL. NÃO EXECUTAR SEM REVISÃO INDEPENDENTE.
-- Correções vinculantes da revisão 5B.2. Esta migration é aditiva sobre 0001/0002
-- e não lê, grava, altera ou referencia objetos legados.

begin;

create extension if not exists btree_gist with schema extensions;

-- A published release is a time interval, not merely a status flag. The exclusion
-- constraint is the database-level concurrency guarantee required by C-01.
alter table support_vnext_shadow.support_ruleset_release
  add constraint support_ruleset_release_one_effective_published
  exclude using gist (
    scope_code with =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz), '[)') with &&
  ) where (status = 'PUBLISHED' and revoked_at is null);

alter table support_vnext_shadow.support_ruleset_release
  add constraint support_ruleset_release_revocation_shape
  check (
    (status <> 'REVOKED' and revoked_at is null and revoked_by is null and revocation_reason is null and revocation_mode is null and replacement_release_id is null)
    or
    (status = 'REVOKED' and revoked_at is not null and revoked_by is not null and btrim(revocation_reason) <> '' and revocation_mode is not null
      and (revocation_mode <> 'EXPLICIT_REBIND' or replacement_release_id is not null))
  );

create table support_vnext_shadow.ruleset_source_link (
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id) on delete restrict,
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id) on delete restrict,
  purpose_code text not null check (purpose_code in ('FACT','POLICY','DOCUMENT','TEMPLATE','CONSOLIDATION')),
  created_at timestamptz not null default now(),
  created_by text not null,
  primary key (release_id, source_id, purpose_code)
);

create table support_vnext_shadow.release_audit_events (
  event_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id) on delete restrict,
  event_type text not null check (event_type in ('PUBLISHED','REVOKED','SUPERSEDED','RELEASE_HASH_VALIDATED')),
  actor text not null,
  reason text null,
  content_hash char(64) null check (content_hash is null or content_hash ~ '^[A-Fa-f0-9]{64}$'),
  occurred_at timestamptz not null default now(),
  metadata_redacted jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_redacted) = 'object')
);

create table support_vnext_shadow.confirmation_authorizations (
  authorization_id uuid primary key,
  confirmation_id uuid not null references support_vnext_shadow.pending_confirmations(confirmation_id) on delete restrict,
  inbound_message_id uuid not null,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id) on delete restrict,
  topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id) on delete restrict,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id) on delete restrict,
  classification_hash char(64) not null check (classification_hash ~ '^[A-Fa-f0-9]{64}$'),
  classification_code text not null check (classification_code = 'CONFIRMATION_AFFIRMATIVE'),
  authorized_at timestamptz not null default now(),
  consumed_at timestamptz null,
  consumed_by_request_id uuid null,
  unique (confirmation_id, inbound_message_id),
  unique (inbound_message_id)
);

alter table support_vnext_shadow.pending_confirmations
  add constraint pending_confirmations_request_id_fk
  foreign key (request_id) references support_vnext_shadow.service_requests(request_id) deferrable initially deferred;

alter table support_vnext_shadow.pending_confirmations
  add column if not exists proposal_hash_algorithm text not null default 'SHA256_CANONICAL_JSON'
    check (proposal_hash_algorithm = 'SHA256_CANONICAL_JSON');

-- JSONB text is canonical for object-key ordering in PostgreSQL. The function is
-- server-side so proposal integrity cannot be supplied by the caller.
create or replace function support_vnext_shadow.canonical_jsonb_sha256(p_payload jsonb)
returns char(64)
language sql
immutable
strict
security invoker
set search_path = pg_catalog, extensions
as $$
  select encode(extensions.digest(p_payload::text, 'sha256'), 'hex')::char(64)
$$;

create or replace function support_vnext_shadow.release_snapshot_json(p_release_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
  select jsonb_build_object(
    'services', coalesce((select jsonb_agg(to_jsonb(x) order by x.service_code) from support_vnext_shadow.knowledge_service x where x.release_id = p_release_id), '[]'::jsonb),
    'intents', coalesce((select jsonb_agg(to_jsonb(x) order by x.intent_code) from support_vnext_shadow.knowledge_intent x where x.release_id = p_release_id), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(to_jsonb(x) order by x.condition_code) from support_vnext_shadow.knowledge_condition x where x.release_id = p_release_id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(to_jsonb(x) order by x.requirement_code) from support_vnext_shadow.knowledge_document_requirement x where x.release_id = p_release_id), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(to_jsonb(x) order by x.price_code) from support_vnext_shadow.knowledge_price x where x.release_id = p_release_id), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(to_jsonb(x) order by x.hours_code, x.weekday) from support_vnext_shadow.knowledge_hours x where x.release_id = p_release_id), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(x) order by x.template_code) from support_vnext_shadow.knowledge_message_template x where x.release_id = p_release_id), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority, x.rule_code) from support_vnext_shadow.decision_rule x where x.release_id = p_release_id), '[]'::jsonb),
    'request_policies', coalesce((select jsonb_agg(to_jsonb(x) order by x.policy_code) from support_vnext_shadow.decision_request_policy x where x.release_id = p_release_id), '[]'::jsonb),
    'conversation_policies', coalesce((select jsonb_agg(to_jsonb(x) order by x.policy_code) from support_vnext_shadow.decision_conversation_policy x where x.release_id = p_release_id), '[]'::jsonb),
    'session_policies', coalesce((select jsonb_agg(to_jsonb(x) order by x.policy_code) from support_vnext_shadow.decision_session_policy x where x.release_id = p_release_id), '[]'::jsonb),
    'handoff_policies', coalesce((select jsonb_agg(to_jsonb(x) order by x.policy_code) from support_vnext_shadow.decision_handoff_policy x where x.release_id = p_release_id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source_id', l.source_id, 'purpose_code', l.purpose_code, 'content_hash', s.content_hash) order by l.source_id, l.purpose_code) from support_vnext_shadow.ruleset_source_link l join support_vnext_shadow.knowledge_source s on s.source_id = l.source_id where l.release_id = p_release_id), '[]'::jsonb)
  )
$$;

create or replace function support_vnext_shadow.compute_release_content_hash(p_release_id uuid)
returns char(64)
language sql
stable
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$ select support_vnext_shadow.canonical_jsonb_sha256(support_vnext_shadow.release_snapshot_json(p_release_id)) $$;

create or replace function support_vnext_shadow.release_is_runtime_usable(p_release_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
  select exists (
    select 1 from support_vnext_shadow.support_ruleset_release r
    where r.release_id = p_release_id and r.status = 'PUBLISHED' and r.revoked_at is null
      and r.effective_from <= p_now and (r.effective_to is null or r.effective_to > p_now)
      and r.content_hash = support_vnext_shadow.compute_release_content_hash(r.release_id)
  )
$$;

create or replace function support_vnext_shadow.publish_ruleset_release(p_release_id uuid, p_actor text)
returns support_vnext_shadow.support_ruleset_release
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog, extensions
as $$
declare r support_vnext_shadow.support_ruleset_release; calculated_hash char(64);
begin
  if coalesce(btrim(p_actor), '') = '' then raise exception 'Publication requires actor' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('support_vnext_shadow:publish:' || p_release_id::text, 0));
  select * into r from support_vnext_shadow.support_ruleset_release where release_id = p_release_id for update;
  if not found or r.status <> 'APPROVED' or r.approved_at is null or coalesce(btrim(r.approved_by), '') = '' then
    raise exception 'Only approved releases may be published' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('support_vnext_shadow:scope:' || r.scope_code, 0));
  calculated_hash := support_vnext_shadow.compute_release_content_hash(p_release_id);
  if calculated_hash <> r.content_hash then raise exception 'Release content hash mismatch' using errcode = '22023'; end if;
  update support_vnext_shadow.support_ruleset_release
    set status = 'PUBLISHED', published_at = now(), published_by = p_actor, updated_by = p_actor
  where release_id = p_release_id returning * into r;
  insert into support_vnext_shadow.release_audit_events(event_id, release_id, event_type, actor, content_hash)
  values (extensions.gen_random_uuid(), r.release_id, 'PUBLISHED', p_actor, calculated_hash);
  return r;
end $$;

create or replace function support_vnext_shadow.transition_ruleset_release(
  p_release_id uuid, p_to_status support_vnext_shadow.ruleset_status, p_actor text,
  p_reason text default null, p_revocation_mode text default null, p_replacement_release_id uuid default null
) returns support_vnext_shadow.support_ruleset_release
language plpgsql security invoker set search_path = support_vnext_shadow, pg_catalog, extensions as $$
declare r support_vnext_shadow.support_ruleset_release; replacement support_vnext_shadow.support_ruleset_release;
begin
  if coalesce(btrim(p_actor), '') = '' then raise exception 'Transition requires actor' using errcode = '22023'; end if;
  select * into r from support_vnext_shadow.support_ruleset_release where release_id = p_release_id for update;
  if not found then raise exception 'Release not found' using errcode = 'P0002'; end if;
  if r.status <> 'PUBLISHED' or p_to_status not in ('SUPERSEDED','REVOKED') then raise exception 'Invalid release transition' using errcode = '55000'; end if;
  if p_to_status = 'REVOKED' then
    if coalesce(btrim(p_reason), '') = '' or p_revocation_mode not in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW') then raise exception 'Invalid revocation data' using errcode = '22023'; end if;
    if p_revocation_mode = 'EXPLICIT_REBIND' then
      select * into replacement from support_vnext_shadow.support_ruleset_release where release_id = p_replacement_release_id for share;
      if not found or not support_vnext_shadow.release_is_runtime_usable(replacement.release_id, now()) then raise exception 'Replacement is not published/effective' using errcode = '22023'; end if;
    elsif p_replacement_release_id is not null then raise exception 'Replacement allowed only for explicit rebind' using errcode = '22023'; end if;
    perform support_vnext_shadow._allow_release_transition();
    update support_vnext_shadow.support_ruleset_release set status='REVOKED', revoked_at=now(), revoked_by=p_actor, revocation_reason=p_reason, revocation_mode=p_revocation_mode, replacement_release_id=p_replacement_release_id, updated_by=p_actor where release_id=p_release_id returning * into r;
    insert into support_vnext_shadow.release_audit_events(event_id, release_id, event_type, actor, reason, content_hash) values (extensions.gen_random_uuid(), r.release_id, 'REVOKED', p_actor, p_reason, r.content_hash);
  else
    perform support_vnext_shadow._allow_release_transition();
    update support_vnext_shadow.support_ruleset_release set status='SUPERSEDED', updated_by=p_actor where release_id=p_release_id returning * into r;
    insert into support_vnext_shadow.release_audit_events(event_id, release_id, event_type, actor, reason, content_hash) values (extensions.gen_random_uuid(), r.release_id, 'SUPERSEDED', p_actor, p_reason, r.content_hash);
  end if;
  return r;
end $$;

create or replace function support_vnext_shadow.prevent_published_release_mutation()
returns trigger language plpgsql security invoker set search_path = support_vnext_shadow, pg_catalog as $$
begin
  if tg_op = 'DELETE' and old.status in ('PUBLISHED','SUPERSEDED','REVOKED') then raise exception 'Published release cannot be deleted' using errcode='55000'; end if;
  if tg_op = 'UPDATE' and old.status in ('PUBLISHED','SUPERSEDED','REVOKED') then
    if current_setting('support_vnext_shadow.release_transition', true) is distinct from 'allowed' then
      raise exception 'Release transitions must use transition_ruleset_release' using errcode='55000';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists trg_ruleset_release_guard on support_vnext_shadow.support_ruleset_release;
create trigger trg_ruleset_release_guard before update or delete on support_vnext_shadow.support_ruleset_release
for each row execute function support_vnext_shadow.prevent_published_release_mutation();

-- The transition functions are the sole temporary exception to the guard.
create or replace function support_vnext_shadow._allow_release_transition()
returns void language plpgsql security invoker set search_path = pg_catalog as $$ begin perform set_config('support_vnext_shadow.release_transition','allowed',true); end $$;

-- Reinstall transition functions with the scoped guard flag.
-- (The wrapper is called before their update statements by the Edge-independent RPC callers.)

create or replace function support_vnext_shadow.prevent_published_content_mutation()
returns trigger language plpgsql security invoker set search_path = support_vnext_shadow, pg_catalog as $$
declare release_status support_vnext_shadow.ruleset_status;
begin
  select status into release_status from support_vnext_shadow.support_ruleset_release where release_id = old.release_id;
  if release_status in ('PUBLISHED','SUPERSEDED','REVOKED') then raise exception 'Published release content is immutable' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$ declare tbl text; begin
  foreach tbl in array array['knowledge_service','knowledge_intent','knowledge_condition','knowledge_asset','knowledge_document_requirement','knowledge_price','knowledge_hours','knowledge_hours_exception','knowledge_message_template','decision_handoff_policy','decision_request_policy','decision_sla_policy','decision_conversation_policy','decision_session_policy','decision_rule','ruleset_source_link'] loop
    execute format('drop trigger if exists %I on support_vnext_shadow.%I', 'trg_' || tbl || '_immutable', tbl);
    execute format('create trigger %I before update or delete on support_vnext_shadow.%I for each row execute function support_vnext_shadow.prevent_published_content_mutation()', 'trg_' || tbl || '_immutable', tbl);
  end loop;
end $$;

create or replace function support_vnext_shadow.prevent_published_source_mutation()
returns trigger language plpgsql security invoker set search_path = support_vnext_shadow, pg_catalog as $$
begin
  if exists (select 1 from support_vnext_shadow.ruleset_source_link l join support_vnext_shadow.support_ruleset_release r on r.release_id=l.release_id where l.source_id=old.source_id and r.status in ('PUBLISHED','SUPERSEDED','REVOKED')) then
    raise exception 'Source supporting published release is immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger trg_knowledge_source_immutable before update or delete on support_vnext_shadow.knowledge_source for each row execute function support_vnext_shadow.prevent_published_source_mutation();

create or replace function support_vnext_shadow.jsonb_contains_forbidden_key(p_value jsonb, p_keys text[])
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p_value)='object' then
    for k,v in select key,value from jsonb_each(p_value) loop
      if lower(k)=any(p_keys) then return true; end if;
      if support_vnext_shadow.jsonb_contains_forbidden_key(v,p_keys) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    for v in select value from jsonb_array_elements(p_value) loop
      if support_vnext_shadow.jsonb_contains_forbidden_key(v,p_keys) then return true; end if;
    end loop;
  end if;
  return false;
end $$;

create or replace function support_vnext_shadow.valid_complaint_payload(p_payload jsonb)
returns boolean language sql immutable security invoker set search_path=support_vnext_shadow,pg_catalog as $$
  select jsonb_typeof(p_payload)='object'
    and not support_vnext_shadow.jsonb_contains_forbidden_key(p_payload, array['severity','gravidade','prioridade','priority','setor','sector','assigned_sector','assigned_sector_id','external_route','external_email','email_automatico','ouvidoria'])
    and (select bool_and(key in ('relato','attachment_ids')) from jsonb_each(p_payload)) is not false
$$;

alter table support_vnext_shadow.service_requests drop constraint if exists service_requests_check;
alter table support_vnext_shadow.service_requests
  add constraint service_requests_complaint_payload_closed
  check (category_code <> 'RECLAMACAO' or support_vnext_shadow.valid_complaint_payload(request_payload));

create or replace function support_vnext_shadow.validate_decision_rule_shape()
returns trigger language plpgsql security invoker set search_path=support_vnext_shadow,pg_catalog as $$
declare forbidden text[] := array['price','amount','valor','document','sla','deadline','prazo','body','prompt','sql','javascript'];
begin
  if exists (select 1 from jsonb_object_keys(new.when_expression) k where k not in ('intent_code','service_code','message_role','complaint_signal','topic_status','pending_confirmation','human_active')) then raise exception 'Unknown when_expression key' using errcode='22023'; end if;
  if exists (select 1 from jsonb_object_keys(new.then_plan) k where k not in ('actions','response_plan','state_patch','request_plan','document_plan','handoff_plan','reason_codes','validation_requirements','expires_at')) then raise exception 'Unknown then_plan key' using errcode='22023'; end if;
  if lower(new.then_plan::text) ~ ('"(' || array_to_string(forbidden,'|') || ')"') then raise exception 'Decision rule cannot embed administrative facts or executable content' using errcode='22023'; end if;
  return new;
end $$;
create trigger trg_decision_rule_shape before insert or update on support_vnext_shadow.decision_rule for each row execute function support_vnext_shadow.validate_decision_rule_shape();

-- Coherence guards: every operational object is constrained to the release pinned on its session.
create or replace function support_vnext_shadow.validate_topic_release_coherence()
returns trigger language plpgsql security invoker set search_path=support_vnext_shadow,pg_catalog as $$
declare session_release uuid; intent_release uuid; service_release uuid;
begin
  select release_id into session_release from support_vnext_shadow.conversation_sessions where session_id=new.session_id;
  select release_id into intent_release from support_vnext_shadow.knowledge_intent where intent_id=new.intent_id;
  select release_id into service_release from support_vnext_shadow.knowledge_service where service_id=new.service_id;
  if session_release is null or intent_release is distinct from session_release or (new.service_id is not null and service_release is distinct from session_release) then raise exception 'Topic release mismatch' using errcode='22023'; end if;
  return new;
end $$;
create trigger trg_topic_release_coherence before insert or update on support_vnext_shadow.conversation_topics for each row execute function support_vnext_shadow.validate_topic_release_coherence();

create or replace function support_vnext_shadow.validate_confirmation_release_coherence()
returns trigger language plpgsql security invoker set search_path=support_vnext_shadow,pg_catalog as $$
declare session_release uuid; topic_session uuid; policy_release uuid; decision_release uuid;
begin
  select release_id into session_release from support_vnext_shadow.conversation_sessions where session_id=new.session_id;
  select session_id into topic_session from support_vnext_shadow.conversation_topics where topic_id=new.topic_id;
  select release_id into policy_release from support_vnext_shadow.decision_request_policy where request_policy_id=new.request_policy_id;
  if new.decision_id is not null then select release_id into decision_release from support_vnext_shadow.decision_plans where decision_id=new.decision_id; end if;
  if session_release is null or new.release_id is distinct from session_release or topic_session is distinct from new.session_id or policy_release is distinct from new.release_id or (new.decision_id is not null and decision_release is distinct from new.release_id) then raise exception 'Confirmation release mismatch' using errcode='22023'; end if;
  return new;
end $$;
create trigger trg_confirmation_release_coherence before insert or update on support_vnext_shadow.pending_confirmations for each row execute function support_vnext_shadow.validate_confirmation_release_coherence();

create or replace function support_vnext_shadow.validate_decision_release_coherence()
returns trigger language plpgsql security invoker set search_path=support_vnext_shadow,pg_catalog as $$
declare session_release uuid; topic_session uuid;
begin
  select release_id into session_release from support_vnext_shadow.conversation_sessions where session_id=new.session_id;
  if new.topic_id is not null then select session_id into topic_session from support_vnext_shadow.conversation_topics where topic_id=new.topic_id; end if;
  if session_release is null or new.release_id is distinct from session_release or (new.topic_id is not null and topic_session is distinct from new.session_id) then raise exception 'Decision release mismatch' using errcode='22023'; end if;
  return new;
end $$;
create trigger trg_decision_release_coherence before insert or update on support_vnext_shadow.decision_plans for each row execute function support_vnext_shadow.validate_decision_release_coherence();

-- Do not permit runtime DML over knowledge/release tables. Existing Edge code is
-- migrated to explicit RPCs in this package; PUBLIC/anon/authenticated stay revoked.
revoke all on all tables in schema support_vnext_shadow from service_role;
revoke all on all functions in schema support_vnext_shadow from service_role;
grant usage on schema support_vnext_shadow to service_role;
grant execute on function support_vnext_shadow.publish_ruleset_release(uuid,text) to service_role;
grant execute on function support_vnext_shadow.transition_ruleset_release(uuid,support_vnext_shadow.ruleset_status,text,text,text,uuid) to service_role;
grant execute on function support_vnext_shadow.canonical_jsonb_sha256(jsonb) to service_role;

commit;
