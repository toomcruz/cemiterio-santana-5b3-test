-- SANA V1 / LAB integration: bind ledger materialization to the official commit.
--
-- This migration is LAB-only. It does not alter SANTANA/production, Edge
-- deployments, W-API delivery, or the legacy panel contract.
begin;

alter table support_runtime.turn_events
  drop constraint if exists turn_events_event_kind_check;

alter table support_runtime.turn_events
  add constraint turn_events_event_kind_check check (
    event_kind is null or event_kind in (
      'ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION','CHANGE_OF_MIND',
      'NEW_GOAL','COMPLAINT','HUMAN_REQUEST','SOCIAL','UNCERTAIN',
      'RECLASSIFICATION','FOCUS_CASE','RESUME_CASE','CLOSE'
    )
  );

create or replace function support_runtime.materialize_bindings(
  p_conversation_id uuid,
  p_revision bigint,
  p_state jsonb,
  p_receipt_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, support_runtime, extensions
as $$
declare
  v_binding jsonb;
  v_anchor jsonb;
  v_binding_id text;
  v_case_id text;
  v_subject_key text;
  v_scope text;
  v_lifecycle text;
  v_evidence text;
  v_replaced_by text;
  v_fingerprint text;
  v_existing support_runtime.subject_bindings;
  v_result jsonb := '[]'::jsonb;
begin
  if p_conversation_id is null or p_revision is null or p_revision <= 0
    or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'invalid binding materialization envelope' using errcode = '22023';
  end if;

  if jsonb_typeof(p_state->'binding_checkpoint'->'ledger'->'bindings') is distinct from 'array' then
    return v_result;
  end if;

  for v_binding in select value from jsonb_array_elements(p_state->'binding_checkpoint'->'ledger'->'bindings') loop
    v_binding_id := nullif(btrim(v_binding->>'binding_id'), '');
    v_case_id := nullif(btrim(v_binding->>'case_id'), '');
    v_subject_key := nullif(btrim(v_binding->>'subject_key'), '');
    v_scope := nullif(btrim(v_binding->>'scope'), '');
    v_lifecycle := nullif(btrim(v_binding->>'lifecycle'), '');
    v_anchor := v_binding->'anchor';
    v_evidence := nullif(v_binding->>'evidence', '');
    v_replaced_by := nullif(btrim(v_binding->>'replaced_by'), '');

    if v_binding_id is null or v_case_id is null or v_subject_key is null
      or v_scope not in ('NEW_RELATIONAL', 'NEW_NAMED')
      or v_lifecycle not in ('ACTIVE', 'INVALIDATED', 'REPLACED')
      or jsonb_typeof(v_anchor) is distinct from 'object'
      or v_evidence is null then
      raise exception 'invalid subject binding shape' using errcode = '22023';
    end if;
    if v_lifecycle = 'REPLACED' and v_replaced_by is null then
      raise exception 'replaced binding requires replaced_by' using errcode = '22023';
    end if;
    if v_lifecycle <> 'REPLACED' and v_replaced_by is not null then
      raise exception 'non-replaced binding cannot have replaced_by' using errcode = '22023';
    end if;

    v_fingerprint := encode(extensions.digest(convert_to(v_anchor::text, 'UTF8'), 'sha256'), 'hex');
    select * into v_existing
      from support_runtime.subject_bindings
     where conversation_id = p_conversation_id and binding_id = v_binding_id
     for update;
    if found then
      if v_existing.case_id <> v_case_id
        or v_existing.subject_key <> v_subject_key
        or v_existing.anchor_fingerprint <> v_fingerprint then
        raise exception 'subject binding identity collision' using errcode = '23505';
      end if;
      if v_existing.lifecycle = 'INVALIDATED' and v_lifecycle = 'ACTIVE' then
        raise exception 'invalidated subject binding cannot be reactivated' using errcode = '55000';
      end if;
    end if;

    insert into support_runtime.subject_bindings(
      conversation_id, binding_id, case_id, subject_key, scope, lifecycle,
      invalidatable, anchor, anchor_fingerprint, evidence, commit_receipt_id,
      replaced_by, revision, updated_at
    ) values (
      p_conversation_id, v_binding_id, v_case_id, v_subject_key, v_scope,
      v_lifecycle, coalesce((v_binding->>'invalidatable')::boolean, true),
      v_anchor, v_fingerprint, v_evidence,
      coalesce(nullif(v_binding->>'commit_receipt_id', '')::uuid, p_receipt_id),
      v_replaced_by, p_revision, now()
    )
    on conflict (conversation_id, binding_id) do update set
      lifecycle = excluded.lifecycle,
      invalidatable = excluded.invalidatable,
      evidence = excluded.evidence,
      commit_receipt_id = coalesce(excluded.commit_receipt_id, support_runtime.subject_bindings.commit_receipt_id),
      replaced_by = excluded.replaced_by,
      revision = excluded.revision,
      updated_at = now();

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'binding_id', v_binding_id,
      'case_id', v_case_id,
      'subject_key', v_subject_key,
      'lifecycle', v_lifecycle,
      'revision', p_revision
    ));
  end loop;
  return v_result;
end $$;

