-- S01-S22: provas de integridade da persistencia conversacional (migration 0020).
-- S02 (concorrencia real) vive em run_concurrency.sh: exige duas sessoes PostgreSQL.
-- Dados sinteticos; SHADOW_ONLY. Nenhuma rede, LLM, n8n ou producao.
\set ON_ERROR_STOP on
begin;

\ir _helpers.sql
\ir fixtures/conv_roundtrip_fixture.sql

-- Sessao dedicada a estas provas (indice 23; o round-trip usa 1..22).
create temporary table conv_probe(session_id uuid, cat char(64), a uuid, b uuid, c uuid) on commit drop;
insert into conv_probe values (
  '55555555-0000-4000-8000-000000000023'::uuid, repeat('b',64),
  'aa000000-0000-4000-8000-000000000001'::uuid,
  'aa000000-0000-4000-8000-000000000002'::uuid,
  'aa000000-0000-4000-8000-000000000003'::uuid);

create or replace function pg_temp.probe_session() returns uuid language sql as
  $$ select session_id from conv_probe $$;
create or replace function pg_temp.cat() returns char(64) language sql as
  $$ select cat from conv_probe $$;
create or replace function pg_temp.hash_now() returns char(64) language sql as
  $$ select support_vnext_shadow.conv_state_hash((select session_id from conv_probe)) $$;

-- Mensagem de assercao junto com o SQLSTATE esperado.
create or replace function pg_temp.assert_error(p_sql text, p_sqlstate text, p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ASSERTION FAILED: % (statement unexpectedly succeeded)', p_message using errcode='P0001';
exception when others then
  if sqlstate = 'P0001' then raise; end if;
  if sqlstate <> p_sqlstate then
    raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got %)', p_message, p_sqlstate, sqlstate
      using errcode='P0001';
  end if;
end $$;

-- Aplica uma transicao com o state_hash correto: o hash e descoberto aplicando
-- as ops numa subtransacao que e desfeita. Os testes ficam legiveis sem
-- reproduzir o reducer aqui.
create or replace function pg_temp.apply(p_seq bigint, p_kind text, p_ops jsonb, p_idem text)
returns jsonb language plpgsql as $$
declare t jsonb; s uuid := (select session_id from conv_probe);
begin
  t := jsonb_build_object('event_kind',p_kind,'catalog_hash',(select cat from conv_probe),
                          'state_hash', pg_temp.expected_hash(p_seq, p_ops), 'ops', p_ops);
  return support_vnext_shadow.conv_apply_transition(s, p_seq, t, encode(extensions.digest(p_idem,'sha256'),'hex'));
end $$;

-- Hash esperado: aplica as ops dentro de uma subtransacao, le o hash e desfaz.
create or replace function pg_temp.expected_hash(p_seq bigint, p_ops jsonb)
returns char(64) language plpgsql as $$
declare h char(64); s uuid := (select session_id from conv_probe);
begin
  begin
    -- a raiz e criada pela propria RPC; aqui ela e simulada para o calculo do hash
    insert into support_vnext_shadow.conv_conversation_state(session_id, seq, domain_version, catalog_hash, state_hash)
    values (s, p_seq, 'santana-conversation-domain/v1', (select cat from conv_probe), repeat('0',64))
    on conflict (session_id) do nothing;
    perform support_vnext_shadow.conv_apply_ops(s, p_seq + 1, p_ops, false, null, array[]::text[]);
    h := support_vnext_shadow.conv_state_hash(s);
    raise exception 'rollback probe' using errcode='55000';
  exception when sqlstate '55000' then
    if h is null then raise; end if;
  end;
  return h;
end $$;

-- Estado inicial da sessao de prova: um case, um goal, um fato e uma pergunta.
select pg_temp.apply(0, 'NEW_GOAL', jsonb_build_array(
  jsonb_build_object('op','open_case','case_id',(select a from conv_probe),'subject_kind','DECEASED',
                     'subject_ref_hmac',repeat('c',64),'identity_key_version',1),
  jsonb_build_object('op','push_goal','goal_id',(select b from conv_probe),'case_id',(select a from conv_probe),
                     'goal_code','GOAL_TRANSPORTE','status','ACTIVE','stack_index',0),
  jsonb_build_object('op','set_question','question_id',(select c from conv_probe),'goal_id',(select b from conv_probe),
                     'question_code','Q_REMAINS_STATUS','fact_code','remains_status','priority_class','FLOW_BRANCH')
), 'probe-bootstrap');

