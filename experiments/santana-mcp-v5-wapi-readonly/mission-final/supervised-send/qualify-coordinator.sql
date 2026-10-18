begin;
create temporary table support_members(user_id uuid primary key,is_active boolean,approval_status text,permissions text[]);
create temporary table sana_conversations(conversation_id uuid primary key,contact_key text,revision integer default 0,automation_mode text default 'bot',state_json jsonb default '{}',updated_at timestamptz);
create temporary table sana_events(conversation_id uuid,revision integer,event_type text,idempotency_key text unique,payload_json jsonb);
create temporary table sana_inbox_messages(message_key text primary key,conversation_id uuid,inbound_text text,response_text text,attachments jsonb,sender_role text,delivery_state text,external_message_id text,actor_id uuid,action_id uuid,claim_token uuid,no_send boolean,hidden boolean default false,created_at timestamptz default clock_timestamp(),settled_at timestamptz,unique(actor_id,action_id));
create temporary table sana_operator_attachments(artifact_id uuid,actor_id uuid,conversation_id uuid,action_id uuid,verified_at timestamptz,created_at timestamptz,file_name text,mime_type text);
create temporary table sana_outbox(outbox_id uuid,conversation_id uuid,delivery_state text,dispatch_started_at timestamptz);
create temporary table test_auth_sessions(id uuid,user_id uuid,not_after timestamptz);
create temporary table sana_mcp_read_access(subject_id uuid,client_id uuid,operator_id uuid,conversation_id uuid,is_active boolean,expires_at timestamptz);
CREATE OR REPLACE FUNCTION pg_temp.sana_control_transition(p_conversation_id uuid, p_expected_revision integer, p_mode text, p_actor text, p_action_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_conversation pg_temp.sana_conversations%rowtype;
  v_revision integer;
begin
  if p_mode not in ('bot','human','paused') or p_actor is null
    or length(p_actor) not between 3 and 160 or p_action_id is null
    or p_action_id !~ '^sana:control:[A-Za-z0-9:_-]{1,160}$' then
    raise exception 'invalid_control' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_action_id,0));
  if exists(select 1 from pg_temp.sana_events where idempotency_key=p_action_id) then
    return jsonb_build_object('status','duplicate');
  end if;
  select * into v_conversation from pg_temp.sana_conversations
    where conversation_id=p_conversation_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_conversation.revision <> p_expected_revision then
    return jsonb_build_object('status','revision_conflict','current_revision',v_conversation.revision);
  end if;
  v_revision := v_conversation.revision+1;
  update pg_temp.sana_conversations
    set revision=v_revision,automation_mode=p_mode,state_json=state_json || jsonb_build_object('automation_mode',p_mode,'manual_takeover',p_mode<>'bot'),
      updated_at=now() where conversation_id=p_conversation_id;
  insert into pg_temp.sana_events(conversation_id,revision,event_type,idempotency_key,payload_json)
    values(p_conversation_id,v_revision,'OPERATOR_CONTROL',p_action_id,
      jsonb_build_object('mode',p_mode,'actor',p_actor));
  return jsonb_build_object('status','committed','revision',v_revision,'automation_mode',p_mode);
end;
$function$;

