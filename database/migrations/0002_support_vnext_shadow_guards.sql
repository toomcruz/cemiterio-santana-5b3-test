-- FASE 5B.1 — ARTEFATO LOCAL. NÃO EXECUTAR EM PRODUÇÃO.
-- Guardas para release publicada, RLS e comandos transacionais novos. Não altera RPCs/triggers legados.

create or replace function support_vnext_shadow.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function support_vnext_shadow.prevent_published_content_mutation()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  release_status support_vnext_shadow.ruleset_status;
begin
  select status into release_status
  from support_vnext_shadow.support_ruleset_release
  where release_id = old.release_id;

  if release_status in ('PUBLISHED', 'SUPERSEDED', 'REVOKED') then
    raise exception 'Published release content is immutable: %', old.release_id
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function support_vnext_shadow.prevent_published_release_mutation()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  if old.status in ('PUBLISHED', 'SUPERSEDED', 'REVOKED') then
    if new.release_code is distinct from old.release_code
      or new.release_sequence is distinct from old.release_sequence
      or new.scope_code is distinct from old.scope_code
      or new.parent_release_id is distinct from old.parent_release_id
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.content_hash is distinct from old.content_hash
      or new.change_summary is distinct from old.change_summary
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by
      or new.published_at is distinct from old.published_at
      or new.published_by is distinct from old.published_by then
      raise exception 'Published release metadata is immutable: %', old.release_id
        using errcode = '55000';
    end if;

    if old.status = 'PUBLISHED' and new.status not in ('PUBLISHED', 'SUPERSEDED', 'REVOKED') then
      raise exception 'Invalid published release transition from % to %', old.status, new.status
        using errcode = '55000';
    end if;
  end if;
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

create trigger trg_ruleset_release_guard
before update on support_vnext_shadow.support_ruleset_release
for each row execute function support_vnext_shadow.prevent_published_release_mutation();

create trigger trg_session_touch
before update on support_vnext_shadow.conversation_sessions
for each row execute function support_vnext_shadow.touch_updated_at();
create trigger trg_confirmation_touch
before update on support_vnext_shadow.pending_confirmations
for each row execute function support_vnext_shadow.touch_updated_at();
create trigger trg_request_touch
before update on support_vnext_shadow.service_requests
for each row execute function support_vnext_shadow.touch_updated_at();
create trigger trg_job_touch
before update on support_vnext_shadow.inactivity_jobs
for each row execute function support_vnext_shadow.touch_updated_at();

create or replace function support_vnext_shadow.prevent_confirmation_proposal_mutation()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
    or new.session_id is distinct from old.session_id
    or new.topic_id is distinct from old.topic_id
    or new.release_id is distinct from old.release_id
    or new.request_policy_id is distinct from old.request_policy_id
    or new.proposal_snapshot is distinct from old.proposal_snapshot
    or new.proposal_hash is distinct from old.proposal_hash
    or new.expected_state_version is distinct from old.expected_state_version
    or new.expected_topic_version is distinct from old.expected_topic_version
    or new.decision_id is distinct from old.decision_id then
    raise exception 'Confirmation proposal is immutable: %', old.confirmation_id using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger trg_confirmation_proposal_immutable
before update on support_vnext_shadow.pending_confirmations
for each row execute function support_vnext_shadow.prevent_confirmation_proposal_mutation();

create or replace function support_vnext_shadow.prevent_request_payload_mutation()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  if new.confirmation_id is distinct from old.confirmation_id
    or new.conversation_id is distinct from old.conversation_id
    or new.session_id is distinct from old.session_id
    or new.topic_id is distinct from old.topic_id
    or new.release_id is distinct from old.release_id
    or new.category_code is distinct from old.category_code
    or new.subject is distinct from old.subject
    or new.request_payload is distinct from old.request_payload
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Persisted request facts are immutable: %', old.request_id using errcode = '55000';
  end if;
  if old.protocol is not null and new.protocol is distinct from old.protocol then
    raise exception 'Issued protocol is immutable: %', old.request_id using errcode = '55000';
  end if;
  if old.protocol is null and new.protocol is null and new.protocol_issued_at is not null then
    raise exception 'Protocol timestamp requires a protocol value: %', old.request_id using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_request_payload_immutable
