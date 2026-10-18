-- Candidate extension for exact reviewed PNG/JPEG/PDF; NOT APPLIED TO PROD.
begin;
create schema if not exists sana_mcp_private;
revoke all on schema sana_mcp_private from public,anon,authenticated;
grant usage on schema sana_mcp_private to service_role;
create function sana_mcp_private.session_active(p_owner uuid,p_session uuid) returns boolean
language sql security definer set search_path=pg_catalog as $$
 select exists(select 1 from auth.sessions where id=p_session and user_id=p_owner and (not_after is null or not_after>clock_timestamp()));
$$;
revoke all on function sana_mcp_private.session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function sana_mcp_private.session_active(uuid,uuid) to service_role;
create function public.sana_mcp_session_active(p_owner uuid,p_session uuid) returns boolean
language sql security invoker set search_path=pg_catalog as $$select sana_mcp_private.session_active(p_owner,p_session);$$;
revoke all on function public.sana_mcp_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sana_mcp_session_active(uuid,uuid) to service_role;
create table public.sana_mcp_send_permissions (
 subject_id uuid not null, client_id uuid not null, operator_id uuid not null,
 conversation_id uuid not null references public.sana_conversations(conversation_id),
 live_enabled boolean not null default false, expires_at timestamptz not null,
 primary key(subject_id,client_id,operator_id,conversation_id)
);
create table public.sana_mcp_send_operations (
 operation_id uuid primary key, subject_id uuid not null, client_id uuid not null,
 operator_id uuid not null, operator_session_id uuid not null,
 conversation_id uuid not null references public.sana_conversations(conversation_id),
 attachment_id uuid references public.sana_operator_attachments(artifact_id),
 payload jsonb not null, payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 recipient_e164 text not null, expected_revision integer not null,
 state text not null check(state in ('authorized','dispatching','sent','failed','unknown','test')),
 expires_at timestamptz not null, authorized_at timestamptz not null default clock_timestamp(),
 claimed_at timestamptz, settled_at timestamptz, provider_message_id text,
 constraint sana_mcp_send_operations_attachment_binding check((attachment_id is null and payload->'attachment'='null'::jsonb) or (attachment_id is not null and jsonb_typeof(payload->'attachment')='object')),
 check(payload->>'conversation_id'=conversation_id::text)
);
create unique index sana_mcp_one_dispatch on public.sana_mcp_send_operations(conversation_id)
 where state in ('dispatching','unknown');
create table public.sana_mcp_send_events (
 id bigint generated always as identity primary key,operation_id uuid not null references public.sana_mcp_send_operations(operation_id),
 event text not null, created_at timestamptz not null default clock_timestamp(),details jsonb not null default '{}'
);
alter table public.sana_mcp_send_permissions enable row level security;
alter table public.sana_mcp_send_operations enable row level security;
alter table public.sana_mcp_send_events enable row level security;
revoke all on public.sana_mcp_send_permissions,public.sana_mcp_send_operations,public.sana_mcp_send_events from public,anon,authenticated;
grant select on public.sana_mcp_send_permissions to service_role;
grant select,insert,update on public.sana_mcp_send_operations to service_role;
grant insert,select on public.sana_mcp_send_events to service_role;
grant usage,select on sequence public.sana_mcp_send_events_id_seq to service_role;

create function sana_mcp_private.attachment_matches(m jsonb,aid uuid,actor uuid,cid uuid,op uuid) returns boolean
language sql security invoker set search_path=pg_catalog,public as $$
 select exists(select 1 from public.sana_operator_attachments a where a.artifact_id=aid and a.actor_id=actor
  and a.conversation_id=cid and a.action_id=op and a.verified_at is not null and a.created_at>clock_timestamp()-interval '2 hours'
  and a.mime_type in ('image/png','image/jpeg','application/pdf') and a.size_bytes between 16 and 524288
  and m=jsonb_build_object('name',a.file_name,'mime_type',a.mime_type,'size_bytes',a.size_bytes,'sha256',a.sha256));
$$;
revoke all on function sana_mcp_private.attachment_matches(jsonb,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function sana_mcp_private.attachment_matches(jsonb,uuid,uuid,uuid,uuid) to service_role;

create function public.sana_mcp_coordinated_send(p jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 op uuid=(p->>'operation_id')::uuid; sub uuid=(p->>'subject_id')::uuid;
 cli uuid=(p->>'client_id')::uuid; actor uuid=(p->>'operator_id')::uuid;
 cid uuid; c public.sana_conversations%rowtype; o public.sana_mcp_send_operations%rowtype;
 control jsonb; r jsonb; kind text=p->>'operation';
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
 if not exists(select 1 from public.sana_mcp_send_permissions where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and live_enabled and expires_at>clock_timestamp()) then raise exception 'MCP_LIVE_PERMISSION_DISABLED';end if;
 if not exists(select 1 from public.sana_mcp_read_access where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and is_active and expires_at>clock_timestamp()) then raise exception 'MCP_BINDING_REVOKED';end if;
 if kind='authorize' then
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
end $$;
revoke all on function public.sana_mcp_coordinated_send(jsonb) from public,anon,authenticated;
grant execute on function public.sana_mcp_coordinated_send(jsonb) to service_role;

-- Locks cover existing Panel, automatic Sana/n8n delivery, and mode changes.
-- No active MCP claim means these triggers leave existing behavior unchanged.
create function sana_mcp_private.send_barrier() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare active public.sana_mcp_send_operations%rowtype; cid uuid;
begin
 cid=new.conversation_id;
 -- Existing emitters already lock this row. Acquire it also for direct writes.
 perform 1 from public.sana_conversations where conversation_id=cid for update;
 select * into active from public.sana_mcp_send_operations where conversation_id=cid and state in ('dispatching','unknown');
 if not found then return new;end if;
 if tg_table_name='sana_inbox_messages' then
  if new.delivery_state='dispatching' and (new.actor_id is distinct from active.operator_id or new.action_id is distinct from active.operation_id)
  then raise exception 'MCP_CONVERSATION_BUSY';end if;
 elsif tg_table_name='sana_outbox' then
  if new.delivery_state='CLAIMED' or new.dispatch_started_at is not null and (tg_op='INSERT' or new.dispatch_started_at is distinct from old.dispatch_started_at)
  then raise exception 'MCP_CONVERSATION_BUSY';end if;
 elsif new.automation_mode is distinct from 'human' or new.state_json->>'automation_mode' is distinct from 'human' or new.state_json->>'manual_takeover' is distinct from 'true'
 then raise exception 'MCP_HUMAN_CONTROL_REQUIRED';end if;
 return new;
end $$;
revoke all on function sana_mcp_private.send_barrier() from public,anon,authenticated;
create trigger sana_mcp_manual_barrier before insert or update on public.sana_inbox_messages for each row execute function sana_mcp_private.send_barrier();
create trigger sana_mcp_outbox_barrier before insert or update on public.sana_outbox for each row execute function sana_mcp_private.send_barrier();
create trigger sana_mcp_mode_barrier before update of automation_mode,state_json on public.sana_conversations for each row execute function sana_mcp_private.send_barrier();
-- Deliberately no permissions inserted or enabled. Deployment cannot send.
commit;
