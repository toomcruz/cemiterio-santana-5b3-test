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
commit;
