begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
-- ISOLATED CANDIDATE ONLY. Requires separate production authorization.
create table public.sana_mcp_supervised_send_access (
 subject_id uuid not null,client_id uuid not null,operator_id uuid not null references public.support_members(user_id),
 scope_key text not null check(scope_key='panel:santana'),is_active boolean not null default false,
 live_enabled boolean not null default false,expires_at timestamptz not null,
 created_at timestamptz not null default now(),primary key(subject_id,client_id,operator_id)
);
alter table public.sana_mcp_supervised_send_access enable row level security;
revoke all on public.sana_mcp_supervised_send_access from public,anon,authenticated;
grant select,update(is_active) on public.sana_mcp_supervised_send_access to service_role;

create function public.sana_mcp_conversation_watermark(p_conversation uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
 select jsonb_build_object('inbox',(select jsonb_build_object('id',m.message_key,'at',m.created_at,'state',m.delivery_state)
  from public.sana_inbox_messages m where m.conversation_id=p_conversation and not m.hidden and not m.no_send
  order by m.created_at desc,m.message_key desc limit 1),
 'sana',(select jsonb_build_object('id',o.outbox_id,'at',o.created_at,'state',o.delivery_state,'settled_at',o.settled_at)
  from public.sana_outbox o where o.conversation_id=p_conversation
   and not exists(select 1 from public.sana_operator_deliveries d where d.outbox_id=o.outbox_id and d.no_send)
   and not exists(select 1 from public.sana_message_audit a where a.outbox_id=o.outbox_id and a.no_send)
  order by o.created_at desc,o.outbox_id desc limit 1));
$$;
revoke all on function public.sana_mcp_conversation_watermark(uuid) from public,anon,authenticated;
grant execute on function public.sana_mcp_conversation_watermark(uuid) to service_role;

create function public.sana_mcp_supervised_scope(p_subject uuid,p_client uuid,p_operator uuid,p_conversation uuid,p_live boolean)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare w public.sana_mcp_supervised_send_access%rowtype; r public.sana_mcp_supervision_access%rowtype;
begin
 if p_client is distinct from 'ccb5e1fc-2a61-4296-943a-a85c103e9313'::uuid or p_conversation is null or p_live is null
 then raise exception 'MCP_SUPERVISED_SCOPE_DENIED';end if;
 select * into w from public.sana_mcp_supervised_send_access where subject_id=p_subject and client_id=p_client and operator_id=p_operator for share;
 if not found then return false;end if; -- Existing exact-conversation grants retain their original path.
 if not w.is_active or w.expires_at<=clock_timestamp() or (p_live and not w.live_enabled)
 then raise exception 'MCP_SUPERVISED_PERMISSION_DISABLED';end if;
 select * into r from public.sana_mcp_supervision_access where subject_id=p_subject and client_id=p_client and operator_id=p_operator for share;
 if not found or not r.is_active or r.expires_at<=clock_timestamp() or r.scope_key<>w.scope_key
  or not ('contact'=any(r.operations)) or (r.conversation_ids is not null and not p_conversation=any(r.conversation_ids))
 then raise exception 'MCP_SUPERVISED_READ_BINDING_REVOKED';end if;
 if not exists(select 1 from public.support_members m where m.user_id=p_operator and m.role='admin' and m.is_active
  and m.approval_status='approved' and 'atendimentos'=any(m.permissions)) then raise exception 'MCP_PROD_OPERATOR_REVOKED';end if;
 if not exists(select 1 from public.sana_conversations c where c.conversation_id=p_conversation
  and coalesce(c.state_json->>'technical','false')<>'true' and c.contact_key not like '+120255501%')
 then raise exception 'MCP_SUPERVISED_CONVERSATION_DENIED';end if;
 insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,conversation_id,item_count,details)
 values(p_subject,p_client,p_operator,'supervised_scope_check',p_conversation,0,jsonb_build_object('live_required',p_live));
 return true;
