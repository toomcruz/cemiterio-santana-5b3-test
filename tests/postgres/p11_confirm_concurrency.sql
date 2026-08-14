\set ON_ERROR_STOP on
\if :{?is_setup}
  \ir _helpers.sql
  \ir fixtures/confirmation_flow_fixture.sql
  create table if not exists support_vnext_test.p11_runs(test_run_id uuid primary key,created_at timestamptz not null default now());
  create table if not exists support_vnext_test.p11_barrier(test_run_id uuid not null,worker text not null check(worker in ('A','B')),arrived_at timestamptz not null default now(),primary key(test_run_id,worker));
  create or replace function support_vnext_test.wait_p11_barrier(p_test_run_id uuid,p_timeout interval default interval '10 seconds') returns void language plpgsql as $$
  declare deadline timestamptz:=clock_timestamp()+p_timeout;
  begin
    loop
      exit when (select count(*) from support_vnext_test.p11_barrier where test_run_id=p_test_run_id)=2;
      if clock_timestamp()>deadline then raise exception 'P11 barrier timeout for %',p_test_run_id; end if;
      perform pg_sleep(0.02);
    end loop;
  end $$;
  select extensions.gen_random_uuid() as test_run_id \gset
  select support_vnext_test.create_confirmation_fixture(:'test_run_id'::uuid,false);
  select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid),'P11 setup contains no service_request');
  select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid and r.protocol is not null),'P11 setup contains no protocol');
  insert into support_vnext_test.p11_runs(test_run_id) values(:'test_run_id'::uuid);
\elif :{?is_worker}
  select test_run_id from support_vnext_test.p11_runs order by created_at desc limit 1 \gset
  select confirmation_id,confirmation_nonce,classification_id,inbound_message_id,authorization_id from support_vnext_test.confirmation_fixture_context where test_run_id=:'test_run_id'::uuid \gset
  insert into support_vnext_test.p11_barrier(test_run_id,worker) values(:'test_run_id'::uuid,:'worker');
  select support_vnext_test.wait_p11_barrier(:'test_run_id'::uuid);
  select support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P11-worker-'||:'worker');
\elif :{?is_assert}
  \ir _helpers.sql
  select test_run_id from support_vnext_test.p11_runs order by created_at desc limit 1 \gset
  select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid),'P11 exactly one service_request');
  select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid and r.protocol is not null),'P11 exactly one protocol');
  select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid and r.protocol is null),'P11 no request without protocol');
  select pg_temp.assert_true((select p.status='CONSUMED' and p.request_id=r.request_id and a.consumed_at is not null and a.consumed_by_request_id=r.request_id and c.status='CONSUMED' and c.consumed_at is not null and c.consumed_by_request_id=r.request_id from support_vnext_test.confirmation_fixture_context f join support_vnext_shadow.pending_confirmations p on p.confirmation_id=f.confirmation_id join support_vnext_shadow.confirmation_authorizations a on a.authorization_id=f.authorization_id join support_vnext_shadow.inbound_classifications c on c.classification_id=f.classification_id join support_vnext_shadow.service_requests r on r.request_id=p.request_id where f.test_run_id=:'test_run_id'::uuid),'P11 confirmation, authorization and classification consumed by the only request');
  select confirmation_id,confirmation_nonce,classification_id,inbound_message_id,authorization_id from support_vnext_test.confirmation_fixture_context where test_run_id=:'test_run_id'::uuid \gset
  select pg_temp.assert_true((support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'classification_id'::uuid,:'inbound_message_id'::uuid,'P11-idempotency')->>'outcome')='ALREADY_CONFIRMED','P11 repeat is idempotent');
  select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests r join support_vnext_test.confirmation_fixture_context f on f.confirmation_id=r.confirmation_id where f.test_run_id=:'test_run_id'::uuid),'P11 repeat created no duplicate');
  \echo 'PASS P11 real concurrent CONFIRM'
\else
  \quit 3
\endif
