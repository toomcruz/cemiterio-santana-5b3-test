begin;
-- Deliberately fail closed if audit or operational evidence exists.
do $$ begin
 if exists(select 1 from support_vnext_shadow.support_ruleset_release where status in ('PUBLISHED','SUPERSEDED','REVOKED'))
    or exists(select 1 from support_vnext_shadow.service_requests)
    or exists(select 1 from support_vnext_shadow.release_audit_events) then
   raise exception 'physical rollback blocked: retain audit/release/request evidence first' using errcode='55000';
 end if;
end $$;
-- Only for an empty, disposable isolated database after the guard above.
drop function if exists support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid);
drop function if exists support_vnext_shadow.persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid);
drop function if exists support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,text,text,text);
drop function if exists support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text);
drop function if exists support_vnext_shadow.run_due_inactivity_jobs_v2(text,integer);
drop function if exists support_vnext_shadow.schedule_inactivity_transaction_v2(uuid);
drop function if exists support_vnext_shadow.valid_decision_plan(jsonb);
drop function if exists support_vnext_shadow.closed_object(jsonb,text[]);
drop table if exists support_vnext_shadow.inactivity_outbox;
drop table if exists support_vnext_shadow.inbound_classifications;
-- 0001–0006 physical rollback remains a separately reviewed retention decision.
commit;