CREATE OR REPLACE FUNCTION pg_temp.sana_manual_whatsapp(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 c pg_temp.sana_conversations%rowtype; m pg_temp.sana_inbox_messages%rowtype;
 attachment pg_temp.sana_operator_attachments%rowtype; attachments jsonb='[]'::jsonb;
 actor uuid=(p->>'actor_id')::uuid; op text=p->>'operation'; phone text=p->>'phone';
 action uuid; id uuid; msg text=btrim(coalesce(p->>'text','')); outcome text=p->>'outcome';
begin
 if not exists(select 1 from pg_temp.support_members where user_id=actor and is_active and approval_status='approved' and 'atendimentos'=any(permissions))
 then return jsonb_build_object('status','OPERATOR_NOT_AUTHORIZED'); end if;
 if op='open' then
  if phone is null or phone !~ '^\+[1-9][0-9]{7,14}$' or length(coalesce(p->>'name',''))>100 then return jsonb_build_object('status','INVALID_CONTACT'); end if;
  perform pg_advisory_xact_lock(hashtextextended(phone,0));
  select * into c from pg_temp.sana_conversations where contact_key=phone for update;
  if not found then
   insert into pg_temp.sana_conversations(conversation_id,contact_key,automation_mode,state_json)
   values(gen_random_uuid(),phone,'human',jsonb_build_object('automation_mode','human','manual_takeover',true,'contact_name',coalesce(p->>'name','')))
   returning * into c;
  elsif nullif(btrim(p->>'name'),'') is not null then
   update pg_temp.sana_conversations set state_json=state_json||jsonb_build_object('contact_name',btrim(p->>'name')),updated_at=clock_timestamp() where conversation_id=c.conversation_id;
  end if;
  return jsonb_build_object('status','ready','conversation_id',c.conversation_id);
 end if;
 if op='prepare' then
  action=(p->>'action_id')::uuid; id=(p->>'conversation_id')::uuid;
  if action is null or id is null or length(msg)>3000 or (msg='' and p->>'attachment_id' is null) then return jsonb_build_object('status','INVALID_REPLY'); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||action::text,0));
  select * into m from pg_temp.sana_inbox_messages where actor_id=actor and action_id=action;
  if found then
   if m.conversation_id<>id or m.inbound_text<>msg or (m.attachments->0->>'artifact_id') is distinct from (p->>'attachment_id') then return jsonb_build_object('status','ACTION_CONFLICT'); end if;
   return jsonb_build_object('status','duplicate','delivery_state',case when m.delivery_state='dispatching' and m.created_at<clock_timestamp()-interval '2 minutes' then 'unknown' else m.delivery_state end,'message_key',m.message_key);
  end if;
  if p->>'attachment_id' is not null then
   select * into attachment from pg_temp.sana_operator_attachments where artifact_id=(p->>'attachment_id')::uuid
     and actor_id=actor and conversation_id=id and action_id=action and verified_at is not null and created_at>clock_timestamp()-interval '2 hours';
   if not found then return jsonb_build_object('status','ATTACHMENT_NOT_READY'); end if;
   attachments=jsonb_build_array(jsonb_build_object('artifact_id',attachment.artifact_id,'file_name',attachment.file_name,
     'type',case when attachment.mime_type like 'image/%' then 'image' else 'document' end,'mime_type',attachment.mime_type,'source','operator'));
  end if;
  select * into c from pg_temp.sana_conversations where conversation_id=id for update;
  if not found then return jsonb_build_object('status','CONVERSATION_NOT_FOUND'); end if;
  if c.revision is distinct from (p->>'expected_revision')::integer then return jsonb_build_object('status','REVISION_CONFLICT'); end if;
  update pg_temp.sana_conversations set revision=revision+1,updated_at=clock_timestamp(),
   state_json=state_json||jsonb_build_object('automation_mode','human','manual_takeover',true) where conversation_id=id;
  insert into pg_temp.sana_inbox_messages(message_key,conversation_id,inbound_text,attachments,sender_role,delivery_state,actor_id,action_id,claim_token,no_send)
  values('manual:'||actor||':'||action,id,msg,attachments,'team',case when c.contact_key like '+120255501%' or c.state_json->'technical'='true'::jsonb then 'test' else 'dispatching' end,
   actor,action,gen_random_uuid(),c.contact_key like '+120255501%' or coalesce(c.state_json->'technical'='true'::jsonb,false)) returning * into m;
  return jsonb_build_object('status','prepared','delivery_state',m.delivery_state,'message_key',m.message_key,'claim_token',m.claim_token,'recipient_e164',c.contact_key,'text',msg,'attachment_id',p->>'attachment_id','no_send',m.no_send);
 end if;
 if op='settle' then
  if outcome not in ('sent','failed','unknown') or outcome is null then return jsonb_build_object('status','INVALID_OUTCOME'); end if;
  select * into m from pg_temp.sana_inbox_messages where actor_id=actor and action_id=(p->>'action_id')::uuid for update;
  if not found or m.claim_token is distinct from (p->>'claim_token')::uuid then return jsonb_build_object('status','CLAIM_MISMATCH'); end if;
  if m.delivery_state<>'dispatching' then return jsonb_build_object('status','duplicate','delivery_state',m.delivery_state); end if;
  if outcome='sent' and coalesce(p->>'provider_message_id','') !~ '^[A-Za-z0-9._:@-]{1,200}$' then return jsonb_build_object('status','INVALID_PROVIDER_ACK'); end if;
  update pg_temp.sana_inbox_messages set delivery_state=outcome,settled_at=clock_timestamp(),external_message_id=case when outcome='sent' then p->>'provider_message_id' end where message_key=m.message_key;
  if outcome='sent' then update pg_temp.sana_inbox_messages set hidden=true where conversation_id=m.conversation_id and actor_id is null and sender_role='team' and external_message_id=p->>'provider_message_id'; end if;
  return jsonb_build_object('status','committed','delivery_state',outcome,'message_key',m.message_key);
 end if;
 return jsonb_build_object('status','ACTION_NOT_ALLOWED');
