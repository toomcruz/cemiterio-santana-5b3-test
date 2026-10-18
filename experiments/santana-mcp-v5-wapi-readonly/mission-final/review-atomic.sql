begin;
create or replace function public.sana_mcp_review_intent_atomic(
 p_owner uuid,p_intent uuid,p_session uuid,p_digest text
) returns boolean language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
 if p_owner is null or p_session is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then
  return false;
 end if;
 update public.homolog_mcp_send_intents
 set state='human_reviewed_dispatch_blocked',reviewed_by=p_owner,
     review_session_id=p_session,reviewed_at=clock_timestamp()
 where id=p_intent and owner_id=p_owner and payload_sha256=p_digest
   and state='prepared' and expires_at>clock_timestamp()
 returning id into v_id;
 if v_id is null then return false;end if;
 -- This insert and the review transition commit together. Any audit failure
 -- aborts the transaction; there is no approved state without its audit row.
 insert into public.homolog_mcp_send_audit(owner_id,intent_id,operation,session_id)
 values(p_owner,p_intent,'human_review',p_session);
 return true;
end;
$$;
revoke all on function public.sana_mcp_review_intent_atomic(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sana_mcp_review_intent_atomic(uuid,uuid,uuid,text) to service_role;
commit;
