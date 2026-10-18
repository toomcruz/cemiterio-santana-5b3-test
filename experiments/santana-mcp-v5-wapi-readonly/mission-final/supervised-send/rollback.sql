-- Candidate rollback BEFORE a live trial. Never remove protection for an active claim.
begin;
do $$begin
 if exists(select 1 from public.sana_mcp_send_operations) then
  raise exception 'MCP_ROLLBACK_REQUIRES_OPERATION_RECONCILIATION';
 end if;
end $$;
drop trigger sana_mcp_manual_barrier on public.sana_inbox_messages;
drop trigger sana_mcp_outbox_barrier on public.sana_outbox;
drop trigger sana_mcp_mode_barrier on public.sana_conversations;
drop function sana_mcp_private.send_barrier();
drop function public.sana_mcp_coordinated_send(jsonb);
drop table public.sana_mcp_send_events,public.sana_mcp_send_operations,public.sana_mcp_send_permissions;
drop function public.sana_mcp_session_active(uuid,uuid);
drop function sana_mcp_private.session_active(uuid,uuid);
-- Retain the private schema; do not drop any unrelated objects.
commit;