end $function$;


create function pg_temp.session_active(p_owner uuid,p_session uuid) returns boolean
language sql security definer set search_path=pg_catalog as $$
 select exists(select 1 from pg_temp.test_auth_sessions where id=p_session and user_id=p_owner and (not_after is null or not_after>clock_timestamp()));
$$;
revoke all on function pg_temp.session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function pg_temp.session_active(uuid,uuid) to service_role;
create function pg_temp.sana_mcp_session_active(p_owner uuid,p_session uuid) returns boolean
language sql security invoker set search_path=pg_catalog as $$select pg_temp.session_active(p_owner,p_session);$$;
revoke all on function pg_temp.sana_mcp_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function pg_temp.sana_mcp_session_active(uuid,uuid) to service_role;
create table pg_temp.sana_mcp_send_permissions (
 subject_id uuid not null, client_id uuid not null, operator_id uuid not null,
 conversation_id uuid not null references pg_temp.sana_conversations(conversation_id),
 live_enabled boolean not null default false, expires_at timestamptz not null,
 primary key(subject_id,client_id,operator_id,conversation_id)
);
create table pg_temp.sana_mcp_send_operations (
 operation_id uuid primary key, subject_id uuid not null, client_id uuid not null,
 operator_id uuid not null, operator_session_id uuid not null,
 conversation_id uuid not null references pg_temp.sana_conversations(conversation_id),
 payload jsonb not null, payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 recipient_e164 text not null, expected_revision integer not null,
 state text not null check(state in ('authorized','dispatching','sent','failed','unknown','test')),
 expires_at timestamptz not null, authorized_at timestamptz not null default clock_timestamp(),
 claimed_at timestamptz, settled_at timestamptz, provider_message_id text,
 check(payload->'attachment' is not distinct from 'null'::jsonb),
 check(payload->>'conversation_id'=conversation_id::text)
);
create unique index sana_mcp_one_dispatch on pg_temp.sana_mcp_send_operations(conversation_id)
 where state in ('dispatching','unknown');
create table pg_temp.sana_mcp_send_events (
 id bigint generated always as identity primary key,operation_id uuid not null references pg_temp.sana_mcp_send_operations(operation_id),
 event text not null, created_at timestamptz not null default clock_timestamp(),details jsonb not null default '{}'
);
alter table pg_temp.sana_mcp_send_permissions enable row level security;
alter table pg_temp.sana_mcp_send_operations enable row level security;
alter table pg_temp.sana_mcp_send_events enable row level security;
revoke all on pg_temp.sana_mcp_send_permissions,pg_temp.sana_mcp_send_operations,pg_temp.sana_mcp_send_events from public,anon,authenticated;
grant select on pg_temp.sana_mcp_send_permissions to service_role;
grant select,insert,update on pg_temp.sana_mcp_send_operations to service_role;
grant insert,select on pg_temp.sana_mcp_send_events to service_role;
grant usage,select on sequence pg_temp.sana_mcp_send_events_id_seq to service_role;