create or replace function public.support_runtime_commit_turn(
  p_conversation_id uuid,
  p_inbound_message_id uuid,
  p_expected_revision bigint,
  p_catalog_hash char(64),
  p_state_hash char(64),
  p_state jsonb,
  p_outcome text,
  p_event_kind text,
  p_reply_body text,
  p_projection jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions
as $$
declare
  v_state support_runtime.conversation_state;
  v_receipt support_runtime.inbound_receipts;
  v_event support_runtime.turn_events;
  v_conversation public.support_conversations;
  v_message_id uuid;
  v_outbox_id uuid;
  v_event_id uuid := extensions.gen_random_uuid();
  v_mode text;
  v_requests jsonb;
  v_reply jsonb;
  v_binding_id text;
  v_binding support_runtime.subject_bindings;
begin
  perform support_runtime.validate_commit(
    p_conversation_id, p_expected_revision, p_catalog_hash, p_state_hash,
    p_state, p_reply_body, p_projection
  );
  if p_outcome is null or p_outcome not in ('PROPOSED','CLARIFICATION','HUMAN_ACTIVE','INTERPRETATION_UNAVAILABLE') then
    raise exception 'invalid runtime outcome' using errcode = '22023';
  end if;
  if p_event_kind is not null and p_event_kind not in (
    'ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION','CHANGE_OF_MIND',
    'NEW_GOAL','COMPLAINT','HUMAN_REQUEST','SOCIAL','UNCERTAIN',
    'RECLASSIFICATION','FOCUS_CASE','RESUME_CASE','CLOSE'
  ) then
    raise exception 'invalid runtime event kind' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:' || p_conversation_id::text, 0));
  select * into v_conversation from public.support_conversations where id = p_conversation_id for update;
  if not found then raise exception 'conversation not found' using errcode = '22023'; end if;
  select * into v_receipt from support_runtime.inbound_receipts
    where inbound_message_id = p_inbound_message_id and conversation_id = p_conversation_id for update;
  if not found then raise exception 'inbound receipt not found' using errcode = '22023'; end if;
  select * into v_state from support_runtime.conversation_state where conversation_id = p_conversation_id for update;
  if not found then raise exception 'runtime state not found' using errcode = '22023'; end if;
  select * into v_event from support_runtime.turn_events where inbound_message_id = p_inbound_message_id;
  if found then
    return jsonb_build_object('replayed', true, 'revision', v_event.revision, 'outbox_id', v_event.outbox_id);
  end if;
  if v_state.revision <> p_expected_revision then
    raise exception 'conversation revision moved' using errcode = '55000';
  end if;
  if v_state.state_hash is not null and v_state.catalog_hash <> p_catalog_hash then
    raise exception 'catalog hash mismatch' using errcode = '22023';
  end if;

  v_binding_id := nullif(btrim(p_state->'binding_checkpoint'->>'current_binding_id'), '');
  -- Binding rows and their receipt link are created inside this transaction.
  perform support_runtime.materialize_bindings(
    p_conversation_id, p_expected_revision + 1, p_state, v_event_id
  );
  if v_binding_id is not null then
    select * into v_binding
      from support_runtime.subject_bindings
     where conversation_id = p_conversation_id
       and binding_id = v_binding_id
       and lifecycle = 'ACTIVE'
     for share;
    if not found then
      raise exception 'current subject binding is not active after materialization' using errcode = '22023';
    end if;
  end if;

  -- A human takeover after acquire wins. Never implicitly re-enable the bot.
  v_mode := case when v_conversation.automation_mode <> 'bot' then v_conversation.automation_mode
    else p_projection->>'automation_mode' end;
  v_requests := support_runtime.materialize_requests(p_conversation_id, p_state);
  if p_reply_body is not null and v_conversation.automation_mode = 'bot' then
    v_reply := support_runtime.reply_with_protocols(p_conversation_id, p_state, p_reply_body);
    insert into public.support_messages(
      conversation_id, direction, sender_type, body, message_type, delivery_status, metadata
    ) values (
      p_conversation_id, 'outbound', 'bot', v_reply->>'body', 'text', 'queued',
      jsonb_build_object(
        'runtime', 'santana-conversation-domain/v1',
        'inbound_message_id', p_inbound_message_id,
        'runtime_revision', p_expected_revision + 1,
        'request_ids', v_reply->'request_ids'
      )
    ) returning id into v_message_id;
    insert into support_runtime.outbound_queue(conversation_id, message_id, phone_e164, body)
      values (p_conversation_id, v_message_id, v_conversation.phone_e164, v_reply->>'body')
      returning outbox_id into v_outbox_id;
  end if;

  update support_runtime.conversation_state
     set revision = revision + 1, catalog_hash = p_catalog_hash,
         state_hash = p_state_hash, state = p_state, updated_at = now()
   where conversation_id = p_conversation_id;
  perform support_runtime.project_conversation(p_conversation_id, p_projection, v_mode, v_message_id, v_requests);
  update support_runtime.inbound_receipts
     set status = case when v_mode <> 'bot' then 'HUMAN_ACTIVE' else 'COMMITTED' end,
         committed_at = now()
   where inbound_message_id = p_inbound_message_id;
  insert into support_runtime.turn_events(
    event_id, conversation_id, inbound_message_id, revision, outcome, event_kind,
    catalog_hash, state_hash, reply_message_id, outbox_id, binding_id
  ) values (
    v_event_id, p_conversation_id, p_inbound_message_id, p_expected_revision + 1,
    p_outcome, p_event_kind, p_catalog_hash, p_state_hash, v_message_id, v_outbox_id,
    v_binding_id
  );
  return jsonb_build_object(
    'replayed', false,
    'revision', p_expected_revision + 1,
    'event_id', v_event_id,
    'binding_id', v_binding_id,
    'outbox_id', v_outbox_id,
    'requests', v_requests,
    'reply_body', v_reply->>'body',
    'reply_suppressed', p_reply_body is not null and v_message_id is null
  );
end $$;

revoke all on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb)
  to service_role;

commit;