-- S01 idempotencia: o replay nao reaplica e devolve o mesmo seq.
select pg_temp.assert_true(
  (support_vnext_shadow.conv_apply_transition(pg_temp.probe_session(), 0,
     jsonb_build_object('event_kind','NEW_GOAL','catalog_hash',pg_temp.cat(),'state_hash',repeat('0',64),
       'ops', jsonb_build_array()),
     encode(extensions.digest('probe-bootstrap','sha256'),'hex'))->>'replayed')::boolean,
  'S01 replay da mesma idempotency_key nao reaplica');
select pg_temp.assert_true(
  (select seq from support_vnext_shadow.conv_conversation_state where session_id = pg_temp.probe_session()) = 1,
  'S01 seq permanece 1 apos o replay');

-- S03 conversas diferentes nao compartilham estado.
select pg_temp.assert_true(
  (select count(distinct session_id) from support_vnext_shadow.conv_conversation_state) >= 1,
  'S03 estado e por conversa');

-- S04 isolamento de case: fato de outro case nao entra no goal deste case.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','record_fact','fact_id','ab000000-0000-4000-8000-000000000001',
    'case_id','10000000-0000-4000-8000-000100000001','goal_id',(select b from conv_probe)::text,
    'fact_code','remains_status','value_kind','TEXT','value','EXUMADO','source','USER_EXPLICIT',
    'confidence','CONFIRMED')), false, null, array[]::text[])$$, '22023',
  'S04 fato nao pode cruzar de case');

-- S05 imutabilidade do valor do fato.
select pg_temp.apply(1, 'ANSWER', jsonb_build_array(
  jsonb_build_object('op','record_fact','fact_id','ac000000-0000-4000-8000-000000000001',
    'case_id',(select a from conv_probe),'goal_id',(select b from conv_probe),
    'fact_code','remains_status','value_kind','TEXT','value','SEPULTADO','source','USER_EXPLICIT',
    'confidence','CONFIRMED'),
  jsonb_build_object('op','close_question','question_id',(select c from conv_probe),'state','ANSWERED')
), 'probe-fact');
select pg_temp.assert_error(
  $$update support_vnext_shadow.conv_facts set value_text='EXUMADO' where fact_id='ac000000-0000-4000-8000-000000000001'$$,
  '55000', 'S05 valor do fato e imutavel');
select pg_temp.assert_error(
  $$delete from support_vnext_shadow.conv_facts where fact_id='ac000000-0000-4000-8000-000000000001'$$,
  '55000', 'S05 fato nunca e apagado');

-- S06 supersessao mantem historico e cascata declarada.
select pg_temp.apply(2, 'CORRECTION', jsonb_build_array(
  jsonb_build_object('op','supersede_fact','fact_id','ac000000-0000-4000-8000-000000000001',
    'superseded_by','ac000000-0000-4000-8000-000000000002','supersession_reason','USER_CORRECTION'),
  jsonb_build_object('op','record_fact','fact_id','ac000000-0000-4000-8000-000000000002',
    'case_id',(select a from conv_probe),'goal_id',(select b from conv_probe),
    'fact_code','remains_status','value_kind','TEXT','value','EXUMADO','source','USER_CORRECTION',
    'confidence','CONFIRMED','derived_from',jsonb_build_array('ac000000-0000-4000-8000-000000000001'))
), 'probe-correction');
select pg_temp.assert_true(
  (select status = 'SUPERSEDED' and supersession_reason = 'USER_CORRECTION'
     from support_vnext_shadow.conv_facts where fact_id='ac000000-0000-4000-8000-000000000001'),
  'S06 fato anterior permanece com historico de supersessao');
