-- Official operator bridge. Additive migration; never re-run migrations 22–26.
-- Business decisions are validated by the official Edge engine. SQL owns
-- identity, revision, idempotency and the atomic public-panel projection.
begin;

create table support_runtime.operator_events (
  command_id uuid primary key,
  conversation_id uuid not null references public.support_conversations(id) on delete restrict,
  actor_id uuid not null references public.support_members(user_id) on delete restrict,
  expected_revision bigint not null check (expected_revision >= 0),
  revision bigint not null check (revision > 0),
  command_type text not null check (command_type in ('RESOLVE_ACTION','REVIEW_DOCUMENT','RESUME')),
  command jsonb not null check (jsonb_typeof(command) = 'object'),
  command_hash char(64) not null,
  catalog_hash char(64) not null,
  state_hash char(64) not null,
  reply_message_id uuid references public.support_messages(id) on delete restrict,
  outbox_id uuid references support_runtime.outbound_queue(outbox_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (conversation_id, revision)
);
alter table support_runtime.operator_events enable row level security;
revoke all on support_runtime.operator_events from public, anon, authenticated, service_role;
create index support_runtime_operator_events_actor_idx on support_runtime.operator_events(actor_id, created_at desc);

create function support_runtime.assert_operator(p_actor_id uuid) returns void
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if not exists (
    select 1 from public.support_members
    where user_id = p_actor_id and is_active and approval_status = 'approved'
      and (role = 'admin' or 'atendimentos' = any(permissions))
  ) then raise exception 'operator not authorized' using errcode = '42501'; end if;
end $$;

create function support_runtime.request_projection(p_conversation_id uuid) returns jsonb
language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'protocol', r.protocol, 'subject', r.subject, 'status', r.status,
    'summary', r.summary, 'goal_id', r.snapshot->>'runtime_goal_id',
    'created_at', r.created_at, 'updated_at', r.updated_at
  ) order by r.created_at, r.id), '[]'::jsonb)
  from public.support_service_requests r where r.conversation_id = p_conversation_id;
$$;

