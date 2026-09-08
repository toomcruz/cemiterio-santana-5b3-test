-- 5B.4-D: runtime definitivo do Santana Conversation Domain.
--
-- O schema privado `support_runtime` é a autoridade de estado, deduplicação,
-- eventos e fila do robô. As tabelas `public.support_*` continuam apenas como
-- projeção para o painel já publicado; esta migration não chama n8n, não lê
-- `service_*` e não cria fallback para o fluxo antigo.
--
-- Aplicar primeiro em ambiente isolado. As funções públicas são exclusivamente
-- para `service_role`, com SECURITY DEFINER e search_path fixo.
begin;

create schema if not exists support_runtime;
revoke all on schema support_runtime from public, anon, authenticated;
grant usage on schema support_runtime to service_role;

create table if not exists support_runtime.conversation_state (
  conversation_id uuid primary key references public.support_conversations(id) on delete restrict,
  revision bigint not null default 0 check (revision >= 0),
  catalog_hash char(64) null check (catalog_hash ~ '^[A-Fa-f0-9]{64}$'),
  state_hash char(64) null check (state_hash ~ '^[A-Fa-f0-9]{64}$'),
  state jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state is null) = (state_hash is null))
);

create table if not exists support_runtime.inbound_receipts (
  inbound_message_id uuid primary key references public.support_messages(id) on delete restrict,
  conversation_id uuid not null references public.support_conversations(id) on delete restrict,
  external_message_id text not null unique check (char_length(external_message_id) between 1 and 512),
  content_hash char(64) not null check (content_hash ~ '^[A-Fa-f0-9]{64}$'),
  status text not null check (status in ('RECEIVED','COMMITTED','HUMAN_ACTIVE','FAILED')),
  created_at timestamptz not null default now(),
  committed_at timestamptz null
);
create index if not exists support_runtime_inbound_conversation_idx
  on support_runtime.inbound_receipts(conversation_id, created_at desc);

create table if not exists support_runtime.turn_events (
  event_id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete restrict,
  inbound_message_id uuid not null unique references support_runtime.inbound_receipts(inbound_message_id) on delete restrict,
  revision bigint not null check (revision > 0),
  outcome text not null check (outcome in ('PROPOSED','CLARIFICATION','HUMAN_ACTIVE','INTERPRETATION_UNAVAILABLE')),
  event_kind text null check (event_kind is null or event_kind in (
    'ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION','CHANGE_OF_MIND','NEW_GOAL','COMPLAINT',
    'HUMAN_REQUEST','SOCIAL','UNCERTAIN','RECLASSIFICATION'
  )),
  catalog_hash char(64) not null check (catalog_hash ~ '^[A-Fa-f0-9]{64}$'),
  state_hash char(64) not null check (state_hash ~ '^[A-Fa-f0-9]{64}$'),
  reply_message_id uuid null references public.support_messages(id) on delete restrict,
  outbox_id uuid null,
  created_at timestamptz not null default now(),
  unique (conversation_id, revision)
);

create table if not exists support_runtime.outbound_queue (
  outbox_id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete restrict,
  message_id uuid not null unique references public.support_messages(id) on delete restrict,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  body text not null check (char_length(body) between 1 and 4096),
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempts integer not null default 0 check (attempts >= 0),
  external_message_id text null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz null
);
create index if not exists support_runtime_outbound_pending_idx
  on support_runtime.outbound_queue(status, created_at)
  where status in ('PENDING','PROCESSING');

alter table support_runtime.conversation_state enable row level security;
alter table support_runtime.inbound_receipts enable row level security;
alter table support_runtime.turn_events enable row level security;
alter table support_runtime.outbound_queue enable row level security;
revoke all on all tables in schema support_runtime from public, anon, authenticated;
revoke all on all sequences in schema support_runtime from public, anon, authenticated;