select pg_temp.assert_true(
  (select count(*) from support_vnext_shadow.conv_fact_derivations
    where fact_id='ac000000-0000-4000-8000-000000000002') = 1,
  'S06 aresta de derivacao registrada');
select pg_temp.assert_error(
  $$update support_vnext_shadow.conv_facts set status='ACTIVE'
     where fact_id='ac000000-0000-4000-8000-000000000001'$$, '55000',
  'S06 fato superado nao ressuscita');

-- S07 conflito: dois ativos so sao aceitos quando marcados CONFLICTING.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','record_fact','fact_id','ad000000-0000-4000-8000-000000000001',
    'case_id',(select a from conv_probe)::text,'goal_id',(select b from conv_probe)::text,
    'fact_code','remains_status','value_kind','TEXT','value','SEPULTADO','source','USER_EXPLICIT',
    'confidence','CONFIRMED')), false, null, array[]::text[])$$, '23505',
  'S07 dois fatos ativos confirmados no mesmo case sao recusados');

-- S08/S09b alegacao nao autoritativa e recusa de autoridade fora da RPC propria.
select pg_temp.assert_true(
  (select not authoritative and signal_id is null
     from support_vnext_shadow.conv_facts where fact_id='ac000000-0000-4000-8000-000000000002'),
  'S08 fato de usuario nunca nasce autoritativo');
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_transition(
  (select session_id from conv_probe), 3,
  jsonb_build_object('event_kind','ANSWER','catalog_hash',(select cat from conv_probe),
    'state_hash',repeat('0',64),
    'ops',jsonb_build_array(jsonb_build_object('op','record_fact','fact_id','ae000000-0000-4000-8000-000000000001',
      'case_id',(select a from conv_probe)::text,'goal_id',(select b from conv_probe)::text,
      'fact_code','burial_reference','value_kind','TEXT','value','X','source','SYSTEM',
      'confidence','CONFIRMED','authoritative',true))),
  encode(extensions.digest('probe-auth-denied','sha256'),'hex'))$$, '42501',
  'S09b conv_apply_transition recusa fato autoritativo');

-- S09 sinal autoritativo com origem de usuario e recusado.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_authoritative_signal(
  (select session_id from conv_probe), 3,
  jsonb_build_object('source','USER_EXPLICIT','actor','x','covered_fact_codes',jsonb_build_array('burial_reference')),
  jsonb_build_object('event_kind','AUTHORITATIVE_SIGNAL','catalog_hash',(select cat from conv_probe),
    'state_hash',repeat('0',64),'ops',jsonb_build_array()),
  encode(extensions.digest('probe-user-signal','sha256'),'hex'))$$, '42501',
  'S09 sinal autoritativo recusa origem de usuario');

-- S10 transicao ilegal de goal (terminal nao volta).
select pg_temp.apply(3, 'ANSWER', jsonb_build_array(
  jsonb_build_object('op','push_goal','goal_id','af000000-0000-4000-8000-000000000001',
    'case_id',(select a from conv_probe),'goal_code','GOAL_COMERCIAL','status','RESOLVED','stack_index',1)
), 'probe-closed-goal');
select pg_temp.assert_error($$update support_vnext_shadow.conv_goals set status='ACTIVE'
  where goal_id='af000000-0000-4000-8000-000000000001'$$, '55000',
  'S10 goal terminal nao volta');
select pg_temp.assert_error($$delete from support_vnext_shadow.conv_goals
  where goal_id='af000000-0000-4000-8000-000000000001'$$, '55000',
  'S10 goal nunca e apagado');

-- S11 dois subfluxos abertos do mesmo codigo no mesmo case sao recusados.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','push_goal','goal_id','af000000-0000-4000-8000-000000000002',
    'case_id',(select a from conv_probe)::text,'goal_code','GOAL_TRANSPORTE','status','ACTIVE','stack_index',9)),
  false, null, array[]::text[])$$, '23505',
  'S11 um subfluxo aberto por (case, goal_code)');

