\set ON_ERROR_STOP on
-- Prepared for 5B.3 only. Do not include from run_all.sh: run in a new connection
-- after the selected rollback script.
\if :{?rollback_phase}
\else
  \echo 'set rollback_phase=PRE or rollback_phase=POST'
  \quit
\endif

select set_config('support_vnext_test.rollback_phase', :'rollback_phase', false);

do $$
declare phase text := current_setting('support_vnext_test.rollback_phase', true);
begin
  if phase = 'PRE' then
    if to_regnamespace('support_vnext_shadow') is null
       or to_regprocedure('support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)') is null
       or to_regprocedure('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text)') is null
       or to_regclass('support_vnext_shadow.classifier_authorities') is null
       or to_regprocedure('support_vnext_shadow.valid_decision_plan(jsonb)') is null
       or to_regprocedure('support_vnext_shadow.valid_fact_refs(jsonb)') is null
       or not exists (select 1 from pg_constraint where conrelid='support_vnext_shadow.inbound_classifications'::regclass and conname='inbound_classifications_code_status_confirmation_ck')
       or to_regprocedure('support_vnext_shadow.publish_ruleset_release(uuid,text)') is null then
      raise exception 'PRE-ROLLBACK critical surface missing' using errcode = 'P0001';
    end if;
  elsif phase = 'POST_OPERATIONAL' then
    if to_regnamespace('support_vnext_shadow') is null
       or to_regprocedure('support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)') is null
       or exists (
         select 1
         from support_vnext_shadow.feature_flags
         where kill_switch is not true or default_mode <> 'OFF'
       )
       or has_function_privilege('service_role', 'support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)', 'EXECUTE') then
      raise exception 'POST_OPERATIONAL vNext surface was not disabled' using errcode = 'P0001';
    end if;
  elsif phase = 'POST' then
    if to_regnamespace('support_vnext_shadow') is not null
       or to_regprocedure('support_vnext_shadow.confirm_request_transaction(uuid,uuid,uuid,uuid,text)') is not null
       or to_regprocedure('support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text)') is not null
       or to_regprocedure('support_vnext_shadow.valid_decision_plan(jsonb)') is not null
       or to_regprocedure('support_vnext_shadow.valid_fact_refs(jsonb)') is not null
       or to_regprocedure('support_vnext_shadow.publish_ruleset_release(uuid,text)') is not null then
      raise exception 'POST-ROLLBACK package surface remains executable' using errcode = 'P0001';
    end if;
  else
    raise exception 'rollback_phase must be PRE, POST_OPERATIONAL or POST' using errcode = '22023';
  end if;
end $$;
