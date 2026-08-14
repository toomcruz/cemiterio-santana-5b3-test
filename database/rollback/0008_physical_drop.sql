begin;
do $$ begin
 if exists(select 1 from support_vnext_shadow.support_ruleset_release where status in ('PUBLISHED','SUPERSEDED','REVOKED')) or exists(select 1 from support_vnext_shadow.service_requests) or exists(select 1 from support_vnext_shadow.release_audit_events) then raise exception 'physical C4 rollback blocked: preserve final evidence' using errcode='55000'; end if;
end $$;
revoke all on function support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid),support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role,support_vnext_runtime;
drop function if exists support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid);
drop function if exists support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text);
drop table if exists support_vnext_shadow.inbound_messages;
commit;