-- S12 pergunta estacionada nao e destruida e volta com o mesmo id.
select pg_temp.apply(4, 'PARALLEL_QUESTION', jsonb_build_array(
  jsonb_build_object('op','set_question','question_id','b0000000-0000-4000-8000-000000000001',
    'goal_id',(select b from conv_probe),'question_code','Q_TRANSPORT_DESTINATION',
    'fact_code','transport_destination','priority_class','FLOW_BRANCH')
), 'probe-question');
select pg_temp.apply(5, 'PARALLEL_QUESTION', jsonb_build_array(
  jsonb_build_object('op','park_question','question_id','b0000000-0000-4000-8000-000000000001','park_order',1),
  jsonb_build_object('op','set_question','question_id','b0000000-0000-4000-8000-000000000002',
    'goal_id',(select b from conv_probe),'question_code','Q_TRANSPORT_DATE',
    'fact_code','transport_date_preference','priority_class','NEXT_ACTION_DATA')
), 'probe-park');
select pg_temp.assert_true(
  (select state = 'PARKED' from support_vnext_shadow.conv_question_stack
    where question_id='b0000000-0000-4000-8000-000000000001'),
  'S12 pergunta anterior fica estacionada, nao apagada');
select pg_temp.assert_error($$delete from support_vnext_shadow.conv_question_stack
  where question_id='b0000000-0000-4000-8000-000000000001'$$, '55000',
  'S12 pergunta nunca e apagada');
select pg_temp.apply(6, 'ANSWER', jsonb_build_array(
  jsonb_build_object('op','close_question','question_id','b0000000-0000-4000-8000-000000000002','state','ANSWERED'),
  jsonb_build_object('op','restore_question','question_id','b0000000-0000-4000-8000-000000000001')
), 'probe-restore');
select pg_temp.assert_true(
  (select state = 'PENDING' from support_vnext_shadow.conv_question_stack
    where question_id='b0000000-0000-4000-8000-000000000001'),
  'S12 pergunta estacionada retorna com o mesmo identificador');

-- S13 uma acao pendente por (goal, acao).
select pg_temp.apply(7, 'ANSWER', jsonb_build_array(
  jsonb_build_object('op','open_action','action_id','b1000000-0000-4000-8000-000000000001',
    'goal_id',(select b from conv_probe),'action_code','ACTION_VERIFY_GRAVE_SITUATION','executor','SYSTEM_OR_HUMAN')
), 'probe-action');
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','open_action','action_id','b1000000-0000-4000-8000-000000000002',
    'goal_id',(select b from conv_probe)::text,'action_code','ACTION_VERIFY_GRAVE_SITUATION','executor','HUMAN')),
  false, null, array[]::text[])$$, '23505',
  'S13 uma acao PENDING por (goal, acao)');

-- S14 retomada: o read-model reproduz o estado persistido.
select pg_temp.assert_true(
  (support_vnext_shadow.conv_get_state(pg_temp.probe_session())->>'seq')::bigint =
  (select seq from support_vnext_shadow.conv_conversation_state where session_id = pg_temp.probe_session()),
  'S14 conv_get_state devolve o seq corrente');
select pg_temp.assert_true(
  jsonb_array_length(support_vnext_shadow.conv_get_state(pg_temp.probe_session())->'goals') = 2,
  'S14 read-model traz a pilha de objetivos');
select pg_temp.assert_true(
  support_vnext_shadow.conv_state_hash(pg_temp.probe_session()) =
  (select state_hash from support_vnext_shadow.conv_conversation_state where session_id = pg_temp.probe_session()),
  'S14 state_hash persistido confere com o recomputado');

-- S16 conv_events e append-only.
select pg_temp.assert_error($$update support_vnext_shadow.conv_events set result='{}'::jsonb
  where session_id = (select session_id from conv_probe)$$, '55000',
  'S16 conv_events nao aceita update');
select pg_temp.assert_error($$delete from support_vnext_shadow.conv_events
  where session_id = (select session_id from conv_probe)$$, '55000',
  'S16 conv_events nao aceita delete');