before update on support_vnext_shadow.service_requests
for each row execute function support_vnext_shadow.prevent_request_payload_mutation();

create or replace function support_vnext_shadow.prevent_state_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  raise exception 'State events are append-only' using errcode = '55000';
end;
$$;

create trigger trg_state_events_append_only
before update or delete on support_vnext_shadow.state_events
for each row execute function support_vnext_shadow.prevent_state_event_mutation();

create or replace function support_vnext_shadow.validate_request_policy_document_scope()
returns trigger
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  if exists (
    select 1
    from unnest(new.required_document_requirement_ids) required_id
    left join support_vnext_shadow.knowledge_document_requirement requirement
      on requirement.document_requirement_id = required_id and requirement.release_id = new.release_id
    where requirement.document_requirement_id is null
  ) then
    raise exception 'Request policy document requirements must belong to the same release' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trg_request_policy_document_scope
before insert or update on support_vnext_shadow.decision_request_policy
for each row execute function support_vnext_shadow.validate_request_policy_document_scope();

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'knowledge_service', 'knowledge_intent', 'knowledge_condition', 'knowledge_asset',
    'knowledge_document_requirement', 'knowledge_price', 'knowledge_hours', 'knowledge_hours_exception',
    'knowledge_message_template', 'decision_handoff_policy', 'decision_request_policy',
    'decision_sla_policy', 'decision_conversation_policy', 'decision_session_policy',
    'decision_rule'
  ] loop
    execute format(
      'create trigger %I before update on support_vnext_shadow.%I for each row execute function support_vnext_shadow.prevent_published_content_mutation()',
      'trg_' || tbl || '_immutable', tbl
    );
  end loop;
end;
$$;

create or replace function support_vnext_shadow.resolve_published_release(
  p_scope_code text,
  p_at timestamptz default now()
)
returns support_vnext_shadow.support_ruleset_release
language sql
stable
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
  select r.*
  from support_vnext_shadow.support_ruleset_release r
  where r.scope_code = p_scope_code
    and r.status = 'PUBLISHED'
    and r.revoked_at is null
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
  order by r.effective_from desc
  limit 1
$$;

create or replace function support_vnext_shadow.explicit_rebind_session_release(
  p_session_id uuid,
  p_from_release_id uuid,
  p_to_release_id uuid,
  p_reason text,
  p_actor text
)
returns support_vnext_shadow.conversation_sessions
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  s support_vnext_shadow.conversation_sessions;
  source_release support_vnext_shadow.support_ruleset_release;
  target_release support_vnext_shadow.support_ruleset_release;
  rebound support_vnext_shadow.conversation_sessions;
begin
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor), '') = '' then
    raise exception 'Explicit rebind requires reason and authorized actor' using errcode = '22023';
  end if;
  select * into s from support_vnext_shadow.conversation_sessions where session_id = p_session_id for update;
  if not found or s.release_id <> p_from_release_id then
    raise exception 'Pinned session/release mismatch for explicit rebind' using errcode = '40001';
  end if;
  select * into source_release from support_vnext_shadow.support_ruleset_release where release_id = p_from_release_id for update;
  if not found or source_release.status <> 'REVOKED' or source_release.revocation_mode is distinct from 'EXPLICIT_REBIND'
     or source_release.replacement_release_id is distinct from p_to_release_id then
    raise exception 'Source release does not authorize this explicit rebind' using errcode = '22023';
  end if;
  select * into target_release from support_vnext_shadow.support_ruleset_release where release_id = p_to_release_id;
  if not found or target_release.status <> 'PUBLISHED' or target_release.revoked_at is not null
     or target_release.effective_from > now() or (target_release.effective_to is not null and target_release.effective_to <= now()) then
    raise exception 'Replacement release is not published and effective' using errcode = '22023';
  end if;
  update support_vnext_shadow.conversation_sessions
  set release_id = p_to_release_id, state_version = state_version + 1
  where session_id = p_session_id
  returning * into rebound;
  insert into support_vnext_shadow.session_release_transitions(
    transition_id, session_id, from_release_id, to_release_id, reason, initiated_by
  ) values (extensions.gen_random_uuid(), p_session_id, p_from_release_id, p_to_release_id, p_reason, p_actor);
  return rebound;
