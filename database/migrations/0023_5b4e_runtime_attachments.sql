-- 5B.4-E: preservação oficial de anexos.
--
-- Um anexo é recebido e armazenado antes de ser revisado. O runtime registra
-- essas etapas sem afirmar validação, agendamento ou abertura de solicitação.
-- Os segredos/URLs efêmeros da W-API não são gravados no schema público.
begin;

create table if not exists support_runtime.attachments (
  inbound_message_id uuid primary key
    references support_runtime.inbound_receipts(inbound_message_id) on delete restrict,
  conversation_id uuid not null
    references public.support_conversations(id) on delete restrict,
  document_id uuid unique null
    references public.support_documents(id) on delete restrict,
  message_type text not null check (message_type in ('image','document','audio')),
  file_name text not null check (char_length(file_name) between 1 and 180),
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  storage_path text null check (
    storage_path is null or storage_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,180}$'
  ),
  status text not null check (status in ('STORED','FAILED')),
  error_code text null check (error_code is null or char_length(error_code) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'STORED' and document_id is not null and storage_path is not null and error_code is null)
    or (status = 'FAILED' and document_id is null and storage_path is null and error_code is not null)
  )
);
create index if not exists support_runtime_attachments_conversation_idx
  on support_runtime.attachments(conversation_id, created_at desc);

alter table support_runtime.attachments enable row level security;
revoke all on support_runtime.attachments from public, anon, authenticated;

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
    return jsonb_build_object(
      'stored', v_attachment.status = 'STORED',
      'status', v_attachment.status,
      'document_id', v_attachment.document_id,
      'file_name', v_attachment.file_name,
      'mime_type', v_attachment.mime_type
    );
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
  insert into support_runtime.attachments(
    inbound_message_id, conversation_id, document_id, message_type, file_name, mime_type, storage_path, status
  ) values (
    p_inbound_message_id, p_conversation_id, v_document.id, p_message_type, v_file_name, v_mime_type,
    p_storage_path, 'STORED'
  );
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

create or replace function public.support_runtime_fail_attachment(
  p_inbound_message_id uuid,
  p_conversation_id uuid,
  p_error_code text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime, extensions as $$
declare
  v_receipt support_runtime.inbound_receipts;
  v_attachment support_runtime.attachments;
  v_error_code text := upper(left(btrim(coalesce(p_error_code, 'ATTACHMENT_UNAVAILABLE')), 80));
begin
  select * into v_receipt
    from support_runtime.inbound_receipts
   where inbound_message_id = p_inbound_message_id
     and conversation_id = p_conversation_id
   for update;
  if not found then raise exception 'inbound receipt not found' using errcode = '22023'; end if;
  if v_error_code !~ '^[A-Z0-9_]+$' then
    raise exception 'attachment error code is invalid' using errcode = '22023';
  end if;

  select * into v_attachment from support_runtime.attachments
   where inbound_message_id = p_inbound_message_id for update;
  if found then
    if v_attachment.status = 'STORED' then
      return jsonb_build_object('stored', true, 'status', 'STORED', 'document_id', v_attachment.document_id);
    end if;
    update support_runtime.attachments
       set error_code = v_error_code, updated_at = now()
     where inbound_message_id = p_inbound_message_id;
  else
    insert into support_runtime.attachments(
      inbound_message_id, conversation_id, document_id, message_type, file_name, mime_type, storage_path, status, error_code
    ) values (
      p_inbound_message_id, p_conversation_id, null, 'document', 'arquivo-indisponivel',
      'application/octet-stream', null, 'FAILED', v_error_code
    );
  end if;
  update public.support_messages
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
       'media_status', 'failed',
       'media_error_code', v_error_code,
       'runtime', 'santana-conversation-domain/v1'
     )
   where id = p_inbound_message_id;
  return jsonb_build_object('stored', false, 'status', 'FAILED', 'error_code', v_error_code);
end $$;

revoke all on function public.support_runtime_store_attachment(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.support_runtime_fail_attachment(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.support_runtime_store_attachment(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.support_runtime_fail_attachment(uuid,uuid,text) to service_role;

commit;