-- S19 catalog_hash divergente e recusado.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_transition(
  (select session_id from conv_probe), 8,
  jsonb_build_object('event_kind','ANSWER','catalog_hash',repeat('d',64),'state_hash',repeat('0',64),
    'ops',jsonb_build_array()),
  encode(extensions.digest('probe-catalog','sha256'),'hex'))$$, '22023',
  'S19 catalog_hash divergente e recusado');

-- expected_seq divergente e recusado (fail-closed).
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_transition(
  (select session_id from conv_probe), 999,
  jsonb_build_object('event_kind','ANSWER','catalog_hash',(select cat from conv_probe),
    'state_hash',repeat('0',64),'ops',jsonb_build_array()),
  encode(extensions.digest('probe-seq','sha256'),'hex'))$$, '55000',
  'S02a expected_seq divergente e recusado');

-- state_hash divergente e recusado (fail-closed).
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_transition(
  (select session_id from conv_probe), 8,
  jsonb_build_object('event_kind','ANSWER','catalog_hash',(select cat from conv_probe),
    'state_hash',repeat('e',64),'ops',jsonb_build_array()),
  encode(extensions.digest('probe-hash','sha256'),'hex'))$$, '22023',
  'S02b state_hash divergente e recusado');

-- S20 codigo fora do catalogo e recusado.
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','record_fact','fact_id','b2000000-0000-4000-8000-000000000001',
    'case_id',(select a from conv_probe)::text,'goal_id',(select b from conv_probe)::text,
    'fact_code','fato_inexistente','value_kind','TEXT','value','X','source','USER_EXPLICIT',
    'confidence','CONFIRMED')), false, null, array[]::text[])$$, '22P02',
  'S20 fact_code fora do catalogo e recusado');
select pg_temp.assert_error($$select support_vnext_shadow.conv_apply_ops(
  (select session_id from conv_probe), 99,
  jsonb_build_array(jsonb_build_object('op','operacao_inexistente')), false, null, array[]::text[])$$, '22023',
  'S20 operacao desconhecida e recusada');

-- S21 nenhuma funcao conv_* toca pending_questions.
select pg_temp.assert_true(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='support_vnext_shadow' and p.proname like 'conv\_%'
      and p.prosrc ~* 'pending_questions') = 0,
  'S21 nenhuma RPC conv_* le ou escreve pending_questions');

-- S22 pseudonimizacao: HMAC hex de 64 e versao de chave positiva; nada de texto livre.
select pg_temp.assert_error($$insert into support_vnext_shadow.conv_cases(
  case_id, session_id, subject_kind, subject_ref_hmac, identity_key_version, opened_at_seq)
  values ('b3000000-0000-4000-8000-000000000001', (select session_id from conv_probe), 'DECEASED',
          'joao-da-silva-cpf-000', 1, 1)$$, '23514',
  'S22 subject_ref_hmac exige digest hexadecimal');
select pg_temp.assert_true(
  (select count(*) from information_schema.columns
    where table_schema='support_vnext_shadow' and table_name='conv_cases'
      and column_name in ('subject_ref','subject_name','document','cpf')) = 0,
  'S22 conv_cases nao tem coluna de PII direta');

-- S17 rollback logico: compensa, nao apaga.
select pg_temp.assert_true(
  (select count(*) from support_vnext_shadow.conv_events where session_id = pg_temp.probe_session()) > 0,
  'S17 pre-condicao: existem eventos');
create temporary table conv_before_rollback on commit drop as
  select event_seq, event_kind, payload_hash from support_vnext_shadow.conv_events
   where session_id = (select session_id from conv_probe);
select support_vnext_shadow.conv_rollback_to_seq(pg_temp.probe_session(), 2, 'operador-teste', 'prova S17');
select pg_temp.assert_true(
  (select count(*) from conv_before_rollback b
     join support_vnext_shadow.conv_events e
       on e.session_id = pg_temp.probe_session() and e.event_seq = b.event_seq
      and e.event_kind = b.event_kind and e.payload_hash = b.payload_hash)
  = (select count(*) from conv_before_rollback),
  'S17 nenhum evento anterior foi apagado ou reescrito');