end;
$$;

create or replace function support_vnext_shadow.confirm_request_transaction(
  p_confirmation_id uuid,
  p_confirmation_nonce uuid,
  p_inbound_message_id uuid,
  p_request_id uuid,
  p_protocol_scope text,
  p_protocol_prefix text,
  p_idempotency_key char(64),
  p_actor text
)
returns table(request_id uuid, protocol text, outcome text)
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  c support_vnext_shadow.pending_confirmations;
  s support_vnext_shadow.conversation_sessions;
  t support_vnext_shadow.conversation_topics;
  existing_request support_vnext_shadow.service_requests;
  proposal_category text;
  proposal_subject text;
  generated_protocol text;
  next_protocol_value bigint;
begin
  select * into c
  from support_vnext_shadow.pending_confirmations
  where confirmation_id = p_confirmation_id
    and confirmation_nonce = p_confirmation_nonce
  for update;

  if not found then
    return query select null::uuid, null::text, 'NOT_FOUND';
    return;
  end if;

  if c.status in ('CONFIRMED', 'CONSUMED') and c.request_id is not null then
    select * into existing_request from support_vnext_shadow.service_requests where request_id = c.request_id;
    return query select existing_request.request_id, existing_request.protocol, 'ALREADY_CONFIRMED';
    return;
  end if;

  if c.status <> 'PENDING' or c.expires_at <= now() then
    if c.status = 'PENDING' then
      update support_vnext_shadow.pending_confirmations set status = 'EXPIRED' where confirmation_id = c.confirmation_id;
    end if;
    return query select null::uuid, null::text, 'EXPIRED';
    return;
  end if;

  select * into s from support_vnext_shadow.conversation_sessions where session_id = c.session_id for update;
  if not found then
    return query select null::uuid, null::text, 'STATE_CONFLICT';
    return;
  end if;
  select * into t from support_vnext_shadow.conversation_topics where topic_id = c.topic_id for update;
  if not found then
    return query select null::uuid, null::text, 'STATE_CONFLICT';
    return;
  end if;
  if s.status = 'CLOSED' or s.state_version <> c.expected_state_version or t.topic_version <> c.expected_topic_version then
    return query select null::uuid, null::text, 'STATE_CONFLICT';
    return;
  end if;

  if exists (select 1 from support_vnext_shadow.service_requests where idempotency_key = p_idempotency_key) then
    select * into existing_request from support_vnext_shadow.service_requests where idempotency_key = p_idempotency_key;
    update support_vnext_shadow.pending_confirmations
      set status = 'CONSUMED', request_id = existing_request.request_id, confirmed_inbound_message_id = p_inbound_message_id, consumed_at = now()
      where confirmation_id = c.confirmation_id;
    return query select existing_request.request_id, existing_request.protocol, 'ALREADY_CONFIRMED';
    return;
  end if;

  proposal_category := coalesce(c.proposal_snapshot ->> 'category_code', '');
  proposal_subject := coalesce(c.proposal_snapshot ->> 'subject', '');
  if proposal_category = '' or proposal_subject = '' then
    return query select null::uuid, null::text, 'INVALID_PROPOSAL';
    return;
  end if;
  if proposal_category = 'RECLAMACAO'
     and coalesce(c.proposal_snapshot -> 'fields', '{}'::jsonb) ?| array['severity','gravidade','assigned_sector_id','sector','setor','setor_id','external_email','ouvidoria'] then
    return query select null::uuid, null::text, 'INVALID_PROPOSAL';
    return;
  end if;
  if p_protocol_prefix is null or btrim(p_protocol_prefix) = '' then
    return query select null::uuid, null::text, 'INVALID_PROTOCOL_POLICY';
    return;
  end if;

  insert into support_vnext_shadow.service_requests (
    request_id, confirmation_id, conversation_id, session_id, topic_id, release_id,
    category_code, subject, request_payload, protocol, idempotency_key, status, created_by
  ) values (
    p_request_id, c.confirmation_id, c.conversation_id, c.session_id, c.topic_id, c.release_id,
    proposal_category, proposal_subject, coalesce(c.proposal_snapshot -> 'fields', '{}'::jsonb),
    null, p_idempotency_key, 'OPEN', p_actor
  );

  -- The request now exists inside this transaction. Only then is a protocol allocated and exposed.
  insert into support_vnext_shadow.protocol_sequences(sequence_scope, current_value)
  values (p_protocol_scope, 1)
  on conflict (sequence_scope) do update
  set current_value = support_vnext_shadow.protocol_sequences.current_value + 1,
      updated_at = now()
  returning current_value into next_protocol_value;
  generated_protocol := p_protocol_prefix || '-' || lpad(next_protocol_value::text, 8, '0');
  update support_vnext_shadow.service_requests
  set protocol = generated_protocol, protocol_issued_at = now()
  where request_id = p_request_id;

  update support_vnext_shadow.pending_confirmations
  set status = 'CONSUMED', request_id = p_request_id, confirmed_inbound_message_id = p_inbound_message_id, consumed_at = now()
  where confirmation_id = c.confirmation_id;

  return query select p_request_id, generated_protocol, 'CONFIRMED';
