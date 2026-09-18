-- SANA V1 / B2 — revisão aditiva do ledger de subject bindings.
--
-- STATUS: PROPOSTA PARA LAB / SHADOW. NÃO APLICAR EM SANTANA.
--
-- Esta migration parte do runtime oficial já existente em 0022–0026 e no
-- operations bridge. Ela não cria `sana_runtime`, não duplica receipts e não
-- apaga histórico V46. O código de commit_turn precisa chamar
-- support_runtime.materialize_bindings dentro da mesma transação que atualiza
-- conversation_state, inbound_receipts, turn_events e outbound_queue.
--
-- Compatibilidade V46: binding_id é nullable em turn_events; estados históricos
-- sem binding permanecem válidos. ON DELETE é RESTRICT para estado, receipts,
-- bindings, eventos e outbox: auditoria não é apagada por cascata.

begin;

create table if not exists support_runtime.subject_bindings (
  conversation_id uuid not null
    references public.support_conversations(id) on delete restrict,
  binding_id text not null
    check (char_length(binding_id) between 1 and 180),
  case_id text not null
    check (char_length(case_id) between 1 and 180),
  subject_key text not null
    check (char_length(subject_key) between 1 and 240),
  scope text not null
    check (scope in ('NEW_RELATIONAL', 'NEW_NAMED')),
  lifecycle text not null
    check (lifecycle in ('ACTIVE', 'INVALIDATED', 'REPLACED')),
  invalidatable boolean not null default true,
  anchor jsonb not null
    check (jsonb_typeof(anchor) = 'object'),
  anchor_fingerprint char(64) not null
    check (anchor_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
  evidence text not null
    check (char_length(evidence) between 1 and 4096),
  commit_receipt_id uuid null
    references support_runtime.turn_events(event_id)
    on delete restrict
    deferrable initially deferred,
  replaced_by text null,
  revision bigint not null
    check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, binding_id),
  check ((lifecycle = 'REPLACED') = (replaced_by is not null)),
  check (lifecycle <> 'REPLACED' or replaced_by <> binding_id),
  unique (conversation_id, binding_id, anchor_fingerprint)
);

create index if not exists subject_bindings_active_subject_idx
  on support_runtime.subject_bindings(conversation_id, subject_key)
  where lifecycle = 'ACTIVE';

create unique index if not exists subject_bindings_active_anchor_idx
  on support_runtime.subject_bindings(conversation_id, subject_key, anchor_fingerprint)
  where lifecycle = 'ACTIVE';

alter table support_runtime.turn_events
  add column if not exists binding_id text null
    check (binding_id is null or char_length(binding_id) between 1 and 180);

-- Enforce that a turn receipt belongs to the same conversation as its event.
-- The existing single-column FK is retained for V46 compatibility; this
-- composite FK closes the cross-conversation association gap.
alter table support_runtime.inbound_receipts
  add constraint inbound_receipts_conversation_message_key
  unique (conversation_id, inbound_message_id);

alter table support_runtime.turn_events
  add constraint turn_events_conversation_inbound_fk
  foreign key (conversation_id, inbound_message_id)
  references support_runtime.inbound_receipts(conversation_id, inbound_message_id)
  on delete restrict;

alter table support_runtime.turn_events
  add constraint turn_events_binding_fk
  foreign key (conversation_id, binding_id)
  references support_runtime.subject_bindings(conversation_id, binding_id)
  on delete restrict;

alter table support_runtime.turn_events
  add constraint turn_events_outbox_fk
  foreign key (outbox_id)
  references support_runtime.outbound_queue(outbox_id)
  on delete restrict;

alter table support_runtime.subject_bindings enable row level security;
revoke all on support_runtime.subject_bindings from public, anon, authenticated, service_role;

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

  -- Official V1 state may omit the historical bridge checkpoint. In that case
  -- this is a deliberate no-op; no binding is inferred from goals or LLM data.
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
      nullif(v_binding->>'commit_receipt_id', '')::uuid,
      v_replaced_by, p_revision, now()
    )
    on conflict (conversation_id, binding_id) do update set
      lifecycle = excluded.lifecycle,
      invalidatable = excluded.invalidatable,
      evidence = excluded.evidence,
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

revoke all on function support_runtime.materialize_bindings(uuid,bigint,jsonb,uuid)
  from public, anon, authenticated, service_role;

commit;

-- REQUIRED CODE INTEGRATION (not executable SQL):
-- In the official support_runtime_commit_turn transaction, after the revision
-- check and before updating conversation_state/turn_events, call:
--   v_event_id := extensions.gen_random_uuid();
--   perform support_runtime.materialize_bindings(
--     p_conversation_id, p_expected_revision + 1, p_state, v_event_id
--   );
-- Then populate turn_events.binding_id only from an ACTIVE binding present in
-- p_state->'binding_checkpoint'->>'current_binding_id'. The adapter must reject
-- a non-existent, inactive, or cross-conversation binding. This keeps state,
-- binding, receipt, event and outbox in one transaction; a remote LLM call is
-- still outside the transaction.
