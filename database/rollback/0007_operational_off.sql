begin;
-- Operational rollback: preserves releases, requests, audits and evidence.
update support_vnext_shadow.feature_flags set default_mode='OFF', kill_switch=true, updated_at=now(), updated_by='5B.2-C3-OPERATIONAL-OFF';
revoke execute on all functions in schema support_vnext_shadow from service_role,support_vnext_runtime,support_vnext_publisher,support_vnext_auditor,support_vnext_admin;
revoke usage on schema support_vnext_shadow from service_role,support_vnext_runtime,support_vnext_publisher,support_vnext_auditor,support_vnext_admin;
commit;