end;
$$;

create or replace function support_vnext_shadow.propose_request_transaction(
  p_confirmation_id uuid,
  p_confirmation_nonce uuid,
  p_conversation_id uuid,
  p_session_id uuid,
  p_topic_id uuid,
  p_release_id uuid,
  p_request_policy_id uuid,
  p_proposal_snapshot jsonb,
  p_proposal_hash char(64),
  p_expires_at timestamptz,
  p_expected_state_version bigint,
  p_expected_topic_version bigint,
  p_decision_id uuid
)
returns support_vnext_shadow.pending_confirmations
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  s support_vnext_shadow.conversation_sessions;
  t support_vnext_shadow.conversation_topics;
  policy support_vnext_shadow.decision_request_policy;
  existing support_vnext_shadow.pending_confirmations;
  created support_vnext_shadow.pending_confirmations;
begin
  select * into s from support_vnext_shadow.conversation_sessions where session_id = p_session_id for update;
  if not found then
    raise exception 'Session not found for request proposal' using errcode = '40001';
  end if;
  select * into t from support_vnext_shadow.conversation_topics where topic_id = p_topic_id for update;
  if not found then
    raise exception 'Topic not found for request proposal' using errcode = '40001';
  end if;
  if s.conversation_id <> p_conversation_id or t.session_id <> p_session_id
     or s.status = 'CLOSED' or s.state_version <> p_expected_state_version or t.topic_version <> p_expected_topic_version then
    raise exception 'State mismatch for request proposal' using errcode = '40001';
  end if;
  if s.release_id <> p_release_id then
    raise exception 'Release mismatch for request proposal' using errcode = '22023';
  end if;
  select * into policy from support_vnext_shadow.decision_request_policy
  where request_policy_id = p_request_policy_id
  for share;
  if not found or policy.release_id <> p_release_id or policy.record_status <> 'PUBLISHED'
     or not policy.allow_create or not policy.confirmation_required then
    raise exception 'Request policy is not actionable in this release' using errcode = '22023';
  end if;
  if coalesce(p_proposal_snapshot ->> 'category_code', '') <> policy.request_category_code then
    raise exception 'Proposal category differs from request policy' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(policy.required_document_requirement_ids) required_id
    where not exists (
      select 1 from jsonb_array_elements_text(coalesce(p_proposal_snapshot -> 'document_ids', '[]'::jsonb)) submitted_id
      where submitted_id = required_id::text
    )
  ) then
    raise exception 'Proposal is missing required document references' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'Confirmation expiry must be in the future' using errcode = '22023';
  end if;

  select * into existing from support_vnext_shadow.pending_confirmations
  where topic_id = p_topic_id and status = 'PENDING'
  for update;
  if found then
    if existing.proposal_hash = p_proposal_hash then
      return existing;
    end if;
    raise exception 'Another pending confirmation already exists for topic' using errcode = '23505';
  end if;

  insert into support_vnext_shadow.pending_confirmations (
    confirmation_id, confirmation_nonce, conversation_id, session_id, topic_id, release_id,
    request_policy_id, proposal_snapshot, proposal_hash, expires_at,
    expected_state_version, expected_topic_version, decision_id
  ) values (
    p_confirmation_id, p_confirmation_nonce, p_conversation_id, p_session_id, p_topic_id, p_release_id,
    p_request_policy_id, p_proposal_snapshot, p_proposal_hash, p_expires_at,
    p_expected_state_version, p_expected_topic_version, p_decision_id
  ) returning * into created;
  return created;
