begin;
-- Operational OFF: no DROP; retains release, audit, evidence and requests.
update support_vnext_shadow.feature_flags set default_mode='OFF',kill_switch=true,updated_at=now(),updated_by='5B.2-C4-OPERATIONAL-OFF';
revoke execute on function support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid),support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text) from service_role,support_vnext_runtime;
revoke execute on function support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,support_vnext_runtime;
commit;
