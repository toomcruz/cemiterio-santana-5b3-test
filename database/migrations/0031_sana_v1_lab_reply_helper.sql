-- SANA V1 / LAB: reply helper for the panel-only fixture schema.
-- No protocol is created here because support_service_requests is intentionally
-- absent from this isolated LAB surface.
begin;

create or replace function support_runtime.reply_with_protocols(
  p_conversation_id uuid,
  p_state jsonb,
  p_reply_body text
) returns jsonb
language sql
security invoker
set search_path = pg_catalog, support_runtime
as $$
  select jsonb_build_object('body', p_reply_body, 'request_ids', '[]'::jsonb);
$$;

commit;
