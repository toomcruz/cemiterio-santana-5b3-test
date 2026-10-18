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
