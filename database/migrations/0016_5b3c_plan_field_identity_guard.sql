-- 5B.3-C: collected/proposal plan field values must never carry package-owned
-- identity or state-control keys. A DecisionPlan may collect conversational
-- data, but it may never rebind release/session/topic identity or overwrite
-- state-machine control fields through MERGE_COLLECTED_DATA or a request
-- proposal (P00 PLAN-10).
begin;

create or replace function support_vnext_shadow.valid_plan_field_values(p jsonb)
returns boolean language plpgsql immutable as $$
declare x record; a jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for x in select key,value from jsonb_each(p) loop
    if x.key !~ '^[a-z][a-z0-9_]{0,63}$'
       or x.key = any(array[
            'subject','category','category_code','sector','setor','severity',
            'gravidade','priority','external_route',
            'op','release_id','session_id','topic_id','conversation_id',
            'decision_id','correlation_id','request_id','confirmation_id',
            'confirmation_nonce','authorization_id','classification_id',
            'inbound_message_id','state_version','expected_state_version',
            'status','automation_mode','authority_key_id','authority_nonce',
            'authority_assertion_hash','content_hash','message_digest'
          ]) then return false; end if;
    if support_vnext_shadow.valid_scalar_value(x.value) then continue; end if;
    if jsonb_typeof(x.value) <> 'array' then return false; end if;
    for a in select value from jsonb_array_elements(x.value) loop
      if jsonb_typeof(a) <> 'string' or not coalesce(support_vnext_shadow.is_uuid_text(a #>> '{}'),false) then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

commit;
