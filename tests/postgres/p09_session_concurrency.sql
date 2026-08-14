\set ON_ERROR_STOP on
\if :{?is_setup}
  begin;
  \ir _helpers.sql
  create schema if not exists support_vnext_test;
  create table if not exists support_vnext_test.p09_concurrency_context(test_run_id uuid primary key,conversation_id uuid not null,scope_code text not null,release_id uuid not null,created_at timestamptz not null default now());
  create table if not exists support_vnext_test.p09_concurrency_barrier(test_run_id uuid not null,worker text not null check(worker in ('A','B')),arrived_at timestamptz not null default now(),primary key(test_run_id,worker));
  create or replace function support_vnext_test.wait_p09_barrier(p_test_run_id uuid,p_timeout interval default interval '15 seconds') returns void language plpgsql as $$
  declare deadline timestamptz:=clock_timestamp()+p_timeout;
  begin loop
    exit when (select count(*) from support_vnext_test.p09_concurrency_barrier where test_run_id=p_test_run_id)=2;
    if clock_timestamp()>deadline then raise exception 'P09 deterministic barrier timeout'; end if;
    perform pg_sleep(0.025);
  end loop; end $$;
  select pg_temp.publish_release('P09_SCOPE') as release_id \gset
  select gen_random_uuid() as test_run_id,gen_random_uuid() as conversation_id \gset
  insert into support_vnext_test.p09_concurrency_context(test_run_id,conversation_id,scope_code,release_id) values(:'test_run_id'::uuid,:'conversation_id'::uuid,'P09_SCOPE',:'release_id'::uuid);
  commit;
\elif :{?is_worker}
  select test_run_id,conversation_id,scope_code from support_vnext_test.p09_concurrency_context order by created_at desc limit 1 \gset
  insert into support_vnext_test.p09_concurrency_barrier(test_run_id,worker) values(:'test_run_id'::uuid,:'worker') on conflict do nothing;
  select support_vnext_test.wait_p09_barrier(:'test_run_id'::uuid);
  select support_vnext_shadow.resolve_shadow_session(:'conversation_id'::uuid,:'scope_code',extensions.gen_random_uuid());
\elif :{?is_assert}
  begin;
  \ir _helpers.sql
  select pg_temp.assert_true((select count(*)=2 from support_vnext_test.p09_concurrency_barrier b join support_vnext_test.p09_concurrency_context c using(test_run_id) where c.created_at=(select max(created_at) from support_vnext_test.p09_concurrency_context)),'P09 both workers crossed deterministic barrier');
  select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.conversation_sessions s join support_vnext_test.p09_concurrency_context c on c.conversation_id=s.conversation_id where c.created_at=(select max(created_at) from support_vnext_test.p09_concurrency_context) and s.status<>'CLOSED'),'P09 concurrent resolver leaves exactly one active session');
  select pg_temp.assert_true((select count(distinct s.release_id)=1 from support_vnext_shadow.conversation_sessions s join support_vnext_test.p09_concurrency_context c on c.conversation_id=s.conversation_id where c.created_at=(select max(created_at) from support_vnext_test.p09_concurrency_context) and s.status<>'CLOSED'),'P09 session pinning has no lost update');
  \echo 'PASS P09 deterministic barrier and session resolver concurrency'
  rollback;
\else
  \quit 3
\endif