create function pg_temp.sana_mcp_coordinated_send(p jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 op uuid=(p->>'operation_id')::uuid; sub uuid=(p->>'subject_id')::uuid;
 cli uuid=(p->>'client_id')::uuid; actor uuid=(p->>'operator_id')::uuid;
 cid uuid; c pg_temp.sana_conversations%rowtype; o pg_temp.sana_mcp_send_operations%rowtype;
 control jsonb; r jsonb; kind text=p->>'operation';
begin
 if op is null or sub is null or cli is distinct from 'ccb5e1fc-2a61-4296-943a-a85c103e9313'::uuid
  or kind not in ('authorize','prepare','settle','status') then raise exception 'MCP_INVALID_OPERATION';end if;
 -- Same policy-lock ordering as the existing automatic delivery functions.
 perform pg_advisory_xact_lock_shared(721937420612::bigint);
 perform pg_advisory_xact_lock(hashtextextended('mcp-send:'||op::text,0));
 select * into o from pg_temp.sana_mcp_send_operations where operation_id=op;
 if found then
  if o.subject_id<>sub or o.client_id<>cli then raise exception 'MCP_OPERATION_NOT_AVAILABLE';end if;
  cid=o.conversation_id;actor=o.operator_id;
 else
  if kind<>'authorize' then raise exception 'MCP_OPERATION_NOT_AVAILABLE';end if;
  cid=(p->>'conversation_id')::uuid;
 end if;
 select * into c from pg_temp.sana_conversations where conversation_id=cid for update;
 if not found then raise exception 'MCP_CONVERSATION_NOT_AVAILABLE';end if;
 -- SQL locks the authoritative conversation before any outbox or manual claim.
 if not exists(select 1 from pg_temp.support_members where user_id=actor and is_active and approval_status='approved'
   and 'atendimentos'=any(permissions)) then raise exception 'MCP_PROD_OPERATOR_REVOKED';end if;
 if kind='status' then
  return jsonb_build_object('status','ready','state',o.state,'operation_id',op,'payload_sha256',o.payload_sha256,
   'accepted_by_api',o.state='sent','delivery_confirmed',false);
 end if;
 if kind='settle' then
  if o.state<>'dispatching' then return jsonb_build_object('status','duplicate','delivery_state',o.state);end if;
  r=pg_temp.sana_manual_whatsapp(jsonb_build_object('operation','settle','actor_id',actor,'action_id',op,
   'claim_token',p->>'claim_token','outcome',p->>'outcome','provider_message_id',p->>'provider_message_id'));
  if r->>'status'<>'committed' then raise exception 'MCP_SETTLEMENT_FAILED';end if;
  update pg_temp.sana_mcp_send_operations set state=p->>'outcome',settled_at=clock_timestamp(),
   provider_message_id=case when p->>'outcome'='sent' then p->>'provider_message_id' end where operation_id=op;
  insert into pg_temp.sana_mcp_send_events(operation_id,event,details) values(op,'settled',jsonb_build_object('outcome',p->>'outcome'));
  return r;
 end if;
 if kind='authorize' and o.operation_id is not null then
  if o.operator_id is distinct from (p->>'operator_id')::uuid or o.payload is distinct from p->'payload'
   or o.payload_sha256 is distinct from p->>'payload_sha256' then raise exception 'MCP_APPROVAL_CONFLICT';end if;
  return jsonb_build_object('status','duplicate','operation_id',op,'state',o.state);
 end if;
 if kind='prepare' and o.state<>'authorized' then
  return jsonb_build_object('status','duplicate','delivery_state',case when o.state='dispatching' then 'unknown' else o.state end);
 end if;
 if not exists(select 1 from pg_temp.sana_mcp_send_permissions where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and live_enabled and expires_at>clock_timestamp()) then raise exception 'MCP_LIVE_PERMISSION_DISABLED';end if;
 if not exists(select 1 from pg_temp.sana_mcp_read_access where subject_id=sub and client_id=cli and operator_id=actor
  and conversation_id=cid and is_active and expires_at>clock_timestamp()) then raise exception 'MCP_BINDING_REVOKED';end if;
 if kind='authorize' then
  if not pg_temp.session_active(actor,(p->>'operator_session_id')::uuid) then raise exception 'MCP_PROD_SESSION_REQUIRED';end if;
  if p->'payload'->'attachment' is distinct from 'null'::jsonb or p->'payload'->>'conversation_id' is distinct from cid::text
   or p->'payload'->>'text' is null or length(p->'payload'->>'text') not between 1 and 3000
   or p->'payload'->>'text'<>btrim(p->'payload'->>'text')
   or p->>'payload_sha256' !~ '^[a-f0-9]{64}$' or p->>'payload_sha256' is null
   or p->>'explicit_authorization' is distinct from 'one_real_text_attempt'
   or c.revision is distinct from (p->'payload'->>'expected_revision')::integer
   or (p->>'expires_at')::timestamptz is null or (p->>'expires_at')::timestamptz<=clock_timestamp()
   or (p->>'expires_at')::timestamptz>clock_timestamp()+interval '10 minutes'
  then raise exception 'MCP_APPROVAL_INVALID_OR_STALE';end if;
  insert into pg_temp.sana_mcp_send_operations(operation_id,subject_id,client_id,operator_id,operator_session_id,
   conversation_id,payload,payload_sha256,recipient_e164,expected_revision,state,expires_at)
  values(op,sub,cli,actor,(p->>'operator_session_id')::uuid,cid,p->'payload',p->>'payload_sha256',c.contact_key,c.revision,'authorized',(p->>'expires_at')::timestamptz);
  insert into pg_temp.sana_mcp_send_events(operation_id,event) values(op,'prod_operator_authorized_one_attempt');
  return jsonb_build_object('status','authorized','operation_id',op,'payload_sha256',p->>'payload_sha256');
 end if;
 if o.expires_at<=clock_timestamp() or not pg_temp.session_active(actor,o.operator_session_id) then raise exception 'MCP_AUTHORIZATION_EXPIRED';end if;
 if p->>'payload_sha256' is distinct from o.payload_sha256 or c.contact_key is distinct from o.recipient_e164
   or c.revision<>o.expected_revision then raise exception 'MCP_RECIPIENT_CONTENT_OR_REVISION_CHANGED';end if;
 if exists(select 1 from pg_temp.sana_outbox where conversation_id=cid and delivery_state in ('PENDING','CLAIMED','UNKNOWN'))
  or exists(select 1 from pg_temp.sana_inbox_messages where conversation_id=cid and delivery_state in ('dispatching','unknown'))
  or exists(select 1 from pg_temp.sana_mcp_send_operations where conversation_id=cid and state in ('dispatching','unknown'))
 then raise exception 'MCP_CONCURRENT_OR_AMBIGUOUS_DELIVERY';end if;
 control=pg_temp.sana_control_transition(cid,c.revision,'human','mcp:'||actor::text,'sana:control:mcp:'||op::text);
 if control->>'status'<>'committed' then raise exception 'MCP_HUMAN_CONTROL_FAILED';end if;
 update pg_temp.sana_mcp_send_operations set state='dispatching',claimed_at=clock_timestamp() where operation_id=op;
 r=pg_temp.sana_manual_whatsapp(jsonb_build_object('operation','prepare','actor_id',actor,'conversation_id',cid,'action_id',op,
  'expected_revision',(control->>'revision')::integer,'text',o.payload->>'text'));
 if r->>'status'<>'prepared' then raise exception 'MCP_OFFICIAL_PREPARE_FAILED';end if;
 if r->>'recipient_e164' is distinct from o.recipient_e164 or r->>'text' is distinct from o.payload->>'text'
  or r->>'no_send' not in ('true','false') then raise exception 'MCP_OFFICIAL_RECEIPT_CHANGED';end if;
 if (r->>'no_send')::boolean then update pg_temp.sana_mcp_send_operations set state='test',settled_at=clock_timestamp() where operation_id=op;end if;
 insert into pg_temp.sana_mcp_send_events(operation_id,event) values(op,'official_claim_created');
 return r;
end $$;
revoke all on function pg_temp.sana_mcp_coordinated_send(jsonb) from public,anon,authenticated;
grant execute on function pg_temp.sana_mcp_coordinated_send(jsonb) to service_role;

-- Locks cover existing Panel, automatic Sana/n8n delivery, and mode changes.
-- No active MCP claim means these triggers leave existing behavior unchanged.
create function pg_temp.send_barrier() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare active pg_temp.sana_mcp_send_operations%rowtype; cid uuid;
begin
 cid=new.conversation_id;
 -- Existing emitters already lock this row. Acquire it also for direct writes.
 perform 1 from pg_temp.sana_conversations where conversation_id=cid for update;
 select * into active from pg_temp.sana_mcp_send_operations where conversation_id=cid and state in ('dispatching','unknown');
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
revoke all on function pg_temp.send_barrier() from public,anon,authenticated;
create trigger sana_mcp_manual_barrier before insert or update on pg_temp.sana_inbox_messages for each row execute function pg_temp.send_barrier();
create trigger sana_mcp_outbox_barrier before insert or update on pg_temp.sana_outbox for each row execute function pg_temp.send_barrier();
create trigger sana_mcp_mode_barrier before update of automation_mode,state_json on pg_temp.sana_conversations for each row execute function pg_temp.send_barrier();
-- Deliberately no permissions inserted or enabled. Deployment cannot send.

do $test$
declare actor uuid='10000000-0000-4000-8000-000000000001'; sub uuid='10000000-0000-4000-8000-000000000002'; sid uuid='10000000-0000-4000-8000-000000000003';
 cid uuid='10000000-0000-4000-8000-000000000004'; op uuid='10000000-0000-4000-8000-000000000005'; cli uuid='ccb5e1fc-2a61-4296-943a-a85c103e9313';p jsonb;r jsonb;
begin
 insert into pg_temp.support_members values(actor,true,'approved',array['atendimentos']);
 insert into pg_temp.test_auth_sessions values(sid,actor,now()+interval '1 hour');
 insert into pg_temp.sana_conversations(conversation_id,contact_key) values(cid,'+12025550200');
 insert into pg_temp.sana_mcp_send_permissions values(sub,cli,actor,cid,false,now()+interval '1 hour');
 insert into pg_temp.sana_mcp_read_access values(sub,cli,actor,cid,true,now()+interval '1 hour');
 p=jsonb_build_object('operation','authorize','operation_id',op,'subject_id',sub,'client_id',cli,'operator_id',actor,'operator_session_id',sid,'conversation_id',cid,'payload_sha256',repeat('a',64),'expires_at',now()+interval '5 minutes','explicit_authorization','one_real_text_attempt','payload',jsonb_build_object('conversation_id',cid,'expected_revision',0,'recipient',jsonb_build_object('name','Synthetic','phone_mask','***0200'),'text','Synthetic text','attachment',null));
 begin perform pg_temp.sana_mcp_coordinated_send(p);raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_LIVE_PERMISSION_DISABLED' then raise;end if;end;
 update pg_temp.sana_mcp_send_permissions set live_enabled=true;
 r=pg_temp.sana_mcp_coordinated_send(p);if r->>'status'<>'authorized' then raise exception 'TEST_AUTHORIZE';end if;
 -- An older automatic claim blocks before either human-control write or manual claim.
 insert into pg_temp.sana_outbox values(gen_random_uuid(),cid,'CLAIMED',clock_timestamp());
 begin perform pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}');raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_CONCURRENT_OR_AMBIGUOUS_DELIVERY' then raise;end if;end;
 if (select revision from pg_temp.sana_conversations where conversation_id=cid)<>0 then raise exception 'TEST_PARTIAL_CONTROL_WRITE';end if;
 delete from pg_temp.sana_outbox;
 r=pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}');if r->>'status'<>'prepared' then raise exception 'TEST_PREPARE';end if;
 if not exists(select 1 from pg_temp.sana_conversations where conversation_id=cid and revision=2 and automation_mode='human' and state_json->>'automation_mode'='human' and state_json->>'manual_takeover'='true')then raise exception 'TEST_CONTROL_INCONSISTENT';end if;
 if pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}')->>'status'<>'duplicate' then raise exception 'TEST_DUPLICATE';end if;
 begin perform pg_temp.sana_manual_whatsapp(jsonb_build_object('operation','prepare','actor_id',actor,'conversation_id',cid,'action_id',gen_random_uuid(),'expected_revision',2,'text','Competing panel message'));raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_CONVERSATION_BUSY' then raise;end if;end;
 begin insert into pg_temp.sana_outbox values(gen_random_uuid(),cid,'CLAIMED',clock_timestamp());raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_CONVERSATION_BUSY' then raise;end if;end;
 begin perform pg_temp.sana_control_transition(cid,2,'bot','synthetic','sana:control:competing');raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_HUMAN_CONTROL_REQUIRED' then raise;end if;end;
 perform pg_temp.sana_mcp_coordinated_send(p||jsonb_build_object('operation','settle','claim_token',r->>'claim_token','outcome','unknown'));
 if pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}')->>'delivery_state'<>'unknown' then raise exception 'TEST_UNKNOWN_RETRIED';end if;
 if (select count(*) from pg_temp.sana_inbox_messages)<>1 then raise exception 'TEST_DUPLICATION';end if;
 if (select count(*) from pg_temp.sana_mcp_send_events)<>3 then raise exception 'TEST_AUDIT';end if;
end $test$;
select jsonb_build_object('result','PASS','production_writes',0,'transport','not_called','checks',array['disabled_gate','prod_session_binding','older_inflight_blocks_without_partial_changes','official_transition_column_and_json','official_manual_claim','duplicate_no_claim','panel_competitor_blocked','outbox_competitor_blocked','bot_reactivation_blocked','unknown_no_retry','atomic_audit']) as qualification;
rollback;
