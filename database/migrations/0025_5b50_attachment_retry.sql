-- 5B.5-A: leitura idempotente e nova tentativa controlada de anexo.
begin;

create or replace function public.support_runtime_get_attachment(
  p_inbound_message_id uuid,
  p_conversation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare v support_runtime.attachments;
begin
  select * into v from support_runtime.attachments
   where inbound_message_id = p_inbound_message_id and conversation_id = p_conversation_id;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object(
    'found', true,
    'stored', v.status = 'STORED',
    'status', v.status,
    'document_id', v.document_id,
    'file_name', v.file_name,
    'mime_type', v.mime_type,
    'error_code', v.error_code
  );
end $$;

create or replace function public.support_runtime_store_attachment(
  p_inbound_message_id uuid,
  p_conversation_id uuid,
  p_file_name text,
  p_mime_type text,
  p_message_type text,
  p_storage_path text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare
  v_receipt support_runtime.inbound_receipts;
  v_attachment support_runtime.attachments;
  v_document public.support_documents;
  v_file_name text := left(btrim(coalesce(p_file_name, '')), 180);
  v_mime_type text := lower(left(btrim(coalesce(p_mime_type, '')), 180));
  v_document_type text;
  v_replacing_failure boolean := false;
begin
  select * into v_receipt
    from support_runtime.inbound_receipts
   where inbound_message_id = p_inbound_message_id
     and conversation_id = p_conversation_id
   for update;
  if not found then raise exception 'inbound receipt not found' using errcode = '22023'; end if;

  select * into v_attachment
    from support_runtime.attachments
   where inbound_message_id = p_inbound_message_id
   for update;
  if found then
    if v_attachment.conversation_id <> p_conversation_id then
      raise exception 'attachment belongs to another conversation' using errcode = '22023';
    end if;
    if v_attachment.status = 'STORED' then
      return jsonb_build_object(
        'stored', true,
        'status', 'STORED',
        'document_id', v_attachment.document_id,
        'file_name', v_attachment.file_name,
        'mime_type', v_attachment.mime_type
      );
    end if;
    v_replacing_failure := true;
  end if;

  if p_message_type not in ('image','document','audio') then
    raise exception 'attachment message type is invalid' using errcode = '22023';
  end if;
  if v_file_name = '' then raise exception 'attachment file name is required' using errcode = '22023'; end if;
  if v_mime_type !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' then
    raise exception 'attachment MIME type is invalid' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || p_conversation_id::text || '/[A-Za-z0-9._-]{1,180}$') then
    raise exception 'attachment storage path is invalid' using errcode = '22023';
  end if;
  v_document_type := case
    when p_message_type = 'image' then 'foto'
    when p_message_type = 'audio' then 'audio'
    else 'documento'
  end;

  insert into public.support_documents(
    conversation_id, storage_path, file_name, mime_type, document_type, status
  ) values (
    p_conversation_id, p_storage_path, v_file_name, v_mime_type, v_document_type, 'pending'
  ) returning * into v_document;

  if v_replacing_failure then
    update support_runtime.attachments
       set document_id = v_document.id,
           message_type = p_message_type,
           file_name = v_file_name,
           mime_type = v_mime_type,
           storage_path = p_storage_path,
           status = 'STORED',
           error_code = null,
           updated_at = now()
     where inbound_message_id = p_inbound_message_id;
  else
    insert into support_runtime.attachments(
      inbound_message_id, conversation_id, document_id, message_type, file_name, mime_type, storage_path, status
    ) values (
      p_inbound_message_id, p_conversation_id, v_document.id, p_message_type, v_file_name, v_mime_type,
      p_storage_path, 'STORED'
    );
  end if;
  update public.support_messages
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
       'document_id', v_document.id,
       'file_name', v_file_name,
       'mime_type', v_mime_type,
       'media_status', 'stored',
       'runtime', 'santana-conversation-domain/v1'
     )
   where id = p_inbound_message_id;

  return jsonb_build_object(
    'stored', true,
    'status', 'STORED',
    'document_id', v_document.id,
    'file_name', v_file_name,
    'mime_type', v_mime_type
  );
end $$;

revoke all on function public.support_runtime_get_attachment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.support_runtime_store_attachment(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.support_runtime_get_attachment(uuid,uuid) to service_role;
grant execute on function public.support_runtime_store_attachment(uuid,uuid,text,text,text,text) to service_role;

commit;
