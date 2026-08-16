-- 5B.3-C: 0011 retired the 9-argument persist_inbound_classification overload
-- but left the earlier 8-argument overload from 0007 in the catalog. It predates
-- the classifier authority boundary (no authority key, nonce or assertion) and
-- is a second, unauthenticated write path into inbound_classifications.
-- It has no role grants and no caller in the package; retire it so the 13-argument
-- authority-bound RPC is the single classification entry point (P15).
begin;

drop function if exists support_vnext_shadow.persist_inbound_classification(
  uuid,uuid,uuid,uuid,uuid,text,text,text);

-- 0005 intended to retire the pre-facade propose_request_transaction overload but
-- listed a 12-argument signature; the deployed overload takes 13 arguments
-- (p_confirmation_nonce was omitted), so the drop silently skipped and the legacy
-- unvalidated proposal path survived. Retire it with the real signature.
drop function if exists support_vnext_shadow.propose_request_transaction(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb,char(64),timestamptz,bigint,bigint,uuid);

do $$
begin
  if to_regprocedure('support_vnext_shadow.propose_request_transaction(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb,char(64),timestamptz,bigint,bigint,uuid)') is not null then
    raise exception 'legacy proposal overload still present' using errcode='55000';
  end if;
  if to_regprocedure('support_vnext_shadow.propose_request_transaction(uuid,text)') is null then
    raise exception 'authoritative proposal RPC missing' using errcode='55000';
  end if;
  if to_regprocedure('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,text,text,text)') is not null then
    raise exception 'legacy classification overload still present' using errcode='55000';
  end if;
  if to_regprocedure('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text)') is null then
    raise exception 'authoritative classification RPC missing' using errcode='55000';
  end if;
end $$;

commit;
