-- 5B.4-F: recuperação segura de uma entrada recebida cuja execução tenha
-- parado antes do commit. Replays depois de COMMITTED/HUMAN_ACTIVE continuam
-- deduplicados; somente recibos ainda pendentes podem ser retomados.
begin;

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
    select * into v_message from public.support_messages where external_message_id = p_external_message_id;
    if not found then raise exception 'inbound conflict could not be read' using errcode = '40001'; end if;
    if v_message.direction <> 'inbound' or v_message.sender_type <> 'citizen' then
      raise exception 'external message id conflicts with a non-inbound message' using errcode = '22023';
    end if;
    select * into v_existing_receipt
      from support_runtime.inbound_receipts where inbound_message_id = v_message.id for update;
    if found then
      if v_existing_receipt.content_hash <> v_content_hash then
        raise exception 'external message id content collision' using errcode = '22023';
      end if;
      v_duplicate := v_existing_receipt.status in ('COMMITTED','HUMAN_ACTIVE');
    else
      -- Mensagem histórica do painel: não a interpretamos retroativamente.
      v_duplicate := true;
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
      v_message.id, v_conversation.id, p_external_message_id, v_content_hash, 'RECEIVED'
    ) on conflict (inbound_message_id) do nothing;
  end if;

  if not v_duplicate then
    insert into support_runtime.conversation_state(conversation_id, catalog_hash)
    values (v_conversation.id, p_catalog_hash)
    on conflict (conversation_id) do nothing;
  end if;
  select * into v_state from support_runtime.conversation_state where conversation_id = v_conversation.id;

  return jsonb_build_object(
    'duplicate', v_duplicate,
    'conversation_id', v_conversation.id,
    'inbound_message_id', v_message.id,
    'revision', coalesce(v_state.revision, 0),
    'automation_mode', case when v_conversation.automation_mode = 'bot' then 'BOT_ACTIVE' else 'HUMAN_ACTIVE' end,
    'catalog_hash', v_state.catalog_hash,
    'state', v_state.state
  );
end $$;

revoke all on function public.support_runtime_acquire_inbound(text,text,text,text,text,jsonb,char)
  from public, anon, authenticated;
grant execute on function public.support_runtime_acquire_inbound(text,text,text,text,text,jsonb,char) to service_role;

commit;