end;
$$;

create or replace function support_vnext_shadow.decline_request_transaction(
  p_confirmation_id uuid,
  p_confirmation_nonce uuid
)
returns support_vnext_shadow.pending_confirmations
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  updated support_vnext_shadow.pending_confirmations;
begin
  update support_vnext_shadow.pending_confirmations
  set status = case when expires_at <= now() then 'EXPIRED'::support_vnext_shadow.confirmation_status else 'DECLINED'::support_vnext_shadow.confirmation_status end
  where confirmation_id = p_confirmation_id
    and confirmation_nonce = p_confirmation_nonce
    and status = 'PENDING'
  returning * into updated;
  if not found then
    raise exception 'Pending confirmation not found' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;

-- Inactivity is separate from the provider's technical 24-hour window. These commands only mutate
-- the isolated vNext schema and never call W-API or any outbound delivery provider.
create or replace function support_vnext_shadow.schedule_inactivity_transaction(
  p_session_id uuid,
  p_received_at timestamptz
)
returns support_vnext_shadow.conversation_sessions
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  s support_vnext_shadow.conversation_sessions;
  scheduled support_vnext_shadow.conversation_sessions;
  next_generation bigint;
begin
  select * into s from support_vnext_shadow.conversation_sessions where session_id = p_session_id for update;
  if not found then
    raise exception 'Session not found for inactivity schedule' using errcode = 'P0002';
  end if;
  if s.status = 'CLOSED' then
    return s;
  end if;
  next_generation := s.inactivity_generation + 1;
  update support_vnext_shadow.inactivity_jobs
  set status = 'CANCELLED'
  where session_id = p_session_id and status = 'SCHEDULED';
  update support_vnext_shadow.conversation_sessions
  set status = 'WARNING_PENDING', last_inbound_at = p_received_at,
      warning_due_at = p_received_at + interval '180 seconds', warning_sent_at = null,
      close_due_at = null, inactivity_generation = next_generation, state_version = state_version + 1
  where session_id = p_session_id
  returning * into scheduled;
  insert into support_vnext_shadow.inactivity_jobs(job_id, session_id, generation, job_type, due_at)
  values (extensions.gen_random_uuid(), p_session_id, next_generation, 'WARNING', scheduled.warning_due_at);
  return scheduled;
end;
$$;

