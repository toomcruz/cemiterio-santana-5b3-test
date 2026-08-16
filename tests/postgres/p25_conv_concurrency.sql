-- S02: concorrencia PostgreSQL REAL sobre conv_apply_transition.
-- Duas sessoes independentes, barreira deterministica, mesmo expected_seq:
-- exatamente uma transicao e aplicada; a outra e recusada com 55000 e nada
-- intermediario fica visivel. Dados artificiais; SHADOW_ONLY.
\set ON_ERROR_STOP on
\if :{?is_setup}
  begin;
  \ir _helpers.sql
  create schema if not exists support_vnext_test;
  create table if not exists support_vnext_test.p25_context(
    test_run_id uuid primary key, session_id uuid not null, case_id uuid not null,
    catalog_hash char(64) not null, created_at timestamptz not null default now());
  create table if not exists support_vnext_test.p25_barrier(
    test_run_id uuid not null, worker text not null check(worker in ('A','B')),
    arrived_at timestamptz not null default now(), primary key(test_run_id,worker));
  create table if not exists support_vnext_test.p25_outcome(
    test_run_id uuid not null, worker text not null, sqlstate text not null, seq bigint null,
    primary key(test_run_id,worker));
  create or replace function support_vnext_test.wait_p25_barrier(p_test_run_id uuid, p_timeout interval default interval '15 seconds')
  returns void language plpgsql as $$
  declare deadline timestamptz := clock_timestamp() + p_timeout;
  begin loop
    exit when (select count(*) from support_vnext_test.p25_barrier where test_run_id = p_test_run_id) = 2;
    if clock_timestamp() > deadline then raise exception 'P25 deterministic barrier timeout'; end if;
    perform pg_sleep(0.025);
  end loop; end $$;

  select pg_temp.publish_release('P25_SCOPE') as release_id \gset
  select extensions.gen_random_uuid() as test_run_id, extensions.gen_random_uuid() as session_id,
         extensions.gen_random_uuid() as conversation_id, extensions.gen_random_uuid() as case_id \gset
  insert into support_vnext_shadow.conversation_sessions(session_id, conversation_id, release_id, status, automation_mode)
  values (:'session_id'::uuid, :'conversation_id'::uuid, :'release_id'::uuid, 'ACTIVE', 'BOT_ACTIVE');
  insert into support_vnext_test.p25_context(test_run_id, session_id, case_id, catalog_hash)
  values (:'test_run_id'::uuid, :'session_id'::uuid, :'case_id'::uuid, repeat('f',64));
  commit;
\elif :{?is_worker}
  select test_run_id, session_id, case_id, catalog_hash
    from support_vnext_test.p25_context order by created_at desc limit 1 \gset
  insert into support_vnext_test.p25_barrier(test_run_id, worker)
  values (:'test_run_id'::uuid, :'worker') on conflict do nothing;
  select support_vnext_test.wait_p25_barrier(:'test_run_id'::uuid);
  select set_config('p25.worker', :'worker', false);
  -- Ambos partem do mesmo expected_seq=0 e propoem abrir o proprio case.
  do $$
  declare ctx record; w text := current_setting('p25.worker', true); v jsonb; st text := '00000'; sq bigint;
          case_uuid uuid; hash text;
  begin
    select * into ctx from support_vnext_test.p25_context order by created_at desc limit 1;
    case_uuid := case when w = 'A' then ctx.case_id else extensions.gen_random_uuid() end;
    -- hash canonico do estado resultante (uma unica linha de case, sem goals)
    hash := encode(extensions.digest(
      format('C|%s|DECEASED|%s|1|OPEN'||chr(10)||'Q|-'||chr(10), case_uuid, repeat('c',64)), 'sha256'), 'hex');
    begin
      v := support_vnext_shadow.conv_apply_transition(ctx.session_id, 0,
             jsonb_build_object('event_kind','NEW_GOAL','catalog_hash',ctx.catalog_hash,'state_hash',hash,
               'ops', jsonb_build_array(jsonb_build_object('op','open_case','case_id',case_uuid,
                 'subject_kind','DECEASED','subject_ref_hmac',repeat('c',64),'identity_key_version',1))),
             encode(extensions.digest('p25:'||w||':'||ctx.test_run_id::text,'sha256'),'hex'));
      sq := (v->>'seq')::bigint;
    exception when others then
      st := sqlstate;
    end;
    insert into support_vnext_test.p25_outcome(test_run_id, worker, sqlstate, seq)
    values (ctx.test_run_id, w, st, sq);
  end $$;
\elif :{?is_assert}
  begin;
  \ir _helpers.sql
  select pg_temp.assert_true(
    (select count(*) = 2 from support_vnext_test.p25_barrier b
       join support_vnext_test.p25_context c using(test_run_id)
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context)),
    'S02 ambos os workers cruzaram a barreira deterministica');
  select pg_temp.assert_true(
    (select count(*) = 1 from support_vnext_test.p25_outcome o
       join support_vnext_test.p25_context c using(test_run_id)
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context) and o.sqlstate = '00000'),
    'S02 exatamente uma transicao concorrente foi aplicada');
  select pg_temp.assert_true(
    (select count(*) = 1 from support_vnext_test.p25_outcome o
       join support_vnext_test.p25_context c using(test_run_id)
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context) and o.sqlstate = '55000'),
    'S02 a transicao perdedora foi recusada com 55000 (conversation state moved)');
  select pg_temp.assert_true(
    (select seq = 1 from support_vnext_shadow.conv_conversation_state s
       join support_vnext_test.p25_context c on c.session_id = s.session_id
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context)),
    'S02 o seq avancou exatamente uma vez');
  select pg_temp.assert_true(
    (select count(*) = 1 from support_vnext_shadow.conv_cases k
       join support_vnext_test.p25_context c on c.session_id = k.session_id
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context)),
    'S02 nenhum estado intermediario ficou visivel: um unico case gravado');
  select pg_temp.assert_true(
    (select count(*) = 1 from support_vnext_shadow.conv_events e
       join support_vnext_test.p25_context c on c.session_id = e.session_id
      where c.created_at = (select max(created_at) from support_vnext_test.p25_context)),
    'S02 um unico evento registrado');
  \echo 'PASS S02 conv_apply_transition sob concorrencia real'
  rollback;
\else
  \quit 3
\endif
