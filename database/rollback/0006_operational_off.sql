begin;
-- Operational OFF: preserves schema, audit, releases and requests; blocks all vNext entry points.
revoke execute on all functions in schema support_vnext_shadow from service_role,support_vnext_runtime,support_vnext_publisher,support_vnext_auditor,support_vnext_admin;
revoke usage on schema support_vnext_shadow from service_role,support_vnext_runtime,support_vnext_publisher,support_vnext_auditor,support_vnext_admin;
commit;
