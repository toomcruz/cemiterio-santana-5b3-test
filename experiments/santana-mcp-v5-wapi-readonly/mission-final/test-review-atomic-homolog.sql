-- HOMOLOG ONLY. Synthetic transaction; all rows and trigger roll back.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
insert into public.homolog_mcp_send_intents
(id,owner_id,client_id,idempotency_key,payload,payload_sha256,state,expires_at)
values
('90000000-0000-4000-8000-000000000001','3ddaa108-6106-45ed-82c5-7c2dad05dc32','synthetic-db-qualification','90000000-0000-4000-8000-000000000001','{"synthetic":true,"text":"Synthetic transaction only; no delivery"}',repeat('a',64),'prepared',now()+interval '10 minutes'),
('90000000-0000-4000-8000-000000000002','3ddaa108-6106-45ed-82c5-7c2dad05dc32','synthetic-db-qualification','90000000-0000-4000-8000-000000000002','{"synthetic":true,"text":"Synthetic audit failure; no delivery"}',repeat('b',64),'prepared',now()+interval '10 minutes');
create function pg_temp.santana_mcp_synthetic_audit_failure() returns trigger language plpgsql as $$
begin
 if new.intent_id='90000000-0000-4000-8000-000000000002'::uuid then
  raise exception 'synthetic_audit_failure' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger santana_mcp_synthetic_audit_failure before insert on public.homolog_mcp_send_audit
for each row execute function pg_temp.santana_mcp_synthetic_audit_failure();
set local role service_role;
do $$
begin
 if public.sana_mcp_review_intent_atomic('3ddaa108-6106-45ed-82c5-7c2dad05dc32','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003',repeat('a',64)) is not true then raise exception 'service_review_failed';end if;
end;
$$;
reset role;
do $$
declare v_owner uuid:='3ddaa108-6106-45ed-82c5-7c2dad05dc32';
v_session uuid:='90000000-0000-4000-8000-000000000003';v_result boolean;
begin
 if (select count(*) from public.homolog_mcp_send_audit where intent_id='90000000-0000-4000-8000-000000000001')<>1 then raise exception 'audit_not_exactly_once';end if;
 if public.sana_mcp_review_intent_atomic(v_owner,'90000000-0000-4000-8000-000000000001',v_session,repeat('a',64)) then raise exception 'duplicate_review_allowed';end if;
 if public.sana_mcp_review_intent_atomic(v_owner,'90000000-0000-4000-8000-000000000002',v_session,repeat('c',64)) then raise exception 'wrong_digest_allowed';end if;
 begin
  perform public.sana_mcp_review_intent_atomic(v_owner,'90000000-0000-4000-8000-000000000002',v_session,repeat('b',64));
  raise exception 'audit_failure_not_propagated';
 exception when check_violation then null;
 end;
 if (select state from public.homolog_mcp_send_intents where id='90000000-0000-4000-8000-000000000002')<>'prepared' then raise exception 'unaudited_review_survived';end if;
 if (select count(*) from public.homolog_mcp_send_audit where intent_id='90000000-0000-4000-8000-000000000002')<>0 then raise exception 'failed_audit_survived';end if;
end;
$$;
reset role;
rollback;
select jsonb_build_object('status','PASS','environment','synthetic_homolog_transaction_rolled_back',
 'remaining_synthetic_intents',(select count(*) from public.homolog_mcp_send_intents where client_id='synthetic-db-qualification'),
 'temporary_trigger_remaining',exists(select 1 from pg_trigger where tgname='santana_mcp_synthetic_audit_failure'),
 'public_execution',has_function_privilege('anon','public.sana_mcp_review_intent_atomic(uuid,uuid,uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.sana_mcp_review_intent_atomic(uuid,uuid,uuid,text)','EXECUTE')) as verification;
