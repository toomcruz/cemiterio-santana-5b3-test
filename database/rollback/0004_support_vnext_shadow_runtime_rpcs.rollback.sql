-- Operational rollback only; preserves sessions, decisions, requests and audit records.
begin;
revoke execute on function support_vnext_shadow.resolve_shadow_session(uuid,text,uuid),support_vnext_shadow.get_runtime_decision_rules(uuid,text,text,text),support_vnext_shadow.store_shadow_decision(jsonb,uuid,uuid),support_vnext_shadow.append_shadow_audit_event(jsonb),support_vnext_shadow.record_shadow_comparison(jsonb),support_vnext_shadow.authorize_confirmation_inbound(uuid,uuid,uuid,uuid,uuid,uuid,char(64)),support_vnext_shadow.propose_request_transaction(uuid,text),support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,text) from service_role;
commit;
