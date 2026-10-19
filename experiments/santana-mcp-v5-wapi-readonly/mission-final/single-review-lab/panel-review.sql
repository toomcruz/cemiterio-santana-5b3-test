-- LAB candidate. No grant activation, dispatcher, provider call or production execution.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create table public.sana_mcp_panel_reviews (
 operation_id uuid primary key, subject_id uuid not null, client_id uuid not null,
 operator_id uuid not null references public.support_members(user_id), conversation_id uuid not null,recipient_e164 text not null,
 payload jsonb not null, payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 source_payload_sha256 text not null check(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
 attachment_base64 text check(length(attachment_base64)<=700000),
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 challenge_sha256 text, challenge_session_id uuid, challenge_expires_at timestamptz,
 approved_at timestamptz, approved_session_id uuid,
 constraint panel_review_attachment check((payload->'attachment'='null'::jsonb and attachment_base64 is null)
  or (jsonb_typeof(payload->'attachment')='object' and attachment_base64 is not null))
);
alter table public.sana_mcp_panel_reviews enable row level security;
revoke all on public.sana_mcp_panel_reviews from public,anon,authenticated,service_role;
grant select,insert on public.sana_mcp_panel_reviews to service_role;
grant update(challenge_sha256,challenge_session_id,challenge_expires_at,approved_at,approved_session_id) on public.sana_mcp_panel_reviews to service_role;
create index sana_mcp_panel_reviews_operator on public.sana_mcp_panel_reviews(operator_id,created_at desc,operation_id desc);

create function public.sana_mcp_panel_review(p jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 d public.sana_mcp_panel_reviews%rowtype; c public.sana_conversations%rowtype;
 o public.sana_mcp_send_operations%rowtype; g public.sana_mcp_supervision_access%rowtype;
 actor uuid=(p->>'operator_id')::uuid; sid uuid=(p->>'operator_session_id')::uuid;
 op uuid=(p->>'operation_id')::uuid; kind text=p->>'operation'; r jsonb; items jsonb='[]';
 confirmed boolean=false; m public.sana_inbox_messages%rowtype; before_id uuid=(p->>'before_id')::uuid;
 before_at timestamptz=(p->>'before_at')::timestamptz;
begin
 if kind is null or kind not in ('stage','list','preview','approve','receipt','status') then raise exception 'MCP_PANEL_INVALID_REQUEST';end if;
 -- Same lock order as the existing coordinator and manual channel.
 perform pg_advisory_xact_lock_shared(721937420612::bigint);
 if kind='stage' then
  if op is null or p->>'client_id' is distinct from 'ccb5e1fc-2a61-4296-943a-a85c103e9313'
   or coalesce(p->>'payload_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p->>'source_payload_sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p->'payload') is distinct from 'object' or p->>'expires_at' is null or (p->>'expires_at')::timestamptz<=clock_timestamp()
   or (p->>'expires_at')::timestamptz>clock_timestamp()+interval '30 minutes'
  then raise exception 'MCP_PANEL_INVALID_REQUEST';end if;
  select * into g from public.sana_mcp_supervision_access where subject_id=(p->>'subject_id')::uuid
   and client_id=(p->>'client_id')::uuid;
  if not found then raise exception 'MCP_PANEL_SCOPE_DENIED';end if;actor=g.operator_id;
  if not public.sana_mcp_supervised_scope(g.subject_id,g.client_id,actor,(p->'payload'->>'conversation_id')::uuid,false)
   then raise exception 'MCP_PANEL_SCOPE_DENIED';end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp-send:'||op::text,0));
  select * into d from public.sana_mcp_panel_reviews where operation_id=op for update;
  if found then
   if d.subject_id<>g.subject_id or d.client_id<>g.client_id or d.operator_id<>actor or d.payload is distinct from p->'payload'
    or d.payload_sha256 is distinct from p->>'payload_sha256' or d.attachment_base64 is distinct from p->>'attachment_base64'
    or d.source_payload_sha256 is distinct from p->>'source_payload_sha256' or d.recipient_e164 is distinct from p->>'recipient_e164' then raise exception 'MCP_PANEL_OPERATION_CONFLICT';end if;
  else
   if exists(select 1 from public.sana_mcp_send_operations where operation_id=op) then raise exception 'MCP_PANEL_OPERATION_CONFLICT';end if;
   select * into c from public.sana_conversations where conversation_id=(p->'payload'->>'conversation_id')::uuid for share;
   if not found or c.contact_key is distinct from p->>'recipient_e164' or c.revision is distinct from (p->'payload'->>'expected_revision')::integer
    or p->'payload'->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(c.conversation_id)
   then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;
   insert into public.sana_mcp_panel_reviews(operation_id,subject_id,client_id,operator_id,conversation_id,recipient_e164,payload,payload_sha256,
    source_payload_sha256,attachment_base64,expires_at)
   values(op,g.subject_id,g.client_id,actor,c.conversation_id,p->>'recipient_e164',p->'payload',p->>'payload_sha256',p->>'source_payload_sha256',p->>'attachment_base64',
    least((p->>'expires_at')::timestamptz,g.expires_at)) returning * into d;
   insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,conversation_id,item_count,details)
   values(d.subject_id,d.client_id,actor,'panel_draft_staged',d.conversation_id,1,jsonb_build_object('operation_id',op,'payload_sha256',d.payload_sha256));
  end if;
 elsif kind='list' then
  if not sana_mcp_private.session_active(actor,sid) then raise exception 'MCP_PROD_SESSION_REQUIRED';end if;
  if (before_id is null)<>(before_at is null) then raise exception 'MCP_PANEL_INVALID_REQUEST';end if;
  for d in select * from public.sana_mcp_panel_reviews where operator_id=actor and expires_at>clock_timestamp()
    and (before_at is null or (created_at,operation_id)<(before_at,before_id))
    order by created_at desc,operation_id desc limit 21 loop
   if not public.sana_mcp_supervised_scope(d.subject_id,d.client_id,actor,d.conversation_id,false) then raise exception 'MCP_PANEL_SCOPE_DENIED';end if;
   items=items||jsonb_build_array(jsonb_build_object('operation_id',d.operation_id,'recipient',d.payload->'recipient',
    'text',d.payload->>'text','attachment',d.payload->'attachment','approved',d.approved_at is not null,'created_at',d.created_at));
  end loop;
  return jsonb_build_object('status','ready','items',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(items) with ordinality as x(v,n) where n<=20),
   'has_more',jsonb_array_length(items)>20,'next_cursor',case when jsonb_array_length(items)>20 then jsonb_build_object('before_at',items->19->>'created_at','before_id',items->19->>'operation_id') end);
 else
  if op is null then raise exception 'MCP_PANEL_INVALID_REQUEST';end if;
  -- Approval takes the operation lock before the draft/conversation locks.
  perform pg_advisory_xact_lock(hashtextextended('mcp-send:'||op::text,0));
  select * into d from public.sana_mcp_panel_reviews where operation_id=op for update;
  if not found then raise exception 'MCP_PANEL_DRAFT_NOT_AVAILABLE';end if;
  if kind='status' then
   if d.subject_id is distinct from (p->>'subject_id')::uuid or d.client_id is distinct from (p->>'client_id')::uuid
    then raise exception 'MCP_PANEL_SCOPE_DENIED';end if;actor=d.operator_id;
  elsif actor is distinct from d.operator_id or not sana_mcp_private.session_active(actor,sid)
   then raise exception 'MCP_PROD_SESSION_REQUIRED';end if;
  if not public.sana_mcp_supervised_scope(d.subject_id,d.client_id,actor,d.conversation_id,kind='approve') then raise exception 'MCP_PANEL_SCOPE_DENIED';end if;
  if kind in ('preview','approve') and d.approved_at is null then
   if d.expires_at<=clock_timestamp() then raise exception 'MCP_PANEL_DRAFT_EXPIRED';end if;
   select * into c from public.sana_conversations where conversation_id=d.conversation_id for update;
   if c.contact_key is distinct from d.recipient_e164 or c.revision is distinct from (d.payload->>'expected_revision')::integer
    or d.payload->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(d.conversation_id)
   then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;
   if kind='preview' then
    if coalesce(p->>'challenge_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'MCP_PANEL_INVALID_REQUEST';end if;
    update public.sana_mcp_panel_reviews set challenge_sha256=p->>'challenge_sha256',challenge_session_id=sid,
     challenge_expires_at=least(d.expires_at,clock_timestamp()+interval '10 minutes') where operation_id=op returning * into d;
    insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,conversation_id,item_count,details)
    values(d.subject_id,d.client_id,actor,'panel_preview',d.conversation_id,1,jsonb_build_object('operation_id',op,'payload_sha256',d.payload_sha256));
    return jsonb_build_object('status','ready','operation_id',op,'state','prepared','payload',d.payload,'payload_sha256',d.payload_sha256,
     'recipient_display',jsonb_build_object('name',d.payload->'recipient'->'name','phone',d.recipient_e164),
     'attachment_base64',d.attachment_base64,'expires_at',d.expires_at,'challenge_expires_at',d.challenge_expires_at);
   end if;
   if d.payload_sha256 is distinct from p->>'payload_sha256' or d.challenge_sha256 is null
    or d.challenge_sha256 is distinct from p->>'challenge_sha256' or d.challenge_session_id is distinct from sid
    or d.challenge_expires_at<=clock_timestamp() then raise exception 'MCP_PANEL_APPROVAL_NOT_BOUND';end if;
   r=public.sana_mcp_coordinated_send(jsonb_build_object('operation','authorize','operation_id',op,'subject_id',d.subject_id,'client_id',d.client_id,
    'operator_id',actor,'operator_session_id',sid,'conversation_id',d.conversation_id,'payload',d.payload,'payload_sha256',d.payload_sha256,
    'attachment_id',p->>'attachment_id','expires_at',least(d.expires_at,clock_timestamp()+interval '10 minutes'),
    'explicit_authorization',case when d.payload->'attachment'='null'::jsonb then 'one_real_text_attempt'
     when d.payload->'attachment'->>'mime_type'='application/pdf' then 'one_real_document_attempt' else 'one_real_image_attempt' end));
   if r->>'status'<>'authorized' then raise exception 'MCP_PANEL_OPERATION_CONFLICT';end if;
   update public.sana_mcp_panel_reviews set approved_at=clock_timestamp(),approved_session_id=sid,challenge_sha256=null,challenge_expires_at=null
    where operation_id=op;
   insert into public.sana_mcp_send_events(operation_id,event,details) values(op,'panel_operator_approved_and_send_requested',
    jsonb_build_object('operator_id',actor,'operator_session_id',sid,'payload_sha256',d.payload_sha256,'attachment_sha256',d.payload->'attachment'->>'sha256'));
   return jsonb_build_object('status','authorized','fresh_approval',true,'operation_id',op,'payload',d.payload,'payload_sha256',d.payload_sha256,'attachment_id',p->>'attachment_id');
  end if;
 end if;
 select * into o from public.sana_mcp_send_operations where operation_id=d.operation_id;
 if o.state='sent' and o.provider_message_id is not null then
  select * into m from public.sana_inbox_messages where actor_id=d.operator_id and action_id=d.operation_id
   and conversation_id=d.conversation_id and external_message_id=o.provider_message_id;
  confirmed=found and m.delivery_state in ('delivered','read','DELIVERED','READ');
 end if;
 return jsonb_build_object('status','ready','operation_id',d.operation_id,'fresh_approval',false,'state',coalesce(o.state,'prepared'),
  'payload',d.payload,'payload_sha256',d.payload_sha256,'expires_at',d.expires_at,'approved',d.approved_at is not null,
  'accepted_by_api',case when o.state='sent' then true when o.state in ('unknown','dispatching') then null else false end,
  'delivery_confirmed',coalesce(confirmed,false),'confirmation_source',case when confirmed then 'official_history' end,
  'retry_allowed',false,'no_send',true);
end;$$;
revoke all on function public.sana_mcp_panel_review(jsonb) from public,anon,authenticated;
grant execute on function public.sana_mcp_panel_review(jsonb) to service_role;
commit;
