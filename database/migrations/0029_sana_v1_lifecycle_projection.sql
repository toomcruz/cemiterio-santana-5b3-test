-- SANA V1 / LAB: project lifecycle state without changing the panel schema.
begin;

create or replace function support_runtime.project_conversation(
  p_conversation_id uuid,
  p_projection jsonb,
  p_mode text,
  p_message_id uuid,
  p_requests jsonb
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, support_runtime
as $$
declare
  v_flow jsonb := p_projection->'flow_state';
  v_waiting_team boolean;
  v_closed boolean := p_mode = 'closed'
    or coalesce(v_flow->>'lifecycle_state', '') = 'CLOSED';
begin
  v_waiting_team := coalesce(v_flow->>'waiting_for', '') = 'team'
    or coalesce(v_flow->>'handoff_requested', 'false') = 'true'
    or (nullif(v_flow->>'waiting_for', '') is null
      and coalesce(v_flow->>'active_goal_status', '') = 'WAITING'
      and nullif(v_flow->>'pending_question_code', '') is null
      and jsonb_array_length(coalesce(v_flow->'pending_action_codes', '[]'::jsonb)) > 0);

  update public.support_conversations
     set subject = p_projection->>'subject',
         stage = case when v_closed then stage else p_projection->>'stage' end,
         automation_mode = p_mode,
         flow_state = v_flow || jsonb_build_object('requests', p_requests),
         queue_status = case
           when v_closed then 'closed'
           when p_mode = 'human' or v_waiting_team then 'inbox'
           when p_projection->>'queue_status' = 'waiting_citizen'
             and nullif(v_flow->>'pending_question_code', '') is not null then 'waiting_citizen'
           else 'inbox'
         end,
         queue_updated_at = now(),
         last_outbound_at = case when p_message_id is not null then now() else last_outbound_at end,
         last_message_at = case when p_message_id is not null then now() else last_message_at end,
         updated_at = now()
   where id = p_conversation_id;
end $$;

commit;
