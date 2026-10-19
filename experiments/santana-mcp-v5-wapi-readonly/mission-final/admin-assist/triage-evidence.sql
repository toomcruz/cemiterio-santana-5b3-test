-- Internal, bounded evidence only; the scoped administrative RPC authorizes first.
create or replace function sana_mcp_private.response_triage(p_conversation uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 with last_response as (
  select * from (
   select m.conversation_id,m.created_at,m.message_key as response_key,m.inbound_text as text
   from public.sana_inbox_messages m where m.conversation_id=p_conversation
    and m.sender_role in ('team','sana','assistant') and lower(m.delivery_state) in ('sent','delivered','read')
    and not m.hidden and not m.no_send
   union all
   select o.conversation_id,o.created_at,'sana-outbox:'||o.outbox_id::text,o.response_text
   from public.sana_outbox o where o.conversation_id=p_conversation and o.delivery_state in ('SENT','DELIVERED','READ')
    and not exists(select 1 from public.sana_operator_deliveries d where d.outbox_id=o.outbox_id and d.no_send)
    and not exists(select 1 from public.sana_message_audit a where a.outbox_id=o.outbox_id and a.no_send)
  ) x order by created_at desc,response_key desc limit 1
 ), tail as (
  select m.conversation_id,m.created_at,m.message_key,left(m.inbound_text,241) as text,
   jsonb_array_length(m.attachments)>0 as has_attachments,coalesce(length(m.inbound_text)>240,false) as truncated
  from public.sana_inbox_messages m cross join last_response r
  where m.conversation_id=p_conversation and m.sender_role='citizen' and not m.hidden and not m.no_send
   and m.created_at>=r.created_at order by m.created_at desc,m.message_key desc limit 9
 )
 select jsonb_build_object('complete',(select count(*)<=8 from tail) and exists(select 1 from last_response),
  'last_response',(select jsonb_build_object('conversation_id',conversation_id,'created_at',created_at,
   'text',left(text,4001),'confirmed_sent',true) from last_response),
  'unanswered',(select coalesce(jsonb_agg(jsonb_build_object('conversation_id',conversation_id,'created_at',created_at,
   'text',text,'has_attachments',has_attachments,'truncated',truncated) order by created_at,message_key),'[]') from tail));
$$;
revoke all on function sana_mcp_private.response_triage(uuid) from public,anon,authenticated;
grant execute on function sana_mcp_private.response_triage(uuid) to service_role;