create or replace function support_vnext_shadow.cancel_inactivity_transaction(
  p_session_id uuid,
  p_received_at timestamptz
)
returns support_vnext_shadow.conversation_sessions
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  s support_vnext_shadow.conversation_sessions;
  updated support_vnext_shadow.conversation_sessions;
begin
  select * into s from support_vnext_shadow.conversation_sessions where session_id = p_session_id for update;
  if not found then
    raise exception 'Session not found for inactivity cancellation' using errcode = 'P0002';
  end if;
  if s.status = 'CLOSED' then
    return s;
  end if;
  update support_vnext_shadow.inactivity_jobs
  set status = 'CANCELLED'
  where session_id = p_session_id and status = 'SCHEDULED';
  update support_vnext_shadow.conversation_sessions
  set status = 'ACTIVE', last_inbound_at = p_received_at, warning_due_at = null,
      warning_sent_at = null, close_due_at = null, inactivity_generation = inactivity_generation + 1,
      state_version = state_version + 1
  where session_id = p_session_id
  returning * into updated;
  return updated;
end;
$$;

create or replace function support_vnext_shadow.claim_due_inactivity_jobs(
  p_now timestamptz,
  p_worker text,
  p_limit integer default 50
)
returns setof support_vnext_shadow.inactivity_jobs
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
begin
  return query
  with candidate as (
    select j.job_id
    from support_vnext_shadow.inactivity_jobs j
    where j.status = 'SCHEDULED' and j.due_at <= p_now
    order by j.due_at, j.job_id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update support_vnext_shadow.inactivity_jobs j
  set status = 'CLAIMED', claimed_at = p_now, claimed_by = p_worker
  from candidate c
  where j.job_id = c.job_id
  returning j.*;
end;
$$;

create or replace function support_vnext_shadow.process_inactivity_job(
  p_job_id uuid,
  p_now timestamptz,
  p_worker text
)
returns table(job_id uuid, action text, session_status text, warning_due_at timestamptz, close_due_at timestamptz)
language plpgsql
security invoker
set search_path = support_vnext_shadow, pg_catalog
as $$
declare
  j support_vnext_shadow.inactivity_jobs;
  s support_vnext_shadow.conversation_sessions;
  blocked boolean;
begin
  select * into j from support_vnext_shadow.inactivity_jobs where job_id = p_job_id for update;
  if not found then
    return query select p_job_id, 'NOT_FOUND', null::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  select * into s from support_vnext_shadow.conversation_sessions where session_id = j.session_id for update;
  if not found then
    update support_vnext_shadow.inactivity_jobs set status = 'SKIPPED' where job_id = p_job_id;
    return query select p_job_id, 'SESSION_NOT_FOUND', null::text, null::timestamptz, null::timestamptz;
    return;
  end if;
  if j.status <> 'CLAIMED' or j.claimed_by <> p_worker then
    return query select p_job_id, 'NOT_CLAIMED_BY_WORKER', s.status::text, s.warning_due_at, s.close_due_at;
    return;
  end if;
  if j.generation <> s.inactivity_generation or s.status = 'CLOSED' or j.due_at > p_now then
    update support_vnext_shadow.inactivity_jobs set status = 'SKIPPED' where job_id = p_job_id;
    return query select p_job_id, 'STALE_OR_CLOSED', s.status::text, s.warning_due_at, s.close_due_at;
    return;
  end if;

  blocked := s.automation_mode = 'HUMAN_ACTIVE'
    or exists (select 1 from support_vnext_shadow.handoffs h where h.session_id = s.session_id and h.status = 'ACTIVE')
    or exists (select 1 from support_vnext_shadow.service_requests r where r.session_id = s.session_id and r.status in ('OPEN','WAITING_HUMAN','IN_PROGRESS'));
  if blocked then
    update support_vnext_shadow.inactivity_jobs set status = 'SKIPPED' where job_id = p_job_id;
    update support_vnext_shadow.conversation_sessions
    set status = 'ACTIVE', warning_due_at = null, close_due_at = null, state_version = state_version + 1
    where session_id = s.session_id returning * into s;
    return query select p_job_id, 'BLOCKED_BY_HUMAN_OR_REQUEST', s.status::text, s.warning_due_at, s.close_due_at;
    return;
  end if;

  if j.job_type = 'WARNING' and s.status = 'WARNING_PENDING' then
    update support_vnext_shadow.conversation_sessions
    set status = 'WARNING_SENT', warning_sent_at = p_now, close_due_at = p_now + interval '120 seconds', state_version = state_version + 1
    where session_id = s.session_id returning * into s;
    insert into support_vnext_shadow.inactivity_jobs(job_id, session_id, generation, job_type, due_at)
    values (extensions.gen_random_uuid(), s.session_id, s.inactivity_generation, 'CLOSE', s.close_due_at)
    on conflict (session_id, generation, job_type) do nothing;
    update support_vnext_shadow.inactivity_jobs set status = 'COMPLETED' where job_id = p_job_id;
    -- The caller receives a signal only. Sending the approved warning remains a future orchestration step.
    return query select p_job_id, 'WARNING_WOULD_SEND', s.status::text, s.warning_due_at, s.close_due_at;
    return;
  end if;

  if j.job_type = 'CLOSE' and s.status = 'WARNING_SENT' then
    update support_vnext_shadow.conversation_sessions
    set status = 'CLOSED', closed_at = p_now, close_reason = 'INACTIVITY_SILENT', close_due_at = null,
        state_version = state_version + 1
    where session_id = s.session_id returning * into s;
    update support_vnext_shadow.inactivity_jobs set status = 'COMPLETED' where job_id = p_job_id;
    -- There is intentionally no outbound final-close action.
    return query select p_job_id, 'CLOSED_SILENTLY', s.status::text, s.warning_due_at, s.close_due_at;
    return;
  end if;

  update support_vnext_shadow.inactivity_jobs set status = 'SKIPPED' where job_id = p_job_id;
  return query select p_job_id, 'STATE_NOT_ACTIONABLE', s.status::text, s.warning_due_at, s.close_due_at;
end;
$$;

-- New isolated schema: no public client grants. Edge functions use a server-side key only.
revoke all on schema support_vnext_shadow from public, anon, authenticated;
revoke all on all tables in schema support_vnext_shadow from public, anon, authenticated;
revoke all on all sequences in schema support_vnext_shadow from public, anon, authenticated;
revoke all on all functions in schema support_vnext_shadow from public, anon, authenticated;
grant usage on schema support_vnext_shadow to service_role;
grant select, insert, update, delete on all tables in schema support_vnext_shadow to service_role;
grant execute on all functions in schema support_vnext_shadow to service_role;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'support_ruleset_release', 'knowledge_source', 'knowledge_service', 'knowledge_intent',
    'knowledge_condition', 'knowledge_asset', 'knowledge_document_requirement', 'knowledge_price',
    'knowledge_hours', 'knowledge_hours_exception', 'knowledge_message_template',
    'decision_handoff_policy', 'decision_request_policy', 'decision_sla_policy',
    'decision_conversation_policy', 'decision_session_policy', 'decision_rule',
    'conversation_sessions', 'session_release_transitions', 'conversation_topics',
    'pending_questions', 'message_batches', 'received_documents', 'pending_confirmations',
    'service_requests', 'handoffs', 'inactivity_jobs', 'state_events', 'decision_plans', 'protocol_sequences', 'feature_flags',
    'feature_flag_targets', 'shadow_comparisons'
  ] loop
    execute format('alter table support_vnext_shadow.%I enable row level security', tbl);
    execute format('create policy runtime_service_only on support_vnext_shadow.%I for all to service_role using (true) with check (true)', tbl);
  end loop;
end;
$$;

comment on function support_vnext_shadow.confirm_request_transaction is
  'New vNext-only transaction. It does not modify legacy support_service_requests or service_* tables.';
