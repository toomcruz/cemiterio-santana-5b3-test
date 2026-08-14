-- Operational rollback: disable Edge Functions/flags first. Do NOT delete audit or request records.
-- Run only in isolated environment after a data-retention decision.
begin;
revoke execute on function support_vnext_shadow.refresh_draft_release_content_hash(uuid,text),support_vnext_shadow.get_renderer_decision_context(uuid),support_vnext_shadow.get_request_confirmation_status(uuid),support_vnext_shadow.decline_request_transaction_v2(uuid,uuid,text),support_vnext_shadow.resolve_shadow_feature(text,jsonb) from service_role;
-- Physical removal of guards/tables is intentionally not automated: published audit evidence may exist.
commit;