-- Materialize only explicit engine records, keeping the existing request table,
-- protocol sequence, operational statuses, defaults and panel triggers.
create function support_runtime.materialize_requests(p_conversation_id uuid, p_state jsonb, p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_record jsonb;
  v_id uuid;
  v_key text;
  v_goal_id text;
  v_subject text;
  v_existing public.support_service_requests;
begin
  if jsonb_typeof(coalesce(p_state->'solicitacoes', '[]'::jsonb)) <> 'array' then
    raise exception 'solicitacoes must be an array' using errcode = '22023';
  end if;
  for v_record in select value from jsonb_array_elements(coalesce(p_state->'solicitacoes', '[]'::jsonb)) loop
    v_id := (v_record->>'solicitacao_id')::uuid;
    v_goal_id := nullif(v_record->>'goal_id', '');
    if v_id is null or v_goal_id is null or not exists (
      select 1 from jsonb_array_elements(p_state->'goals') g where g->>'goal_id' = v_goal_id
    ) or nullif(btrim(v_record->>'summary'), '') is null then
      raise exception 'request requires a known goal, UUID and summary' using errcode = '22023';
    end if;
    v_key := 'runtime:' || p_conversation_id::text || ':' || v_id::text;
    select * into v_existing from public.support_service_requests
     where id = v_id or (conversation_id = p_conversation_id and idempotency_key = v_key) for update;
    if found then
      if v_existing.id <> v_id or v_existing.conversation_id <> p_conversation_id
        or v_existing.idempotency_key <> v_key
        or v_existing.snapshot->>'runtime_goal_id' is distinct from v_goal_id then
        raise exception 'runtime request identity collision' using errcode = '23505';
      end if;
      -- Human status/assignment/resolution are authoritative and never overwritten.
      update public.support_service_requests
      set summary=case when summary is not distinct from v_existing.snapshot->'runtime_request'->>'summary'
            then btrim(v_record->>'summary') else summary end,
          snapshot=snapshot || jsonb_build_object('runtime_request',v_record),updated_at=now()
      where id=v_id;
      continue;
    end if;
    v_subject := case v_record->>'topic_code'
      when 'EXUMACAO' then 'exumacao' when 'TRANSPORTE' then 'exumacao'
      when 'RECADASTRO' then 'recadastro' when 'CONCESSAO' then 'concessao'
      when 'COMERCIAL' then 'comercial' when 'OSSUARIO' then 'ossuario'
      when 'JAZIGO_SERVICOS' then 'obito_jazigo' else 'atendimento_humano' end;
    insert into public.support_service_requests(
      id, conversation_id, protocol, subject, status, summary, snapshot, idempotency_key, opened_by
    ) values (
      v_id, p_conversation_id,
      'SAN-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(nextval('public.support_service_request_protocol_seq')::text, 6, '0'),
      v_subject, 'pending_review', btrim(v_record->>'summary'),
      jsonb_build_object('source', 'support-runtime-inbound', 'runtime_goal_id', v_goal_id, 'runtime_request', v_record),
      v_key, p_actor_id
    );
  end loop;
  return support_runtime.request_projection(p_conversation_id);
end $$;

create function public.support_runtime_operator_snapshot(p_conversation_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_state support_runtime.conversation_state; v_conversation public.support_conversations;
begin
  perform support_runtime.assert_operator(p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:' || p_conversation_id::text, 0));
  select * into v_conversation from public.support_conversations where id = p_conversation_id for share;
  if not found then raise exception 'conversation not found' using errcode = '22023'; end if;
  select * into v_state from support_runtime.conversation_state where conversation_id = p_conversation_id for share;
  if not found or v_state.state is null then raise exception 'official runtime state not found' using errcode = '22023'; end if;
  return jsonb_build_object('conversation_id', p_conversation_id, 'state', v_state.state,
    'revision', v_state.revision, 'catalog_hash', v_state.catalog_hash,
    'control_version', v_conversation.updated_at,
    'automation_mode', v_conversation.automation_mode, 'phone_e164', v_conversation.phone_e164,
    'requests', support_runtime.request_projection(p_conversation_id));
end $$;

-- Announce real protocols only for this engine state's materialized requests.
-- Only a SENT official outbox acknowledges an announcement. Cancelled, failed
-- or superseded replies leave the protocol pending for the next valid reply.
create function support_runtime.reply_with_protocols(p_conversation_id uuid,p_state jsonb,p_reply_body text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_body text:=p_reply_body; v_ids jsonb:='[]'::jsonb; v_request record; v_note text;
begin
  if p_reply_body is null then return jsonb_build_object('body',null,'request_ids',v_ids); end if;
  for v_request in
    select r.id,r.protocol from public.support_service_requests r
    where r.conversation_id=p_conversation_id
      and r.idempotency_key='runtime:'||p_conversation_id::text||':'||r.id::text
      and exists(select 1 from jsonb_array_elements(coalesce(p_state->'solicitacoes','[]'::jsonb)) s
        where s->>'solicitacao_id'=r.id::text)
      and not exists(
        select 1 from support_runtime.outbound_queue q
        join public.support_messages m on m.id=q.message_id
        where q.conversation_id=p_conversation_id and q.status='SENT'
          and m.direction='outbound' and m.sender_type='bot'
          and m.metadata->>'runtime'='santana-conversation-domain/v1'
          and m.metadata->'request_ids' @> jsonb_build_array(r.id::text)
      )
    order by r.created_at,r.id
  loop
    v_note:=E'\n\nProtocolo do atendimento: '||v_request.protocol||'.';
    -- Never truncate the engine's question. A protocol that does not fit stays
    -- unannounced and can be included in a later shorter reply.
    if char_length(v_body)+char_length(v_note)<=4096 then
      v_body:=v_body||v_note;
      v_ids:=v_ids||jsonb_build_array(v_request.id::text);
    end if;
  end loop;
  return jsonb_build_object('body',v_body,'request_ids',v_ids);
end $$;

create function support_runtime.validate_commit(p_conversation_id uuid, p_expected_revision bigint,
  p_catalog_hash char(64), p_state_hash char(64), p_state jsonb, p_reply_body text, p_projection jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_conversation_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_catalog_hash is null or p_catalog_hash !~ '^[A-Fa-f0-9]{64}$'
    or p_state_hash is null or p_state_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid commit identity, revision or hashes' using errcode = '22023';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or p_state->>'conversation_id' is distinct from p_conversation_id::text then
    raise exception 'state does not belong to conversation' using errcode = '22023';
  end if;
  if p_reply_body is not null and (length(btrim(p_reply_body)) = 0 or length(p_reply_body) > 4096) then
    raise exception 'invalid reply body' using errcode = '22023';
  end if;
  if jsonb_typeof(p_projection) is distinct from 'object'
    or coalesce(p_projection->>'subject', '') not in ('nao_classificado','obito_jazigo','exumacao','recadastro','ossuario','concessao','comercial','atendimento_humano')
    or coalesce(p_projection->>'stage', '') not in ('novos','pendencias','documentos','aguardando','concluidos')
    or coalesce(p_projection->>'automation_mode', '') not in ('bot','human')
    or jsonb_typeof(p_projection->'flow_state') is distinct from 'object' then
    raise exception 'invalid projection' using errcode = '22023';
  end if;
end $$;

create function public.support_runtime_operator_replay(p_conversation_id uuid,p_actor_id uuid,p_command_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_event support_runtime.operator_events;
begin
  perform support_runtime.assert_operator(p_actor_id);
  if p_command_id is null or jsonb_typeof(p_command) is distinct from 'object'
    or p_command->>'command_id' is distinct from p_command_id::text
    or p_command->>'conversation_id' is distinct from p_conversation_id::text then
    raise exception 'invalid operator command envelope' using errcode='22023'; end if;
  select * into v_event from support_runtime.operator_events where command_id=p_command_id;
  if not found then return jsonb_build_object('replayed',false); end if;
  if v_event.conversation_id<>p_conversation_id or v_event.actor_id<>p_actor_id
    or v_event.command_hash<>encode(extensions.digest(p_command::text,'sha256'),'hex') then
    raise exception 'operator command identity collision' using errcode='23505'; end if;
  return jsonb_build_object('replayed',true,'revision',v_event.revision,'outbox_id',v_event.outbox_id,
    'requests',support_runtime.request_projection(p_conversation_id));
end $$;

-- One queue policy shared by inbound and operator commits. A team prerequisite
-- remains in the team's inbox even when an explanatory bot reply was emitted.
create function support_runtime.project_conversation(p_conversation_id uuid, p_projection jsonb,
  p_mode text, p_message_id uuid, p_requests jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare v_flow jsonb := p_projection->'flow_state'; v_waiting_team boolean;
begin
  v_waiting_team := coalesce(v_flow->>'waiting_for', '') = 'team'
    or coalesce(v_flow->>'handoff_requested', 'false') = 'true'
    or (nullif(v_flow->>'waiting_for', '') is null
      and coalesce(v_flow->>'active_goal_status', '') = 'WAITING'
      and nullif(v_flow->>'pending_question_code', '') is null
      and jsonb_array_length(coalesce(v_flow->'pending_action_codes', '[]'::jsonb)) > 0);
  update public.support_conversations
  set subject = p_projection->>'subject',
      stage = case when p_mode = 'closed' then stage else p_projection->>'stage' end,
      automation_mode = p_mode,
      flow_state = v_flow || jsonb_build_object('requests', p_requests),
      queue_status = case when p_mode = 'closed' then 'closed'
        when p_mode = 'human' or v_waiting_team then 'inbox'
        when p_projection->>'queue_status'='waiting_citizen'
          and nullif(v_flow->>'pending_question_code', '') is not null then 'waiting_citizen'
        else 'inbox' end,
      queue_updated_at = now(),
      last_outbound_at = case when p_message_id is not null then now() else last_outbound_at end,
      last_message_at = case when p_message_id is not null then now() else last_message_at end,
      updated_at = now()
  where id = p_conversation_id;
end $$;

create function public.support_runtime_commit_operator(p_conversation_id uuid, p_actor_id uuid,
  p_command_id uuid, p_expected_revision bigint, p_catalog_hash char(64), p_state_hash char(64),
  p_state jsonb, p_command jsonb, p_reply_body text, p_projection jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_state support_runtime.conversation_state;
  v_conversation public.support_conversations;
  v_event support_runtime.operator_events;
  v_command_hash text;
  v_message_id uuid;
  v_outbox_id uuid;
  v_mode text;
  v_requests jsonb;
  v_reply jsonb;
begin
  perform support_runtime.assert_operator(p_actor_id);
  perform support_runtime.validate_commit(p_conversation_id,p_expected_revision,p_catalog_hash,p_state_hash,p_state,p_reply_body,p_projection);
  if p_command_id is null or jsonb_typeof(p_command) is distinct from 'object'
    or coalesce(p_command->>'type', '') not in ('RESOLVE_ACTION','REVIEW_DOCUMENT','RESUME')
    or p_command->>'command_id' is distinct from p_command_id::text
    or p_command->>'conversation_id' is distinct from p_conversation_id::text
    or p_command->>'expected_revision' is distinct from p_expected_revision::text then
    raise exception 'invalid operator command envelope' using errcode = '22023';
  end if;
  v_command_hash := encode(extensions.digest(p_command::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:' || p_conversation_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:operator:' || p_command_id::text, 0));
  select * into v_conversation from public.support_conversations where id = p_conversation_id for update;
  if not found then raise exception 'conversation not found' using errcode = '22023'; end if;
  select * into v_event from support_runtime.operator_events where command_id = p_command_id;
  if found then
    if v_event.conversation_id <> p_conversation_id or v_event.actor_id <> p_actor_id
      or v_event.expected_revision <> p_expected_revision or v_event.command_hash <> v_command_hash then
      raise exception 'operator command identity collision' using errcode = '23505';
    end if;
    return jsonb_build_object('replayed', true, 'revision', v_event.revision, 'outbox_id', v_event.outbox_id,
      'requests', support_runtime.request_projection(p_conversation_id));
  end if;
  select * into v_state from support_runtime.conversation_state where conversation_id = p_conversation_id for update;
  if not found or v_state.state is null then raise exception 'official runtime state not found' using errcode = '22023'; end if;
  if v_state.revision <> p_expected_revision then raise exception 'conversation revision moved' using errcode = '55000'; end if;
  if v_state.catalog_hash <> p_catalog_hash then raise exception 'catalog hash mismatch' using errcode = '22023'; end if;
  -- Authorization can be revoked while the command waits for a conversation lock.
  perform support_runtime.assert_operator(p_actor_id);
  if p_command->>'type' = 'RESUME' then
    if nullif(p_command->>'expected_control_version','') is null then
      raise exception 'resume requires expected control version' using errcode='22023';
    end if;
    if (p_command->>'expected_control_version')::timestamptz is distinct from v_conversation.updated_at then
      raise exception 'conversation control moved' using errcode='55000';
    end if;
  end if;
  if p_command->>'type' = 'REVIEW_DOCUMENT' then
    if coalesce(p_command->>'document_status','') not in ('ACEITO','ILEGÍVEL_INADEQUADO') then
      raise exception 'invalid document review status' using errcode = '22023';
    end if;
    update public.support_documents set
      status = case p_command->>'document_status' when 'ACEITO' then 'approved' else 'rejected' end,
      reviewed_by = p_actor_id, review_notes = nullif(btrim(p_command->>'note'), ''), reviewed_at = now(), updated_at = now()
    where id = (p_command->>'document_id')::uuid and conversation_id = p_conversation_id;
    if not found then raise exception 'document does not belong to conversation' using errcode = '22023'; end if;
  end if;
  v_mode := case when p_command->>'type' = 'RESUME' then 'bot'
    when v_conversation.automation_mode <> 'bot' then v_conversation.automation_mode
    else p_projection->>'automation_mode' end;
  if p_command->>'type' = 'RESUME' and p_projection->>'automation_mode' <> 'bot' then
    raise exception 'resume requires bot projection' using errcode = '22023';
  end if;
  v_requests := support_runtime.materialize_requests(p_conversation_id,p_state,p_actor_id);
  if p_reply_body is not null and v_mode = 'bot' then
    v_reply:=support_runtime.reply_with_protocols(p_conversation_id,p_state,p_reply_body);
    insert into public.support_messages(conversation_id,direction,sender_type,body,message_type,delivery_status,metadata)
    values(p_conversation_id,'outbound','bot',v_reply->>'body','text','queued',
      jsonb_build_object('runtime','santana-conversation-domain/v1','operator_command_id',p_command_id,'runtime_revision',p_expected_revision+1,
        'request_ids',v_reply->'request_ids'))
    returning id into v_message_id;
    insert into support_runtime.outbound_queue(conversation_id,message_id,phone_e164,body)
    values(p_conversation_id,v_message_id,v_conversation.phone_e164,v_reply->>'body') returning outbox_id into v_outbox_id;
  end if;
  update support_runtime.conversation_state set revision=revision+1,catalog_hash=p_catalog_hash,
    state_hash=p_state_hash,state=p_state,updated_at=now() where conversation_id=p_conversation_id;
  perform support_runtime.project_conversation(p_conversation_id,p_projection,v_mode,v_message_id,v_requests);
  if p_command->>'type' = 'RESUME' then
    update public.support_conversations set closed_at=null,return_at=null,return_reason=null
      where id=p_conversation_id;
  end if;
  insert into support_runtime.operator_events(command_id,conversation_id,actor_id,expected_revision,revision,
    command_type,command,command_hash,catalog_hash,state_hash,reply_message_id,outbox_id)
  values(p_command_id,p_conversation_id,p_actor_id,p_expected_revision,p_expected_revision+1,
    p_command->>'type',p_command,v_command_hash,p_catalog_hash,p_state_hash,v_message_id,v_outbox_id);
  return jsonb_build_object('replayed',false,'revision',p_expected_revision+1,'outbox_id',v_outbox_id,'requests',v_requests,
    'reply_body',v_reply->>'body');
end $$;

create or replace function public.support_runtime_commit_turn(p_conversation_id uuid,p_inbound_message_id uuid,
  p_expected_revision bigint,p_catalog_hash char(64),p_state_hash char(64),p_state jsonb,
  p_outcome text,p_event_kind text,p_reply_body text,p_projection jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_state support_runtime.conversation_state; v_receipt support_runtime.inbound_receipts;
  v_event support_runtime.turn_events; v_conversation public.support_conversations;
  v_message_id uuid; v_outbox_id uuid; v_mode text; v_requests jsonb;
  v_reply jsonb;
begin
  perform support_runtime.validate_commit(p_conversation_id,p_expected_revision,p_catalog_hash,p_state_hash,p_state,p_reply_body,p_projection);
  if p_outcome is null or p_outcome not in ('PROPOSED','CLARIFICATION','HUMAN_ACTIVE','INTERPRETATION_UNAVAILABLE') then
    raise exception 'invalid runtime outcome' using errcode='22023';
  end if;
  if p_event_kind is not null and p_event_kind not in ('ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION',
    'CHANGE_OF_MIND','NEW_GOAL','COMPLAINT','HUMAN_REQUEST','SOCIAL','UNCERTAIN','RECLASSIFICATION') then
    raise exception 'invalid runtime event kind' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:'||p_conversation_id::text,0));
  select * into v_conversation from public.support_conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation not found' using errcode='22023'; end if;
  select * into v_receipt from support_runtime.inbound_receipts
    where inbound_message_id=p_inbound_message_id and conversation_id=p_conversation_id for update;
  if not found then raise exception 'inbound receipt not found' using errcode='22023'; end if;
  select * into v_state from support_runtime.conversation_state where conversation_id=p_conversation_id for update;
  if not found then raise exception 'runtime state not found' using errcode='22023'; end if;
  select * into v_event from support_runtime.turn_events where inbound_message_id=p_inbound_message_id;
  if found then return jsonb_build_object('replayed',true,'revision',v_event.revision,'outbox_id',v_event.outbox_id,
    'requests',support_runtime.request_projection(p_conversation_id)); end if;
  if v_state.revision<>p_expected_revision then raise exception 'conversation revision moved' using errcode='55000'; end if;
  if v_state.state_hash is not null and v_state.catalog_hash<>p_catalog_hash then
    raise exception 'catalog hash mismatch' using errcode='22023'; end if;
  -- A human takeover after acquire must win. Never implicitly re-enable the bot.
  v_mode:=case when v_conversation.automation_mode<>'bot' then v_conversation.automation_mode
    else p_projection->>'automation_mode' end;
  v_requests:=support_runtime.materialize_requests(p_conversation_id,p_state);
  if p_reply_body is not null and v_conversation.automation_mode='bot' then
    v_reply:=support_runtime.reply_with_protocols(p_conversation_id,p_state,p_reply_body);
    insert into public.support_messages(conversation_id,direction,sender_type,body,message_type,delivery_status,metadata)
    values(p_conversation_id,'outbound','bot',v_reply->>'body','text','queued',
      jsonb_build_object('runtime','santana-conversation-domain/v1','inbound_message_id',p_inbound_message_id,'runtime_revision',p_expected_revision+1,
        'request_ids',v_reply->'request_ids',
        'handoff_ack',v_mode='human' and p_state->'handoff' is not null and p_state->'handoff'<>'null'::jsonb))
    returning id into v_message_id;
    insert into support_runtime.outbound_queue(conversation_id,message_id,phone_e164,body)
    values(p_conversation_id,v_message_id,v_conversation.phone_e164,v_reply->>'body') returning outbox_id into v_outbox_id;
  end if;
  update support_runtime.conversation_state set revision=revision+1,catalog_hash=p_catalog_hash,state_hash=p_state_hash,
    state=p_state,updated_at=now() where conversation_id=p_conversation_id;
  perform support_runtime.project_conversation(p_conversation_id,p_projection,v_mode,v_message_id,v_requests);
  update support_runtime.inbound_receipts set status=case when v_mode<>'bot' then 'HUMAN_ACTIVE' else 'COMMITTED' end,
    committed_at=now() where inbound_message_id=p_inbound_message_id;
  insert into support_runtime.turn_events(conversation_id,inbound_message_id,revision,outcome,event_kind,catalog_hash,state_hash,reply_message_id,outbox_id)
  values(p_conversation_id,p_inbound_message_id,p_expected_revision+1,p_outcome,p_event_kind,p_catalog_hash,p_state_hash,v_message_id,v_outbox_id);
  return jsonb_build_object('replayed',false,'revision',p_expected_revision+1,'outbox_id',v_outbox_id,'requests',v_requests,
    'reply_body',v_reply->>'body',
    'reply_suppressed',p_reply_body is not null and v_message_id is null);
end $$;

create or replace function public.support_runtime_claim_delivery(p_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v support_runtime.outbound_queue; v_conversation public.support_conversations; v_metadata jsonb;
  v_current_revision bigint; v_delivery_revision numeric;
begin
  select * into v from support_runtime.outbound_queue where outbox_id=p_outbox_id;
  if not found then raise exception 'runtime outbox item not found' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:'||v.conversation_id::text,0));
  select * into v_conversation from public.support_conversations where id=v.conversation_id for update;
  select * into v from support_runtime.outbound_queue where outbox_id=p_outbox_id for update;
  if v.status='SENT' then return jsonb_build_object('claimed',false,'status','SENT'); end if;
  if v.status<>'PENDING' and not (v.status='PROCESSING' and v.updated_at<now()-interval '5 minutes') then
    return jsonb_build_object('claimed',false,'status',v.status); end if;
  select metadata into v_metadata from public.support_messages where id=v.message_id;
  select revision into v_current_revision from support_runtime.conversation_state where conversation_id=v.conversation_id for share;
  -- The revision is application-generated JSON. Reject malformed/missing values
  -- without unsafe bigint casts, and never deliver a superseded question.
  if jsonb_typeof(v_metadata->'runtime_revision')='number'
    and v_metadata->>'runtime_revision' ~ '^[0-9]{1,19}$' then
    v_delivery_revision := (v_metadata->>'runtime_revision')::numeric;
  end if;
  if (v_conversation.automation_mode<>'bot' and not (v_conversation.automation_mode='human'
      and coalesce(v_metadata->>'handoff_ack','false')='true')) or v_conversation.human_takeover_at>v.created_at
    or v_delivery_revision is null or v_current_revision is null or v_delivery_revision<>v_current_revision then
    update support_runtime.outbound_queue set status='CANCELLED',last_error='STALE_OR_HUMAN_TAKEOVER',updated_at=now()
      where outbox_id=p_outbox_id;
    update public.support_messages set delivery_status='failed' where id=v.message_id;
    return jsonb_build_object('claimed',false,'status','CANCELLED');
  end if;
  update support_runtime.outbound_queue set status='PROCESSING',attempts=attempts+1,last_error=null,updated_at=now()
    where outbox_id=p_outbox_id returning * into v;
  return jsonb_build_object('claimed',true,'outbox_id',v.outbox_id,'message_id',v.message_id,
    'conversation_id',v.conversation_id,'phone_e164',v.phone_e164,'body',v.body);
end $$;

revoke all on function support_runtime.assert_operator(uuid) from public,anon,authenticated,service_role;
revoke all on function support_runtime.request_projection(uuid) from public,anon,authenticated,service_role;
revoke all on function support_runtime.reply_with_protocols(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function support_runtime.materialize_requests(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function support_runtime.validate_commit(uuid,bigint,char,char,jsonb,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function support_runtime.project_conversation(uuid,jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.support_runtime_operator_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.support_runtime_operator_replay(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.support_runtime_commit_operator(uuid,uuid,uuid,bigint,char,char,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.support_runtime_claim_delivery(uuid) from public,anon,authenticated;
grant execute on function public.support_runtime_operator_snapshot(uuid,uuid) to service_role;
grant execute on function public.support_runtime_operator_replay(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.support_runtime_commit_operator(uuid,uuid,uuid,bigint,char,char,jsonb,jsonb,text,jsonb) to service_role;
grant execute on function public.support_runtime_commit_turn(uuid,uuid,bigint,char,char,jsonb,text,text,text,jsonb) to service_role;
grant execute on function public.support_runtime_claim_delivery(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.set_support_automation_mode(p_conversation_id uuid, p_mode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_closed_topics integer := 0;
  v_runtime boolean;
begin
  if not public.is_support_member() then
    raise exception 'Not authorized';
  end if;

  if p_mode not in ('bot', 'human', 'closed') then
    raise exception 'Invalid automation mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support-runtime:conversation:' || p_conversation_id::text, 0));
  select flow_state->>'runtime' = 'santana-conversation-domain/v1'
    into v_runtime from public.support_conversations where id = p_conversation_id for update;
  if coalesce(v_runtime, false) then
    if not exists (select 1 from public.support_members where user_id = (select auth.uid())
      and is_active and approval_status = 'approved'
      and (role = 'admin' or 'atendimentos' = any(permissions))) then
      raise exception 'operator not authorized' using errcode = '42501';
    end if;
    if p_mode = 'bot' then
      raise exception 'Use the official RESUME command to preserve runtime state' using errcode = '55000';
    end if;
    update public.support_conversations
    set automation_mode=p_mode,
        human_takeover_at=case when p_mode='human' then v_now else human_takeover_at end,
        closed_at=case when p_mode='closed' then v_now else closed_at end,
        stage=case when p_mode='closed' then 'concluidos' else stage end,
        queue_status=case when p_mode='closed' then 'closed' else 'inbox' end,
        queue_updated_at=v_now,updated_at=v_now
    where id=p_conversation_id;
    insert into public.support_events(conversation_id,event_type,description,actor_id,data)
    values(p_conversation_id,'automation_mode_changed',
      case when p_mode='human' then 'Atendimento assumido pela equipe; contexto preservado' else 'Atendimento encerrado; contexto preservado' end,
      auth.uid(),jsonb_build_object('mode',p_mode,'memory_cleared',false,'new_triage',false,'runtime','santana-conversation-domain/v1'));
    return true;
  end if;

  if p_mode in ('bot', 'closed') then
    update public.support_conversation_topics
    set
      is_active = false,
      status = case
        when request_id is null
          and status in (
            'draft',
            'collecting',
            'waiting_citizen',
            'waiting_confirmation',
            'ready',
            'formalized',
            'waiting_team'
          )
        then 'cancelled'
        else status
      end,
      closed_at = case
        when request_id is null then coalesce(closed_at, v_now)
        else closed_at
      end,
      updated_at = v_now
    where conversation_id = p_conversation_id
      and is_active = true;

    get diagnostics v_closed_topics = row_count;
  end if;

  update public.support_conversations
  set
    automation_mode = p_mode,
    human_takeover_at = case
      when p_mode = 'human' then coalesce(human_takeover_at, v_now)
      else null
    end,
    closed_at = case
      when p_mode = 'closed' then v_now
      when p_mode = 'bot' then null
      else closed_at
    end,
    stage = case
      when p_mode = 'closed' then 'concluidos'
      when p_mode = 'bot' then 'aguardando'
      when stage = 'concluidos' then 'novos'
      else stage
    end,
    subject = case
      when p_mode in ('bot', 'closed') then 'nao_classificado'
      else subject
    end,
    queue_status = case
      when p_mode = 'closed' then 'closed'
      when p_mode = 'bot' then 'waiting_citizen'
      else queue_status
    end,
    flow_state = case
      when p_mode in ('bot', 'closed') then '{}'::jsonb
      else flow_state
    end,
    return_at = case when p_mode in ('bot', 'closed') then null else return_at end,
    return_reason = case when p_mode in ('bot', 'closed') then null else return_reason end,
    awaiting_response_since = case
      when p_mode in ('bot', 'closed') then null
      else awaiting_response_since
    end,
    response_due_at = case
      when p_mode in ('bot', 'closed') then null
      else response_due_at
    end,
    queue_updated_at = v_now,
    updated_at = v_now
  where id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found';
  end if;

  insert into public.support_events (
    conversation_id,
    event_type,
    description,
    actor_id,
    data
  ) values (
    p_conversation_id,
    'automation_mode_changed',
    case
      when p_mode = 'bot' then 'Atendimento devolvido ao robô; nova triagem iniciada'
      when p_mode = 'human' then 'Atendimento assumido pela equipe'
      else 'Atendimento encerrado'
    end,
    auth.uid(),
    jsonb_build_object(
      'mode', p_mode,
      'closed_active_topics', v_closed_topics,
      'memory_cleared', p_mode in ('bot', 'closed'),
      'new_triage', p_mode = 'bot'
    )
  );

  return true;
end;
$function$;

commit;