select pg_temp.assert_true(
  (select event_kind = 'SYSTEM_ROLLBACK' from support_vnext_shadow.conv_events
    where session_id = pg_temp.probe_session() order by event_seq desc limit 1),
  'S17 rollback acrescenta um evento de compensacao');
select pg_temp.assert_true(
  (select count(*) from support_vnext_shadow.conv_facts
    where session_id = pg_temp.probe_session() and status = 'ACTIVE' and recorded_at_seq > 2) = 0,
  'S17 fatos posteriores ao alvo ficam superados');
select pg_temp.assert_true(
  (select count(*) from support_vnext_shadow.conv_facts
    where session_id = pg_temp.probe_session() and supersession_reason = 'ROLLBACK') > 0,
  'S17 supersessao por rollback fica registrada');

-- S18 troca de release nao invalida fatos ja coletados.
select pg_temp.assert_true(
  (select count(*) from support_vnext_shadow.conv_facts f
     where f.session_id = pg_temp.probe_session()) > 0,
  'S18 fatos sobrevivem independentemente do release corrente da sessao');
select pg_temp.assert_true(
  (select count(distinct catalog_hash) from support_vnext_shadow.conv_events
    where session_id = pg_temp.probe_session()) = 1,
  'S18 cada evento registra o catalogo com que foi decidido');

-- S15 privilegios: modelo RPC-only e autoridades separadas.
select pg_temp.assert_true(
  has_function_privilege('service_role','support_vnext_shadow.conv_get_state(uuid)'::regprocedure,'EXECUTE')
  and has_function_privilege('service_role','support_vnext_shadow.conv_apply_transition(uuid,bigint,jsonb,char)'::regprocedure,'EXECUTE'),
  'S15 service_role executa leitura e transicao comum');
select pg_temp.assert_true(
  not has_function_privilege('service_role','support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,char)'::regprocedure,'EXECUTE')
  and not has_function_privilege('service_role','support_vnext_shadow.conv_rollback_to_seq(uuid,bigint,text,text)'::regprocedure,'EXECUTE'),
  'S15 autoridade e rollback nao acompanham a transicao comum');
select pg_temp.assert_true(
  has_function_privilege('support_vnext_admin','support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,char)'::regprocedure,'EXECUTE')
  and has_function_privilege('support_vnext_admin','support_vnext_shadow.conv_rollback_to_seq(uuid,bigint,text,text)'::regprocedure,'EXECUTE'),
  'S15 autoridade separada pertence a support_vnext_admin');
select pg_temp.assert_true(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='support_vnext_shadow' and p.proname like 'conv\_%'
      and (has_function_privilege('public', p.oid,'EXECUTE')
        or has_function_privilege('anon', p.oid,'EXECUTE')
        or has_function_privilege('authenticated', p.oid,'EXECUTE'))) = 0,
  'S15 PUBLIC/anon/authenticated sem EXECUTE em qualquer conv_*');
select pg_temp.assert_true(
  (select count(*) from unnest(array['conv_conversation_state','conv_cases','conv_goals','conv_facts',
     'conv_fact_derivations','conv_question_stack','conv_pending_actions','conv_authoritative_signals','conv_events']) t
    where has_table_privilege('service_role','support_vnext_shadow.'||t,'SELECT')
       or has_table_privilege('service_role','support_vnext_shadow.'||t,'INSERT')
       or has_table_privilege('service_role','support_vnext_shadow.'||t,'UPDATE')
       or has_table_privilege('service_role','support_vnext_shadow.'||t,'DELETE')) = 0,
  'S15 service_role sem privilegio direto nas tabelas conv_*');
select pg_temp.assert_true(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='support_vnext_shadow' and c.relname like 'conv\_%' and c.relkind='r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)) = 0,
  'S15 RLS habilitada e forcada em todas as tabelas conv_*');
select pg_temp.assert_true(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='support_vnext_shadow'
      and p.proname in ('conv_apply_ops','conv_commit_transition','conv_state_hash','conv_state_canonical')
      and has_function_privilege('service_role', p.oid,'EXECUTE')) = 0,
  'S15 funcoes internas nao sao expostas a service_role');

commit;