-- Cria/obtém a conversa, grava somente a entrada e devolve uma fotografia
-- consistente. O motor TypeScript roda depois desta transação; ele nunca é
-- reexecutado para uma entrada cujo recibo já exista.
create or replace function public.support_runtime_acquire_inbound(
  p_external_message_id text,
  p_phone_e164 text,
  p_contact_name text,
  p_body text,
  p_message_type text,
  p_metadata jsonb,
  p_catalog_hash char(64)
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone_e164,''), '\D', '', 'g');
  v_conversation public.support_conversations;
  v_message public.support_messages;
  v_state support_runtime.conversation_state;
  v_existing_receipt support_runtime.inbound_receipts;
  v_content_hash text;
  v_duplicate boolean := false;
begin
  if p_external_message_id is null or btrim(p_external_message_id) = '' or char_length(p_external_message_id) > 512 then
    raise exception 'external_message_id is required' using errcode = '22023';
  end if;
  if v_phone !~ '^55[0-9]{10,11}$' then raise exception 'invalid Brazilian phone' using errcode = '22023'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 8000 then
    raise exception 'invalid inbound body' using errcode = '22023';
  end if;
  if p_message_type not in ('text','image','document','audio') then
    raise exception 'invalid inbound message type' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'metadata must be an object' using errcode = '22023';
  end if;
  if p_catalog_hash is null or p_catalog_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid catalog hash' using errcode = '22023';
  end if;
  v_content_hash := encode(extensions.digest(p_body, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('support-runtime:phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:inbound:' || p_external_message_id, 0));

  select * into v_conversation
    from public.support_conversations
   where external_id = v_phone or regexp_replace(phone_e164, '\D', '', 'g') = v_phone
   order by created_at asc limit 1 for update;
  if not found then
    insert into public.support_conversations(
      external_id, contact_name, phone_e164, subject, stage, automation_mode, queue_status
    ) values (
      v_phone,
      coalesce(nullif(left(btrim(p_contact_name), 180), ''), 'WhatsApp ' || v_phone),
      '+' || v_phone,
      'nao_classificado', 'novos', 'bot', 'inbox'
    ) returning * into v_conversation;
  end if;

  insert into public.support_messages(
    conversation_id, direction, sender_type, body, message_type, external_message_id, delivery_status, metadata
  ) values (
    v_conversation.id, 'inbound', 'citizen', p_body, p_message_type, p_external_message_id, 'received',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('runtime', 'santana-conversation-domain/v1')
  ) on conflict (external_message_id) do nothing returning * into v_message;

  if not found then
    v_duplicate := true;
    select * into v_message from public.support_messages where external_message_id = p_external_message_id;
    if not found then raise exception 'inbound conflict could not be read' using errcode = '40001'; end if;
    if v_message.direction <> 'inbound' or v_message.sender_type <> 'citizen' then
      raise exception 'external message id conflicts with a non-inbound message' using errcode = '22023';
    end if;
    select * into v_existing_receipt
      from support_runtime.inbound_receipts where inbound_message_id = v_message.id;
    if found and v_existing_receipt.content_hash <> v_content_hash then
      raise exception 'external message id content collision' using errcode = '22023';
    end if;
    select * into v_conversation from public.support_conversations where id = v_message.conversation_id for update;
  else
    update public.support_conversations
       set contact_name = coalesce(nullif(left(btrim(p_contact_name), 180), ''), contact_name),
           last_inbound_at = now(), last_message_at = now(), unread_count = unread_count + 1,
           queue_status = 'inbox', return_at = null, return_reason = null, queue_updated_at = now(),
           updated_at = now()
     where id = v_conversation.id;
    insert into support_runtime.inbound_receipts(
      inbound_message_id, conversation_id, external_message_id, content_hash, status
    ) values (
      v_message.id, v_conversation.id, p_external_message_id,
      v_content_hash, 'RECEIVED'
    ) on conflict (inbound_message_id) do nothing;
  end if;

  insert into support_runtime.conversation_state(conversation_id, catalog_hash)
  values (v_conversation.id, p_catalog_hash)
  on conflict (conversation_id) do nothing;
  select * into v_state from support_runtime.conversation_state where conversation_id = v_conversation.id;

  return jsonb_build_object(
    'duplicate', v_duplicate,
    'conversation_id', v_conversation.id,
    'inbound_message_id', v_message.id,
    'revision', v_state.revision,
    'automation_mode', case when v_conversation.automation_mode = 'bot' then 'BOT_ACTIVE' else 'HUMAN_ACTIVE' end,
    'catalog_hash', v_state.catalog_hash,
    'state', v_state.state
  );
end $$;

-- Comita estado, evento, projeção do painel e fila privada em uma única
-- transação. Nenhuma mensagem é enviada nesta função.
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
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare
  v_state support_runtime.conversation_state;
  v_receipt support_runtime.inbound_receipts;
  v_event support_runtime.turn_events;
  v_message_id uuid := null;
  v_outbox_id uuid := null;
  v_subject text;
  v_stage text;
  v_mode text;
begin
  if p_expected_revision < 0 then raise exception 'invalid expected revision' using errcode = '22023'; end if;
  if p_catalog_hash is null or p_catalog_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid catalog hash' using errcode = '22023';
  end if;
  if p_state_hash is null or p_state_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid state hash' using errcode = '22023';
  end if;
  if jsonb_typeof(p_state) <> 'object' or p_state->>'conversation_id' <> p_conversation_id::text then
    raise exception 'state does not belong to conversation' using errcode = '22023';
  end if;
  if p_outcome not in ('PROPOSED','CLARIFICATION','HUMAN_ACTIVE','INTERPRETATION_UNAVAILABLE') then
    raise exception 'invalid runtime outcome' using errcode = '22023';
  end if;
  if p_event_kind is not null and p_event_kind not in (
    'ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION','CHANGE_OF_MIND','NEW_GOAL','COMPLAINT',
    'HUMAN_REQUEST','SOCIAL','UNCERTAIN','RECLASSIFICATION'
  ) then raise exception 'invalid runtime event kind' using errcode = '22023'; end if;
  if p_reply_body is not null and (char_length(btrim(p_reply_body)) = 0 or char_length(p_reply_body) > 4096) then
    raise exception 'invalid reply body' using errcode = '22023';
  end if;
  if jsonb_typeof(p_projection) <> 'object' then raise exception 'invalid projection' using errcode = '22023'; end if;
  v_subject := p_projection->>'subject';
  v_stage := p_projection->>'stage';
  v_mode := p_projection->>'automation_mode';
  if v_subject not in ('nao_classificado','exumacao','recadastro','ossuario','concessao','comercial') then
    raise exception 'invalid projected subject' using errcode = '22023';
  end if;
  if v_stage not in ('novos','pendencias','aguardando') then raise exception 'invalid projected stage' using errcode = '22023'; end if;
  if v_mode not in ('bot','human') then raise exception 'invalid projected automation mode' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:' || p_conversation_id::text, 0));
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

  if p_reply_body is not null then
    insert into public.support_messages(
      conversation_id, direction, sender_type, body, message_type, delivery_status, metadata
    ) values (
      p_conversation_id, 'outbound', 'bot', p_reply_body, 'text', 'queued',
      jsonb_build_object('runtime', 'santana-conversation-domain/v1', 'inbound_message_id', p_inbound_message_id)
    ) returning id into v_message_id;
    insert into support_runtime.outbound_queue(conversation_id, message_id, phone_e164, body)
      select p_conversation_id, v_message_id, phone_e164, p_reply_body
        from public.support_conversations where id = p_conversation_id
      returning outbox_id into v_outbox_id;
  end if;

  update support_runtime.conversation_state
     set revision = revision + 1, catalog_hash = p_catalog_hash, state_hash = p_state_hash,
         state = p_state, updated_at = now()
   where conversation_id = p_conversation_id;
  update public.support_conversations
     set subject = v_subject, stage = v_stage, automation_mode = v_mode,
         flow_state = coalesce(p_projection->'flow_state', '{}'::jsonb),
         queue_status = case when v_mode = 'human' then 'inbox' when v_message_id is not null then 'waiting_citizen' else queue_status end,
         last_outbound_at = case when v_message_id is not null then now() else last_outbound_at end,
         last_message_at = case when v_message_id is not null then now() else last_message_at end,
         updated_at = now()
   where id = p_conversation_id;
  update support_runtime.inbound_receipts set status = case when v_mode = 'human' then 'HUMAN_ACTIVE' else 'COMMITTED' end,
         committed_at = now() where inbound_message_id = p_inbound_message_id;
  insert into support_runtime.turn_events(
    conversation_id, inbound_message_id, revision, outcome, event_kind, catalog_hash, state_hash, reply_message_id, outbox_id
  ) values (
    p_conversation_id, p_inbound_message_id, p_expected_revision + 1, p_outcome, p_event_kind,
    p_catalog_hash, p_state_hash, v_message_id, v_outbox_id
  );
  return jsonb_build_object('replayed', false, 'revision', p_expected_revision + 1, 'outbox_id', v_outbox_id);
end $$;

create or replace function public.support_runtime_claim_delivery(p_outbox_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare v support_runtime.outbound_queue;
begin
  select * into v from support_runtime.outbound_queue where outbox_id = p_outbox_id for update;
  if not found then raise exception 'runtime outbox item not found' using errcode = '22023'; end if;
  if v.status = 'SENT' then return jsonb_build_object('claimed', false, 'status', 'SENT'); end if;
  if v.status <> 'PENDING' and not (v.status = 'PROCESSING' and v.updated_at < now() - interval '5 minutes') then
    return jsonb_build_object('claimed', false, 'status', v.status);
  end if;
  update support_runtime.outbound_queue
     set status = 'PROCESSING', attempts = attempts + 1, last_error = null, updated_at = now()
   where outbox_id = p_outbox_id returning * into v;
  return jsonb_build_object(
    'claimed', true, 'outbox_id', v.outbox_id, 'message_id', v.message_id,
    'conversation_id', v.conversation_id, 'phone_e164', v.phone_e164, 'body', v.body
  );
end $$;

create or replace function public.support_runtime_complete_delivery(p_outbox_id uuid, p_external_message_id text default null)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare v support_runtime.outbound_queue;
begin
  update support_runtime.outbound_queue
     set status = 'SENT', external_message_id = nullif(btrim(p_external_message_id), ''),
         processed_at = now(), updated_at = now(), last_error = null
   where outbox_id = p_outbox_id and status = 'PROCESSING' returning * into v;
  if not found then return false; end if;
  update public.support_messages set delivery_status = 'sent',
         external_message_id = coalesce(nullif(btrim(p_external_message_id), ''), external_message_id)
   where id = v.message_id;
  return true;
end $$;

create or replace function public.support_runtime_fail_delivery(p_outbox_id uuid, p_error text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare v support_runtime.outbound_queue;
begin
  update support_runtime.outbound_queue
     set status = 'FAILED', last_error = left(coalesce(nullif(btrim(p_error), ''), 'delivery failed'), 500),
         updated_at = now()
   where outbox_id = p_outbox_id and status = 'PROCESSING' returning * into v;
  if not found then return false; end if;
  update public.support_messages set delivery_status = 'failed' where id = v.message_id;
  return true;
end $$;

revoke all on function public.support_runtime_acquire_inbound(text,text,text,text,text,jsonb,char) from public, anon, authenticated;
revoke all on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.support_runtime_claim_delivery(uuid) from public, anon, authenticated;
revoke all on function public.support_runtime_complete_delivery(uuid,text) from public, anon, authenticated;
revoke all on function public.support_runtime_fail_delivery(uuid,text) from public, anon, authenticated;
grant execute on function public.support_runtime_acquire_inbound(text,text,text,text,text,jsonb,char) to service_role;
grant execute on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb) to service_role;
grant execute on function public.support_runtime_claim_delivery(uuid) to service_role;
grant execute on function public.support_runtime_complete_delivery(uuid,text) to service_role;
grant execute on function public.support_runtime_fail_delivery(uuid,text) to service_role;

commit;