end;
$$;
revoke all on function public.sana_mcp_supervised_scope(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.sana_mcp_supervised_scope(uuid,uuid,uuid,uuid,boolean) to service_role;
-- No grant is inserted, no write is activated by this file.

CREATE OR REPLACE FUNCTION public.sana_mcp_coordinated_send(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 op uuid=(p->>'operation_id')::uuid; sub uuid=(p->>'subject_id')::uuid;
 cli uuid=(p->>'client_id')::uuid; actor uuid=(p->>'operator_id')::uuid;
 cid uuid; c public.sana_conversations%rowtype; o public.sana_mcp_send_operations%rowtype;
 control jsonb; r jsonb; kind text=p->>'operation'; admin_scope boolean=false;
begin
 if op is null or sub is null or cli is distinct from 'ccb5e1fc-2a61-4296-943a-a85c103e9313'::uuid
  or kind not in ('authorize','prepare','settle','status') then raise exception 'MCP_INVALID_OPERATION';end if;
 -- Same policy-lock ordering as the existing automatic delivery functions.
 perform pg_advisory_xact_lock_shared(721937420612::bigint);
 perform pg_advisory_xact_lock(hashtextextended('mcp-send:'||op::text,0));
 select * into o from public.sana_mcp_send_operations where operation_id=op;
 if found then
  if o.subject_id<>sub or o.client_id<>cli then raise exception 'MCP_OPERATION_NOT_AVAILABLE';end if;
  cid=o.conversation_id;actor=o.operator_id;
 else
  if kind<>'authorize' then raise exception 'MCP_OPERATION_NOT_AVAILABLE';end if;
  cid=(p->>'conversation_id')::uuid;
 end if;
 select * into c from public.sana_conversations where conversation_id=cid for update;
 if not found then raise exception 'MCP_CONVERSATION_NOT_AVAILABLE';end if;
 -- SQL locks the authoritative conversation before any outbox or manual claim.
 if not exists(select 1 from public.support_members where user_id=actor and is_active and approval_status='approved'
   and 'atendimentos'=any(permissions)) then raise exception 'MCP_PROD_OPERATOR_REVOKED';end if;
 if kind in ('authorize','prepare') then
  admin_scope=public.sana_mcp_supervised_scope(sub,cli,actor,cid,true);
 end if;
 if kind='status' then
  return jsonb_build_object('status','ready','state',o.state,'operation_id',op,'payload_sha256',o.payload_sha256,
   'accepted_by_api',o.state='sent','delivery_confirmed',false,'attachment_id',o.attachment_id);
 end if;
 if kind='settle' then
  if o.state<>'dispatching' then return jsonb_build_object('status','duplicate','delivery_state',o.state);end if;
  r=public.sana_manual_whatsapp(jsonb_build_object('operation','settle','actor_id',actor,'action_id',op,
   'claim_token',p->>'claim_token','outcome',p->>'outcome','provider_message_id',p->>'provider_message_id'));
  if r->>'status'<>'committed' then raise exception 'MCP_SETTLEMENT_FAILED';end if;
  update public.sana_mcp_send_operations set state=p->>'outcome',settled_at=clock_timestamp(),
   provider_message_id=case when p->>'outcome'='sent' then p->>'provider_message_id' end where operation_id=op;
  insert into public.sana_mcp_send_events(operation_id,event,details) values(op,'settled',jsonb_build_object('outcome',p->>'outcome'));
  return r;
 end if;
 if kind='authorize' and o.operation_id is not null then
  if o.operator_id is distinct from (p->>'operator_id')::uuid or o.payload is distinct from p->'payload'
   or o.payload_sha256 is distinct from p->>'payload_sha256' or o.attachment_id is distinct from (p->>'attachment_id')::uuid then raise exception 'MCP_APPROVAL_CONFLICT';end if;
  return jsonb_build_object('status','duplicate','operation_id',op,'state',o.state);
 end if;
 if kind='prepare' and o.state<>'authorized' then
  return jsonb_build_object('status','duplicate','delivery_state',case when o.state='dispatching' then 'unknown' else o.state end);
 end if;
 if not admin_scope and not exists(select 1 from public.sana_mcp_send_permissions where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and live_enabled and expires_at>clock_timestamp()) then raise exception 'MCP_LIVE_PERMISSION_DISABLED';end if;
 if not admin_scope and not exists(select 1 from public.sana_mcp_read_access where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and is_active and expires_at>clock_timestamp()) then raise exception 'MCP_BINDING_REVOKED';end if;
 if kind='authorize' then
  if admin_scope and p->'payload'->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(cid) then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;
  if not sana_mcp_private.session_active(actor,(p->>'operator_session_id')::uuid) then raise exception 'MCP_PROD_SESSION_REQUIRED';end if;
  if (p->'payload'->'attachment' is distinct from 'null'::jsonb and not sana_mcp_private.attachment_matches(p->'payload'->'attachment',(p->>'attachment_id')::uuid,actor,cid,op))
   or (p->'payload'->'attachment'='null'::jsonb and p->>'attachment_id' is not null) or p->'payload'->>'conversation_id' is distinct from cid::text
   or p->'payload'->>'text' is null or length(p->'payload'->>'text') not between 1 and 3000
   or p->'payload'->>'text'<>btrim(p->'payload'->>'text')
   or p->>'payload_sha256' !~ '^[a-f0-9]{64}$' or p->>'payload_sha256' is null
   or p->>'explicit_authorization' is distinct from (case when p->'payload'->'attachment'='null'::jsonb then 'one_real_text_attempt' when p->'payload'->'attachment'->>'mime_type'='application/pdf' then 'one_real_document_attempt' else 'one_real_image_attempt' end)
   or c.revision is distinct from (p->'payload'->>'expected_revision')::integer
   or (p->>'expires_at')::timestamptz is null or (p->>'expires_at')::timestamptz<=clock_timestamp()
   or (p->>'expires_at')::timestamptz>clock_timestamp()+interval '10 minutes'
  then raise exception 'MCP_APPROVAL_INVALID_OR_STALE';end if;
  insert into public.sana_mcp_send_operations(operation_id,subject_id,client_id,operator_id,operator_session_id,
   conversation_id,attachment_id,payload,payload_sha256,recipient_e164,expected_revision,state,expires_at)
  values(op,sub,cli,actor,(p->>'operator_session_id')::uuid,cid,(p->>'attachment_id')::uuid,p->'payload',p->>'payload_sha256',c.contact_key,c.revision,'authorized',(p->>'expires_at')::timestamptz);
  insert into public.sana_mcp_send_events(operation_id,event) values(op,'prod_operator_authorized_one_attempt');
  return jsonb_build_object('status','authorized','operation_id',op,'payload_sha256',p->>'payload_sha256');
 end if;
 if admin_scope and o.payload->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(cid) then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;
 if o.expires_at<=clock_timestamp() or not sana_mcp_private.session_active(actor,o.operator_session_id) then raise exception 'MCP_AUTHORIZATION_EXPIRED';end if;
 if p->>'payload_sha256' is distinct from o.payload_sha256 or c.contact_key is distinct from o.recipient_e164
   or c.revision<>o.expected_revision then raise exception 'MCP_RECIPIENT_CONTENT_OR_REVISION_CHANGED';end if;
 if o.payload->'attachment' is distinct from 'null'::jsonb and not sana_mcp_private.attachment_matches(o.payload->'attachment',o.attachment_id,actor,cid,op) then raise exception 'MCP_ATTACHMENT_BINDING_CHANGED';end if;
 if exists(select 1 from public.sana_outbox where conversation_id=cid and delivery_state in ('PENDING','CLAIMED','UNKNOWN'))
  or exists(select 1 from public.sana_inbox_messages where conversation_id=cid and delivery_state in ('dispatching','unknown'))
  or exists(select 1 from public.sana_mcp_send_operations where conversation_id=cid and state in ('dispatching','unknown'))
 then raise exception 'MCP_CONCURRENT_OR_AMBIGUOUS_DELIVERY';end if;
 control=public.sana_control_transition(cid,c.revision,'human','mcp:'||actor::text,'sana:control:mcp:'||op::text);
 if control->>'status'<>'committed' then raise exception 'MCP_HUMAN_CONTROL_FAILED';end if;
 update public.sana_mcp_send_operations set state='dispatching',claimed_at=clock_timestamp() where operation_id=op;
 r=public.sana_manual_whatsapp(jsonb_build_object('operation','prepare','actor_id',actor,'conversation_id',cid,'action_id',op,
  'expected_revision',(control->>'revision')::integer,'text',o.payload->>'text','attachment_id',o.attachment_id));
 if r->>'status'<>'prepared' then raise exception 'MCP_OFFICIAL_PREPARE_FAILED';end if;
 if r->>'recipient_e164' is distinct from o.recipient_e164 or r->>'text' is distinct from o.payload->>'text'
  or r->>'attachment_id' is distinct from o.attachment_id::text or r->>'no_send' not in ('true','false') then raise exception 'MCP_OFFICIAL_RECEIPT_CHANGED';end if;
 if (r->>'no_send')::boolean then update public.sana_mcp_send_operations set state='test',settled_at=clock_timestamp() where operation_id=op;end if;
 insert into public.sana_mcp_send_events(operation_id,event) values(op,'official_claim_created');
 return r;
end $function$

create or replace function public.sana_mcp_admin_read(p_subject uuid,p_client uuid,p_mode text,p_args jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare g public.sana_mcp_supervision_access%rowtype; cid uuid; c public.sana_conversations%rowtype;
 result jsonb; rows jsonb; part jsonb; n integer; lim integer; day date; start_at timestamptz; end_at timestamptz;
 section text; t_before timestamptz; k_before text; last_inbound record; cnt integer;
begin
 if p_mode not in ('pending','context','rules','attachment_reference','attachment_record','conversations','contact','messages','files')
  or p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
 select * into g from public.sana_mcp_supervision_access where subject_id=p_subject and client_id=p_client
  and scope_key='panel:santana' and is_active and expires_at>clock_timestamp() for share;
 if not found then raise exception 'MCP_ADMIN_GRANT_REQUIRED';end if;
 if not exists(select 1 from public.support_members m
  where m.user_id=g.operator_id and m.is_active and m.approval_status='approved' and m.role='admin'
  and 'atendimentos'=any(m.permissions))
  then raise exception 'MCP_ADMIN_OPERATOR_REVOKED';end if;
 if not (case when p_mode like 'attachment_%' then 'attachment' else p_mode end)=any(g.operations)
  then raise exception 'MCP_ADMIN_SCOPE_DENIED';end if;
 if not public.sana_mcp_read_rate_check(p_subject,p_client,case when p_mode like 'attachment_%' then 10 else 30 end)
  then raise exception 'MCP_ADMIN_RATE_LIMITED';end if;
 lim=coalesce((p_args->>'limit')::integer,20);
 if lim<1 or lim>(case when p_mode in ('messages','files') then 100 else 50 end) then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
 t_before=(p_args->>'before')::timestamptz;k_before=p_args->>'before_key';
 if (t_before is null)<>(k_before is null) then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
 if p_args ? 'conversation_id' then
  cid=(p_args->>'conversation_id')::uuid;
  if g.conversation_ids is not null and not cid=any(g.conversation_ids) then raise exception 'MCP_ADMIN_CONVERSATION_DENIED';end if;
  select * into c from public.sana_conversations where conversation_id=cid and
   coalesce(state_json->>'technical','false')<>'true' and contact_key not like '+120255501%';
  if not found then raise exception 'MCP_ADMIN_CONVERSATION_DENIED';end if;
 end if;
 if p_mode='rules' then
  select coalesce(jsonb_agg(jsonb_build_object('rule_id',a.rule_id,'catalog_sha256',a.catalog_sha256,
    'approved_by',a.approved_by,'approved_at',a.approved_at,'expires_at',a.expires_at)),'[]') into rows
  from public.sana_mcp_rule_approvals a join public.support_members m on m.user_id=a.approved_by
  where a.revoked_at is null and a.expires_at>clock_timestamp() and m.role='admin' and m.is_active and m.approval_status='approved';
  result=jsonb_build_object('approvals',rows);cnt=jsonb_array_length(rows);
 elsif p_mode='pending' then
  day=coalesce((p_args->>'date')::date,(now() at time zone 'America/Sao_Paulo')::date);
  start_at=day::timestamp at time zone 'America/Sao_Paulo';end_at=(day+1)::timestamp at time zone 'America/Sao_Paulo';
  select coalesce(jsonb_agg(x order by x->>'last_received_at' desc,x->>'conversation_id' desc),'[]') into rows from (
   select jsonb_build_object('conversation_id',v.conversation_id,'revision',v.revision,
    'name',left(coalesce(v.state_json->>'contact_name',''),100),'phone_mask','+••••••'||right(v.contact_key,4),
    'human_paused',coalesce(v.automation_mode='human' or v.state_json->>'automation_mode'='human' or v.state_json->>'manual_takeover'='true' or v.state_json->>'inbox_source'='WAPI_HUMAN_INBOX',false),
    'last_received_at',i.created_at,'last_inbound_id',i.message_key,'preview',left(i.inbound_text,400),
    'processing_evidence',(select jsonb_build_object('status',a.status,'stage',a.stage,'error_code',a.error_code)
      from public.sana_message_audit a where a.conversation_id=v.conversation_id and a.message_key=i.message_key and not a.no_send limit 1),
    'has_attachments',jsonb_array_length(i.attachments)>0,
    'delivery_evidence',public.sana_mcp_admin_delivery(v.conversation_id,i.message_key,i.created_at)) x
   from public.sana_conversations v join lateral(
    select message_key,created_at,inbound_text,attachments from public.sana_inbox_messages
    where conversation_id=v.conversation_id and sender_role='citizen' and not hidden and not no_send
     and created_at>=start_at and created_at<end_at order by created_at desc,message_key desc limit 1
   )i on true
   where coalesce(v.state_json->>'technical','false')<>'true' and v.contact_key not like '+120255501%'
    and (g.conversation_ids is null or v.conversation_id=any(g.conversation_ids))
    and (t_before is null or (i.created_at,v.conversation_id::text)<(t_before,k_before))
   order by i.created_at desc,v.conversation_id desc limit lim+1
  )s;
  result=jsonb_build_object('candidates',rows,'date',day,'timezone','America/Sao_Paulo','time_basis','received_at');cnt=least(lim,jsonb_array_length(rows));
 elsif p_mode='conversations' then
  select coalesce(jsonb_agg(x order by x->>'updated_at' desc,x->>'conversation_id' desc),'[]') into rows from (
   select jsonb_build_object('conversation_id',v.conversation_id,'name',left(v.state_json->>'contact_name',100),
    'contact_key','+••••••'||right(v.contact_key,4),'revision',v.revision,'automation_mode',v.automation_mode,
    'human_paused',coalesce(v.automation_mode='human' or v.state_json->>'automation_mode'='human' or v.state_json->>'manual_takeover'='true' or v.state_json->>'inbox_source'='WAPI_HUMAN_INBOX',false),
    'lifecycle',v.lifecycle,'updated_at',v.updated_at) x from public.sana_conversations v
   where coalesce(v.state_json->>'technical','false')<>'true' and v.contact_key not like '+120255501%'
    and (g.conversation_ids is null or v.conversation_id=any(g.conversation_ids))
   order by v.updated_at desc,v.conversation_id desc limit lim+1 offset coalesce((p_args->>'offset')::integer,0)
  )s;result=jsonb_build_object('items',rows);cnt=least(lim,jsonb_array_length(rows));
 else
  if cid is null then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
  result=jsonb_build_object('conversation',jsonb_build_object('conversation_id',cid,'name',left(c.state_json->>'contact_name',100),
    'contact_key','+••••••'||right(c.contact_key,4),'message_watermark',public.sana_mcp_conversation_watermark(cid),'revision',c.revision,'automation_mode',c.automation_mode,
    'human_paused',coalesce(c.automation_mode='human' or c.state_json->>'automation_mode'='human' or c.state_json->>'manual_takeover'='true' or c.state_json->>'inbox_source'='WAPI_HUMAN_INBOX',false),'lifecycle',c.lifecycle,'updated_at',c.updated_at));
  select message_key,created_at into last_inbound from public.sana_inbox_messages where conversation_id=cid
   and sender_role='citizen' and not hidden and not no_send order by created_at desc,message_key desc limit 1;
  result=result||jsonb_build_object('delivery_evidence',public.sana_mcp_admin_delivery(cid,last_inbound.message_key,last_inbound.created_at));
  cnt=1;
  if p_mode like 'attachment_%' then
   if not exists(select 1 from public.sana_inbox_messages m cross join lateral jsonb_array_elements(m.attachments) a
    where m.conversation_id=cid and m.message_key=p_args->>'message_key' and not m.hidden and not m.no_send
     and m.sender_role='citizen' and a->>'artifact_id'=p_args->>'artifact_id') then raise exception 'MCP_ADMIN_ATTACHMENT_DENIED';end if;
   if p_mode='attachment_reference' then
    select jsonb_build_object('phone',c.contact_key,'external_message_id',m.external_message_id,
     'provider',a->'provider','type',a->>'type','file_name',a->>'file_name','mime_type',a->>'mime_type',
     'sha256',a->>'sha256','artifact_id',a->>'artifact_id') into part
    from public.sana_inbox_messages m cross join lateral jsonb_array_elements(m.attachments) a
    where m.conversation_id=cid and m.message_key=p_args->>'message_key' and a->>'artifact_id'=p_args->>'artifact_id';
    result=part;
   else
    if coalesce(p_args->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
    result=jsonb_build_object('authorized',true);
   end if;
  elsif p_mode in ('context','messages','files') then
   section=coalesce(p_args->>'section',case when p_mode='context' then 'all' else 'messages' end);
   if section not in ('all','messages','cases','documents','notes') or section='all' and t_before is not null then raise exception 'MCP_ADMIN_INVALID_REQUEST';end if;
   if section in ('all','messages') then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc,x->>'message_key' desc),'[]') into rows from (
     select x from (
     select jsonb_build_object('message_key',m.message_key,'created_at',m.created_at,'sender_role',m.sender_role,
      'delivery_state',m.delivery_state,'inbound_text',left(m.inbound_text,6000),'generated_response',left(m.response_text,6000),
      'text_truncated',coalesce(length(m.inbound_text)>6000,false),'generated_response_truncated',coalesce(length(m.response_text)>6000,false),
      'generated_response_is_not_send_proof',true,
      'attachments',(select coalesce(jsonb_agg(jsonb_build_object('artifact_id',a->>'artifact_id','file_name',a->>'file_name',
       'mime_type',a->>'mime_type','type',a->>'type','size_bytes',a->'size_bytes','media_status',a->>'media_status')),'[]') from jsonb_array_elements(m.attachments)a)) x
     from public.sana_inbox_messages m where m.conversation_id=cid and not m.hidden and not m.no_send
      and (t_before is null or (m.created_at,m.message_key)<(t_before,k_before))
     union all
     select jsonb_build_object('message_key','sana-outbox:'||o.outbox_id::text,'created_at',o.created_at,'sender_role','sana',
      'delivery_state',o.delivery_state,'inbound_text',left(o.response_text,6000),'text_truncated',coalesce(length(o.response_text)>6000,false),
      'generated_response',null,'generated_response_is_not_send_proof',true,'accepted_by_api',true,
      'delivery_confirmed',o.delivery_state in ('DELIVERED','READ'),'attachments','[]'::jsonb) x
     from public.sana_outbox o where p_mode='context' and o.conversation_id=cid and o.delivery_state in ('SENT','DELIVERED','READ')
      and not exists(select 1 from public.sana_operator_deliveries d where d.outbox_id=o.outbox_id and d.no_send)
      and not exists(select 1 from public.sana_message_audit a where a.outbox_id=o.outbox_id and a.no_send)
      and (t_before is null or (o.created_at,'sana-outbox:'||o.outbox_id::text)<(t_before,k_before))
     ) history order by x->>'created_at' desc,x->>'message_key' desc limit lim+1
    )s;result=result||jsonb_build_object('messages',rows);cnt=cnt+least(lim,jsonb_array_length(rows));
   end if;
   if section in ('all','cases') then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc,x->>'case_id' desc),'[]') into rows from (
     select jsonb_build_object('case_id',k.case_id,'service_family',k.service_family,'status',k.status,'revision',k.revision,
      'created_at',k.created_at,'updated_at',k.updated_at) x from public.sana_cases k where k.conversation_id=cid
      and (t_before is null or (k.created_at,k.case_id::text)<(t_before,k_before)) order by k.created_at desc,k.case_id desc limit lim+1
    )s;result=result||jsonb_build_object('cases',rows);cnt=cnt+least(lim,jsonb_array_length(rows));
   end if;
   if section in ('all','documents') then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc,x->>'document_id' desc),'[]') into rows from (
     select jsonb_build_object('document_id',d.document_id,'case_id',d.case_id,'document_type',d.document_type,'state',d.state,
      'provider_artifact_id',d.provider_artifact_id,'created_at',d.created_at) x from public.sana_documents d join public.sana_cases k on k.case_id=d.case_id
     where k.conversation_id=cid and (t_before is null or (d.created_at,d.document_id::text)<(t_before,k_before)) order by d.created_at desc,d.document_id desc limit lim+1
    )s;result=result||jsonb_build_object('documents',rows);cnt=cnt+least(lim,jsonb_array_length(rows));
   end if;
   if section in ('all','notes') then
    select coalesce(jsonb_agg(x order by x->>'created_at' desc,(x->>'note_id')::bigint desc),'[]') into rows from (
     select jsonb_build_object('note_id',a.id::text,'case_id',a.target_id,'text',left(coalesce(a.details->>'text',a.details->>'note',''),4000),'created_at',a.created_at) x
     from public.support_access_audit a join public.sana_cases k on k.case_id::text=a.target_id
     where k.conversation_id=cid and a.action='human_case_note' and (t_before is null or (a.created_at,a.id)<(t_before,k_before::bigint))
     order by a.created_at desc,a.id desc limit lim+1
    )s;result=result||jsonb_build_object('notes',rows);cnt=cnt+least(lim,jsonb_array_length(rows));
   end if;
  end if;
 end if;
 insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,conversation_id,item_count,details)
 values(p_subject,p_client,g.operator_id,p_mode,cid,cnt,jsonb_strip_nulls(jsonb_build_object('date',p_args->>'date',
  'artifact_id',p_args->>'artifact_id','message_key',p_args->>'message_key','sha256',p_args->>'sha256')));
 return jsonb_build_object('status','ready','source','sana_administrative_read','environment','production','data',result);
end;
$$;
revoke all on function public.sana_mcp_admin_read(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sana_mcp_admin_read(uuid,uuid,text,jsonb) to service_role;

commit;
