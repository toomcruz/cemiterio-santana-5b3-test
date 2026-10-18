-- REVIEW CANDIDATE ONLY. No grants are seeded. Apply only after explicit approval.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create table public.sana_mcp_supervision_access (
 subject_id uuid not null, client_id uuid not null, operator_id uuid not null references public.support_members(user_id),
 scope_key text not null check(scope_key='panel:santana'),
 conversation_ids uuid[],
 operations text[] not null check(operations <@ array['pending','context','rules','attachment','conversations','contact','messages','files']),
 is_active boolean not null default false, expires_at timestamptz not null,
 created_at timestamptz not null default now(), primary key(subject_id,client_id)
);
create table public.sana_mcp_rule_approvals (
 rule_id text not null, catalog_sha256 text not null check(catalog_sha256 ~ '^[a-f0-9]{64}$'),
 approved_by uuid not null references public.support_members(user_id), approved_at timestamptz not null,
 expires_at timestamptz not null, revoked_at timestamptz, approval_reference text not null default 'explicit-administrative-review', primary key(rule_id,catalog_sha256)
);
create table public.sana_mcp_admin_audit (
 id bigint generated always as identity primary key, created_at timestamptz not null default now(),
 subject_id uuid not null, client_id uuid not null, operator_id uuid not null,
 operation text not null, conversation_id uuid, item_count integer not null,
 details jsonb not null default '{}'
);
alter table public.sana_mcp_supervision_access enable row level security;
alter table public.sana_mcp_rule_approvals enable row level security;
alter table public.sana_mcp_admin_audit enable row level security;
revoke all on public.sana_mcp_supervision_access,public.sana_mcp_rule_approvals,public.sana_mcp_admin_audit from public,anon,authenticated;
grant select on public.sana_mcp_supervision_access,public.sana_mcp_rule_approvals to service_role;
-- PostgreSQL requires one UPDATE privilege for FOR SHARE. This server-only
-- column permission permits revocation/row locks, not new grants or scope changes.
grant update(is_active) on public.sana_mcp_supervision_access to service_role;
grant select,insert on public.sana_mcp_admin_audit to service_role;
grant usage,select on sequence public.sana_mcp_admin_audit_id_seq to service_role;

create function public.sana_mcp_admin_identity(p_subject uuid,p_client uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare operator uuid;
begin
 select g.operator_id into operator from public.sana_mcp_supervision_access g join public.support_members m on m.user_id=g.operator_id
 where g.subject_id=p_subject and g.client_id=p_client and g.scope_key='panel:santana' and g.is_active
  and g.expires_at>clock_timestamp() and m.role='admin' and m.is_active and m.approval_status='approved' and 'atendimentos'=any(m.permissions);
 if operator is null then raise exception 'MCP_ADMIN_GRANT_REQUIRED';end if;
 return operator;
end;
$$;
revoke all on function public.sana_mcp_admin_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sana_mcp_admin_identity(uuid,uuid) to service_role;

-- Actual provider acceptance is evidence; response_text alone is never evidence.
create function public.sana_mcp_admin_delivery(p_id uuid,p_key text,p_received timestamptz)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(e order by e->>'created_at',e->>'id'),'[]') from (select e from (
  select jsonb_build_object('id',m.message_key,'source','team','state',upper(m.delivery_state),
   'created_at',m.created_at,'settled_at',m.settled_at,'covers_latest',m.created_at>=p_received,
   'delivered_at',null) e
  from public.sana_inbox_messages m where m.conversation_id=p_id and m.sender_role='team'
   and not m.hidden and not m.no_send and
   (m.created_at>=p_received or upper(m.delivery_state) in ('PENDING','CLAIMED','DISPATCHING','UNKNOWN'))
  union all
  select jsonb_build_object('id',o.outbox_id,'source','sana','state',upper(o.delivery_state),
   'created_at',o.created_at,'settled_at',o.settled_at,
   'covers_latest',exists(select 1 from public.sana_message_audit a where a.outbox_id=o.outbox_id and a.message_key=p_key),
   'delivered_at',(select max(a.delivered_at) from public.sana_message_audit a where a.outbox_id=o.outbox_id))
  from public.sana_outbox o where o.conversation_id=p_id
   and (o.created_at>=p_received or upper(o.delivery_state) in ('PENDING','CLAIMED','UNKNOWN'))
   and not exists(select 1 from public.sana_operator_deliveries d where d.outbox_id=o.outbox_id and d.no_send)
   and not exists(select 1 from public.sana_message_audit a where a.outbox_id=o.outbox_id and a.no_send)
 )u order by e->>'created_at' desc,e->>'id' desc limit 101
 )t;
$$;
revoke all on function public.sana_mcp_admin_delivery(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sana_mcp_admin_delivery(uuid,text,timestamptz) to service_role;

create function public.sana_mcp_admin_read(p_subject uuid,p_client uuid,p_mode text,p_args jsonb)
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
    'contact_key','+••••••'||right(c.contact_key,4),'revision',c.revision,'automation_mode',c.automation_mode,
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
