-- LAB-only hardening: the inbound runtime RPC is service-role/server-side only.
-- Keep the public signature stable while removing accidental client execution.
revoke all on function public.support_runtime_acquire_inbound(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  char
) from public, anon, authenticated;

grant execute on function public.support_runtime_acquire_inbound(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  char
) to service_role;

revoke all on function public.support_runtime_commit_turn(
  uuid,
  uuid,
  bigint,
  char,
  char,
  jsonb,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.support_runtime_commit_turn(
  uuid,
  uuid,
  bigint,
  char,
  char,
  jsonb,
  text,
  text,
  text,
  jsonb
) to service_role;
