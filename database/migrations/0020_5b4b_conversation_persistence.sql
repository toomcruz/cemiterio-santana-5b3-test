-- 5B.4-B.2: persistencia conversacional aditiva (Santana Conversation Domain v1).
-- Forward-only. Nao altera nenhum objeto criado por 0001-0019: as unicas referencias
-- as tabelas existentes sao chaves estrangeiras SAINDO das tabelas novas.
--
-- Fronteira aprovada na 5B.4-B.1:
--   * o reducer semantico vive exclusivamente no TypeScript
--     (santana-conversation-domain/engine); este arquivo NAO reimplementa
--     next-best-question, relacoes, cascatas nem prioridades;
--   * o banco e autoridade de integridade: ordem, idempotencia, constraints,
--     isolamento de case, imutabilidade, supersessao, autoridade de sinal,
--     privilegios, append-only e validacao ESTRUTURAL da transicao proposta;
--   * conv_apply_transition JAMAIS grava authoritative=true; so
--     conv_apply_authoritative_signal, com grant proprio, persiste autoridade;
--   * nenhuma funcao aqui le ou escreve support_vnext_shadow.pending_questions.
begin;

-- ---------------------------------------------------------------------------
-- 1. Dominios do catalogo v1 (I17: codigo fora do catalogo e recusado)
-- ---------------------------------------------------------------------------
create type support_vnext_shadow.conv_goal_code as enum (
  'GOAL_TRANSPORTE','GOAL_EXUMACAO','GOAL_RECADASTRO','GOAL_CONCESSAO','GOAL_COMERCIAL',
  'GOAL_RECLAMACAO','GOAL_INFO_OSSUARIO','GOAL_INFO_HORARIO','GOAL_OUTROS_ASSUNTOS');

create type support_vnext_shadow.conv_fact_code as enum (
  'remains_status','transport_destination','destination_grave_reference','destination_grave_situation',
  'destination_grave_authorization','transport_date_preference','exhumation_purpose','surviving_spouse_status',
  'required_authorization_signatory','exhumation_authorization','burial_reference','recadastro_status',
  'recadastro_holder_document','concession_reference','concession_purpose','commercial_item','commercial_stage',
  'commercial_delivery_status','complaint_description','ossuary_information_request','service_hours_request',
  'other_subject_description','requester_document','exumacao_required','recadastro_required',
  'recadastro_verification_required');

create type support_vnext_shadow.conv_question_code as enum (
  'Q_SURVIVING_SPOUSE','Q_REMAINS_STATUS','Q_TRANSPORT_DESTINATION','Q_DESTINATION_GRAVE_REFERENCE',
  'Q_TRANSPORT_DATE','Q_EXHUMATION_PURPOSE','Q_BURIAL_REFERENCE','Q_RECADASTRO_STATUS','Q_CONCESSION_REFERENCE',
  'Q_RECADASTRO_HOLDER_DOCUMENT','Q_CONCESSION_PURPOSE','Q_COMMERCIAL_ITEM','Q_COMMERCIAL_STAGE',
  'Q_COMMERCIAL_DELIVERY','Q_COMPLAINT_DESCRIPTION','Q_OSSUARY_INFO','Q_SERVICE_HOURS','Q_OTHER_SUBJECT',
  'Q_REQUESTER_DOCUMENT','Q_CONFLICT_CONFIRM');

create type support_vnext_shadow.conv_action_code as enum (
  'ACTION_VERIFY_GRAVE_SITUATION','ACTION_COLLECT_GRAVE_AUTHORIZATION',
  'ACTION_COLLECT_EXHUMATION_AUTHORIZATION','ACTION_VERIFY_RECADASTRO');

create type support_vnext_shadow.conv_goal_status as enum
  ('ACTIVE','SUSPENDED','WAITING','RESOLVED','ABANDONED');
create type support_vnext_shadow.conv_fact_source as enum
  ('USER_EXPLICIT','USER_CORRECTION','DOCUMENT','SYSTEM','DERIVED_RULE');
create type support_vnext_shadow.conv_confidence as enum ('CONFIRMED','UNCERTAIN','CONFLICTING');
create type support_vnext_shadow.conv_event_kind as enum (
  'ANSWER','CORRECTION','COMPLEMENT','PARALLEL_QUESTION','CHANGE_OF_MIND','NEW_GOAL','COMPLAINT',
  'HUMAN_REQUEST','SOCIAL','UNCERTAIN','AUTHORITATIVE_SIGNAL','SYSTEM_ROLLBACK');

-- ---------------------------------------------------------------------------
-- 2. Tabelas (9)
-- ---------------------------------------------------------------------------

-- 2.1 raiz: 1:1 com a sessao, ponto unico de serializacao e de seq logico.
create table support_vnext_shadow.conv_conversation_state (
  session_id uuid primary key references support_vnext_shadow.conversation_sessions(session_id) on delete restrict,
  seq bigint not null default 0 check (seq >= 0),
  domain_version text not null check (domain_version = 'santana-conversation-domain/v1'),
  catalog_hash char(64) not null check (catalog_hash ~ '^[A-Fa-f0-9]{64}$'),
  state_hash char(64) not null check (state_hash ~ '^[A-Fa-f0-9]{64}$'),
  -- Metadados de retencao (5B.4-B.1 decisao 2): nenhum job, trigger ou expurgo
  -- automatico e criado por esta migration.
  closed_at timestamptz null,
  retention_class text null,
  purge_after timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.2 sujeito do atendimento, pseudonimizado (decisao 3): nenhuma PII direta.
create table support_vnext_shadow.conv_cases (
  case_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  subject_kind text not null check (subject_kind in ('DECEASED','GRAVE','CONCESSION','ORDER','HOLDER','GENERIC')),
  -- HMAC-SHA-256 calculado FORA do banco, com segredo dedicado a identidade e
  -- versionado; o segredo nunca entra neste schema.
  subject_ref_hmac char(64) not null check (subject_ref_hmac ~ '^[A-Fa-f0-9]{64}$'),
  identity_key_version smallint not null check (identity_key_version > 0),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opened_at_seq bigint not null,
  created_at timestamptz not null default now(),
  unique (session_id, subject_kind, subject_ref_hmac)
);
create index conv_cases_session_idx on support_vnext_shadow.conv_cases(session_id);

-- 2.3 pilha de objetivos.
create table support_vnext_shadow.conv_goals (
  goal_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  case_id uuid null references support_vnext_shadow.conv_cases(case_id) on delete restrict,
  topic_id uuid null references support_vnext_shadow.conversation_topics(topic_id) on delete restrict,
  goal_code support_vnext_shadow.conv_goal_code not null,
  status support_vnext_shadow.conv_goal_status not null,
  status_reason text null,
  parent_goal_id uuid null references support_vnext_shadow.conv_goals(goal_id) on delete restrict,
  overlay_of uuid null references support_vnext_shadow.conv_goals(goal_id) on delete restrict,
  stack_index integer not null check (stack_index >= 0),
  informational boolean not null default false,
  return_to_parent boolean not null default false,
  created_by_relation text null,
  opened_at_seq bigint not null,
  closed_at_seq bigint null,
  goal_version bigint not null default 1,
  check (goal_id <> parent_goal_id),
  check (goal_id <> overlay_of),
  check ((status in ('RESOLVED','ABANDONED')) = (closed_at_seq is not null))
);
create unique index conv_goals_stack_idx on support_vnext_shadow.conv_goals(session_id, stack_index);
create unique index conv_goals_one_open_per_case_code_idx
  on support_vnext_shadow.conv_goals(case_id, goal_code)
  where status in ('ACTIVE','SUSPENDED','WAITING') and case_id is not null;
create index conv_goals_session_idx on support_vnext_shadow.conv_goals(session_id, stack_index);

-- 2.4 fatos: valor imutavel, historico por supersessao.
create table support_vnext_shadow.conv_facts (
  fact_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  case_id uuid null references support_vnext_shadow.conv_cases(case_id) on delete restrict,
  goal_id uuid null references support_vnext_shadow.conv_goals(goal_id) on delete restrict,
  fact_code support_vnext_shadow.conv_fact_code not null,
  value_kind text not null check (value_kind in ('TEXT','BOOL','NUM')),
  value_text text null,
  value_bool boolean null,
  value_num numeric null,
  source support_vnext_shadow.conv_fact_source not null,
  confidence support_vnext_shadow.conv_confidence not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED')),
  authoritative boolean not null default false,
  signal_id uuid null,
  recorded_at_seq bigint not null,
  superseded_by uuid null references support_vnext_shadow.conv_facts(fact_id) on delete restrict deferrable initially deferred,
  superseded_at_seq bigint null,
  supersession_reason text null check (supersession_reason is null or supersession_reason in
    ('USER_CORRECTION','CHANGE_OF_MIND','DEPENDENCY_INVALIDATED','RELEVANCE_LOST','SYSTEM_REPLACEMENT','ROLLBACK')),
  conflicts_with uuid null references support_vnext_shadow.conv_facts(fact_id) on delete restrict deferrable initially deferred,
  inbound_message_id uuid null references support_vnext_shadow.inbound_messages(inbound_message_id) on delete restrict,
  -- exatamente um valor tipado
  check ((value_text is not null)::int + (value_bool is not null)::int + (value_num is not null)::int = 1),
  check ((value_kind = 'TEXT') = (value_text is not null)),
  check ((value_kind = 'BOOL') = (value_bool is not null)),
  check ((value_kind = 'NUM') = (value_num is not null)),
  -- I4/I5: autoridade exige sinal e origem externa; nunca origem de usuario.
  check (authoritative = (signal_id is not null)),
  check (not authoritative or (source in ('SYSTEM','DOCUMENT') and confidence = 'CONFIRMED')),
  check ((status = 'SUPERSEDED') = (superseded_at_seq is not null)),
  check ((status = 'SUPERSEDED') = (supersession_reason is not null))
);
create unique index conv_facts_one_active_idx
  on support_vnext_shadow.conv_facts(case_id, fact_code)
  where status = 'ACTIVE' and confidence <> 'CONFLICTING' and case_id is not null;
create index conv_facts_active_idx on support_vnext_shadow.conv_facts(case_id, fact_code) where status = 'ACTIVE';
create index conv_facts_session_seq_idx on support_vnext_shadow.conv_facts(session_id, recorded_at_seq);

-- 2.5 arestas de derivacao (integridade referencial da cascata).
create table support_vnext_shadow.conv_fact_derivations (
  fact_id uuid not null references support_vnext_shadow.conv_facts(fact_id) on delete restrict,
  from_fact_id uuid not null references support_vnext_shadow.conv_facts(fact_id) on delete restrict,
  primary key (fact_id, from_fact_id),
  check (fact_id <> from_fact_id)
);

-- 2.6 pilha de perguntas: FONTE DE VERDADE conversacional (decisao 1).
-- pending_questions (0002) permanece intocada e sem sincronizacao com esta tabela.
create table support_vnext_shadow.conv_question_stack (
  question_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  goal_id uuid not null references support_vnext_shadow.conv_goals(goal_id) on delete restrict,
  question_code support_vnext_shadow.conv_question_code not null,
  fact_code support_vnext_shadow.conv_fact_code not null,
  priority_class text not null check (priority_class in
    ('FLOW_BRANCH','PREREQUISITE','BLOCKING_UNCERTAINTY','DEPENDENCY','NEXT_ACTION_DATA','ADMINISTRATIVE')),
  state text not null check (state in ('PENDING','PARKED','ANSWERED','CANCELLED')),
  asked_at_seq bigint not null,
  parked_at_seq bigint null,
  resolved_at_seq bigint null,
  park_order integer null
);
create unique index conv_question_stack_one_pending_idx
  on support_vnext_shadow.conv_question_stack(session_id) where state = 'PENDING';
create index conv_question_stack_parked_idx
  on support_vnext_shadow.conv_question_stack(session_id, park_order) where state = 'PARKED';

-- 2.7 acoes autoritativas pendentes (destinatario: Administracao).
create table support_vnext_shadow.conv_pending_actions (
  action_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  goal_id uuid not null references support_vnext_shadow.conv_goals(goal_id) on delete restrict,
  action_code support_vnext_shadow.conv_action_code not null,
  executor text not null check (executor in ('SYSTEM','HUMAN','SYSTEM_OR_HUMAN')),
  fact_code support_vnext_shadow.conv_fact_code null,
  status text not null default 'PENDING' check (status in ('PENDING','RESOLVED','CANCELLED')),
  requested_at_seq bigint not null,
  resolved_at_seq bigint null,
  resolved_by_signal_id uuid null,
  check ((status = 'PENDING') = (resolved_at_seq is null))
);
create unique index conv_pending_actions_one_open_idx
  on support_vnext_shadow.conv_pending_actions(goal_id, action_code) where status = 'PENDING';
create index conv_pending_actions_session_idx
  on support_vnext_shadow.conv_pending_actions(session_id) where status = 'PENDING';

-- 2.8 sinais autoritativos: unica prova de confirmacao externa.
create table support_vnext_shadow.conv_authoritative_signals (
  signal_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  source support_vnext_shadow.conv_fact_source not null check (source in ('SYSTEM','DOCUMENT')),
  actor text not null check (btrim(actor) <> ''),
  idempotency_key char(64) not null unique check (idempotency_key ~ '^[A-Fa-f0-9]{64}$'),
  payload_hash char(64) not null check (payload_hash ~ '^[A-Fa-f0-9]{64}$'),
  covered_fact_codes support_vnext_shadow.conv_fact_code[] not null,
  received_at timestamptz not null default now(),
  applied_at_seq bigint not null,
  check (cardinality(covered_fact_codes) > 0)
);

alter table support_vnext_shadow.conv_facts
  add constraint conv_facts_signal_fk foreign key (signal_id)
  references support_vnext_shadow.conv_authoritative_signals(signal_id) on delete restrict;
alter table support_vnext_shadow.conv_pending_actions
  add constraint conv_pending_actions_signal_fk foreign key (resolved_by_signal_id)
  references support_vnext_shadow.conv_authoritative_signals(signal_id) on delete restrict;

-- 2.9 log conversacional append-only e idempotente.
create table support_vnext_shadow.conv_events (
  session_id uuid not null references support_vnext_shadow.conv_conversation_state(session_id) on delete restrict,
  event_seq bigint not null,
  event_id uuid not null unique,
  event_kind support_vnext_shadow.conv_event_kind not null,
  idempotency_key char(64) not null check (idempotency_key ~ '^[A-Fa-f0-9]{64}$'),
  payload_hash char(64) not null check (payload_hash ~ '^[A-Fa-f0-9]{64}$'),
  result jsonb not null default '{}'::jsonb,
  correlation_id uuid null,
  release_id uuid null references support_vnext_shadow.support_ruleset_release(release_id) on delete restrict,
  catalog_hash char(64) not null check (catalog_hash ~ '^[A-Fa-f0-9]{64}$'),
  inbound_message_id uuid null references support_vnext_shadow.inbound_messages(inbound_message_id) on delete restrict,
  handoff_id uuid null references support_vnext_shadow.handoffs(handoff_id) on delete restrict,
  signal_id uuid null references support_vnext_shadow.conv_authoritative_signals(signal_id) on delete restrict,
  applied_at timestamptz not null default now(),
  primary key (session_id, event_seq),
  unique (session_id, idempotency_key),
  check (jsonb_typeof(result) = 'object')
);
create index conv_events_recent_idx on support_vnext_shadow.conv_events(session_id, event_seq desc);
create index conv_events_correlation_idx on support_vnext_shadow.conv_events(correlation_id);

-- ---------------------------------------------------------------------------
-- 3. Guardas (integridade que nao depende do chamador)
-- ---------------------------------------------------------------------------

-- I13/I18: conv_events e append-only.
create or replace function support_vnext_shadow.conv_events_append_only()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
begin
  raise exception 'conv_events is append-only' using errcode='55000';
end $$;
create trigger trg_conv_events_append_only before update or delete
  on support_vnext_shadow.conv_events for each row
  execute function support_vnext_shadow.conv_events_append_only();

-- I6: valor, codigo, escopo e origem do fato sao imutaveis; so o ciclo de
-- supersessao/conflito pode ser atualizado. Fato nunca e apagado.
create or replace function support_vnext_shadow.conv_facts_immutable()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conv_facts rows are never deleted' using errcode='55000';
  end if;
  if new.fact_id <> old.fact_id or new.fact_code <> old.fact_code or new.session_id <> old.session_id
     or new.case_id is distinct from old.case_id or new.goal_id is distinct from old.goal_id
     or new.value_kind <> old.value_kind or new.value_text is distinct from old.value_text
     or new.value_bool is distinct from old.value_bool or new.value_num is distinct from old.value_num
     or new.source <> old.source or new.recorded_at_seq <> old.recorded_at_seq
     or new.authoritative <> old.authoritative or new.signal_id is distinct from old.signal_id
     or new.inbound_message_id is distinct from old.inbound_message_id then
    raise exception 'conv_facts value/scope/provenance is immutable' using errcode='55000';
  end if;
  if old.status = 'SUPERSEDED' and new.status = 'ACTIVE' then
    raise exception 'superseded fact cannot be revived' using errcode='55000';
  end if;
  return new;
end $$;
create trigger trg_conv_facts_immutable before update or delete
  on support_vnext_shadow.conv_facts for each row
  execute function support_vnext_shadow.conv_facts_immutable();

-- I7: fato de escopo de case pertence ao case do proprio goal e nunca muda de case.
create or replace function support_vnext_shadow.conv_facts_case_coherence()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
declare g support_vnext_shadow.conv_goals;
begin
  if new.goal_id is not null then
    select * into g from support_vnext_shadow.conv_goals where goal_id = new.goal_id;
    if g.session_id <> new.session_id then
      raise exception 'fact and goal belong to different conversations' using errcode='22023';
    end if;
    if new.case_id is not null and g.case_id is distinct from new.case_id then
      raise exception 'fact case_id does not match its goal case_id' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create trigger trg_conv_facts_case_coherence before insert
  on support_vnext_shadow.conv_facts for each row
  execute function support_vnext_shadow.conv_facts_case_coherence();

-- I7: case_id de um case e imutavel e o case nunca e apagado.
create or replace function support_vnext_shadow.conv_cases_immutable()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conv_cases rows are never deleted' using errcode='55000';
  end if;
  if new.case_id <> old.case_id or new.session_id <> old.session_id
     or new.subject_kind <> old.subject_kind or new.subject_ref_hmac <> old.subject_ref_hmac
     or new.identity_key_version <> old.identity_key_version or new.opened_at_seq <> old.opened_at_seq then
    raise exception 'conv_cases identity is immutable' using errcode='55000';
  end if;
  return new;
end $$;
create trigger trg_conv_cases_immutable before update or delete
  on support_vnext_shadow.conv_cases for each row
  execute function support_vnext_shadow.conv_cases_immutable();

-- I8: transicoes de goal permitidas; RESOLVED/ABANDONED sao terminais.
create or replace function support_vnext_shadow.conv_goals_transition_guard()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conv_goals rows are never deleted' using errcode='55000';
  end if;
  if new.goal_id <> old.goal_id or new.session_id <> old.session_id or new.goal_code <> old.goal_code
     or new.case_id is distinct from old.case_id or new.stack_index <> old.stack_index
     or new.parent_goal_id is distinct from old.parent_goal_id or new.overlay_of is distinct from old.overlay_of
     or new.opened_at_seq <> old.opened_at_seq or new.created_by_relation is distinct from old.created_by_relation then
    raise exception 'conv_goals identity is immutable' using errcode='55000';
  end if;
  if new.status <> old.status then
    if old.status in ('RESOLVED','ABANDONED') then
      raise exception 'goal % is terminal (%)', old.goal_id, old.status using errcode='55000';
    end if;
    -- Os tres estados abertos (ACTIVE/SUSPENDED/WAITING) sao mutuamente
    -- alcancaveis: um objetivo bloqueado por verificacao pode ser suspenso por um
    -- subfluxo na mesma transicao, e vice-versa. O que a guarda garante e que
    -- RESOLVED e ABANDONED sao terminais (I8).
    if old.status not in ('ACTIVE','SUSPENDED','WAITING') then
      raise exception 'illegal goal transition % -> %', old.status, new.status using errcode='55000';
    end if;
    new.goal_version := old.goal_version + 1;
  end if;
  return new;
end $$;
create trigger trg_conv_goals_transition before update or delete
  on support_vnext_shadow.conv_goals for each row
  execute function support_vnext_shadow.conv_goals_transition_guard();

-- I11: overlay nunca substitui o goal-base.
create or replace function support_vnext_shadow.conv_goals_overlay_guard()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
declare base support_vnext_shadow.conv_goals;
begin
  if new.overlay_of is null then return new; end if;
  select * into base from support_vnext_shadow.conv_goals where goal_id = new.overlay_of;
  if base.goal_id is null or base.session_id <> new.session_id then
    raise exception 'overlay base goal not found in this conversation' using errcode='22023';
  end if;
  if base.status not in ('ACTIVE','SUSPENDED','WAITING') then
    raise exception 'overlay cannot attach to a closed base goal' using errcode='22023';
  end if;
  return new;
end $$;
create trigger trg_conv_goals_overlay before insert
  on support_vnext_shadow.conv_goals for each row
  execute function support_vnext_shadow.conv_goals_overlay_guard();

-- I2: pergunta nunca e destruida; so muda de estado.
create or replace function support_vnext_shadow.conv_question_stack_guard()
returns trigger language plpgsql set search_path=pg_catalog,support_vnext_shadow as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conv_question_stack rows are never deleted' using errcode='55000';
  end if;
  if new.question_id <> old.question_id or new.session_id <> old.session_id or new.goal_id <> old.goal_id
     or new.question_code <> old.question_code or new.fact_code <> old.fact_code
     or new.asked_at_seq <> old.asked_at_seq then
    raise exception 'conv_question_stack identity is immutable' using errcode='55000';
  end if;
  if old.state in ('ANSWERED','CANCELLED') and new.state <> old.state then
    raise exception 'question % is closed (%)', old.question_id, old.state using errcode='55000';
  end if;
  return new;
end $$;
create trigger trg_conv_question_stack_guard before update or delete
  on support_vnext_shadow.conv_question_stack for each row
  execute function support_vnext_shadow.conv_question_stack_guard();

-- ---------------------------------------------------------------------------
-- 4. Leitura canonica (read-model consumido pelo reducer TypeScript)
-- ---------------------------------------------------------------------------
create or replace function support_vnext_shadow.conv_get_state(p_session_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare st support_vnext_shadow.conv_conversation_state; out_json jsonb;
begin
  select * into st from support_vnext_shadow.conv_conversation_state where session_id = p_session_id;
  if not found then
    return jsonb_build_object('exists', false, 'seq', 0::bigint);
  end if;
  select jsonb_build_object(
    'exists', true,
    'session_id', st.session_id,
    'seq', st.seq,
    'domain_version', st.domain_version,
    'catalog_hash', st.catalog_hash,
    'state_hash', st.state_hash,
    'cases', coalesce((select jsonb_agg(c order by c->>'case_id') from (
        select jsonb_build_object('case_id',case_id,'subject_kind',subject_kind,
               'subject_ref_hmac',subject_ref_hmac,'identity_key_version',identity_key_version,
               'status',status,'opened_at_seq',opened_at_seq) as c
        from support_vnext_shadow.conv_cases where session_id = p_session_id) s), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(g order by g->>'goal_id') from (
        select jsonb_build_object('goal_id',goal_id,'goal_code',goal_code,'case_id',case_id,'status',status,
               'status_reason',status_reason,'parent_goal_id',parent_goal_id,'overlay_of',overlay_of,
               'stack_index',stack_index,'informational',informational,'return_to_parent',return_to_parent,
               'created_by_relation',created_by_relation,'opened_at_seq',opened_at_seq,'closed_at_seq',closed_at_seq) as g
        from support_vnext_shadow.conv_goals where session_id = p_session_id) s), '[]'::jsonb),
    'facts', coalesce((select jsonb_agg(f order by f->>'fact_id') from (
        select jsonb_build_object('fact_id',fa.fact_id,'fact_code',fa.fact_code,'case_id',fa.case_id,'goal_id',fa.goal_id,
               'value', case fa.value_kind when 'TEXT' then to_jsonb(fa.value_text)
                                           when 'BOOL' then to_jsonb(fa.value_bool)
                                           else to_jsonb(fa.value_num) end,
               'source',fa.source,'confidence',fa.confidence,'status',fa.status,'authoritative',fa.authoritative,
               'recorded_at_seq',fa.recorded_at_seq,'superseded_by',fa.superseded_by,
               'superseded_at_seq',fa.superseded_at_seq,'supersession_reason',fa.supersession_reason,
               'conflicts_with',fa.conflicts_with,
               'derived_from', coalesce((select jsonb_agg(d.from_fact_id order by d.from_fact_id)
                                           from support_vnext_shadow.conv_fact_derivations d
                                          where d.fact_id = fa.fact_id), '[]'::jsonb)) as f
        from support_vnext_shadow.conv_facts fa where fa.session_id = p_session_id) s), '[]'::jsonb),
    'pending_question', (select jsonb_build_object('question_id',question_id,'question_code',question_code,
               'fact_code',fact_code,'goal_id',goal_id,'priority_class',priority_class,'asked_at_seq',asked_at_seq)
        from support_vnext_shadow.conv_question_stack
        where session_id = p_session_id and state = 'PENDING'),
    'parked_questions', coalesce((select jsonb_agg(q order by (q->>'park_order')::int) from (
        select jsonb_build_object('question_id',question_id,'question_code',question_code,'fact_code',fact_code,
               'goal_id',goal_id,'priority_class',priority_class,'asked_at_seq',asked_at_seq,
               'park_order',park_order) as q
        from support_vnext_shadow.conv_question_stack
        where session_id = p_session_id and state = 'PARKED') s), '[]'::jsonb),
    'pending_actions', coalesce((select jsonb_agg(a order by a->>'action_id') from (
        select jsonb_build_object('action_id',action_id,'action_code',action_code,'executor',executor,
               'goal_id',goal_id,'fact_code',fact_code,'requested_at_seq',requested_at_seq) as a
        from support_vnext_shadow.conv_pending_actions
        where session_id = p_session_id and status = 'PENDING') s), '[]'::jsonb)
  ) into out_json;
  return out_json;
end $$;

-- Projecao canonica do estado de dominio, em texto estavel: e o contrato de
-- comparacao entre o reducer TypeScript e a persistencia (nao depende da ordem
-- de chaves de jsonb). NULL e representado por '-'.
create or replace function support_vnext_shadow.conv_state_canonical(p_session_id uuid)
returns text
language sql stable
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
  select coalesce((select string_agg(line, '' order by line) from (
      select format('C|%s|%s|%s|%s|%s'||chr(10), case_id, subject_kind, subject_ref_hmac,
                    identity_key_version, status) as line
        from support_vnext_shadow.conv_cases where session_id = p_session_id) c), '')
      ||
      coalesce((select string_agg(line, '' order by line) from (
      select format('G|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s'||chr(10), goal_id, goal_code,
                    coalesce(case_id::text,'-'), status, coalesce(status_reason,'-'),
                    coalesce(parent_goal_id::text,'-'), coalesce(overlay_of::text,'-'), stack_index,
                    case when informational then 't' else 'f' end,
                    case when return_to_parent then 't' else 'f' end,
                    coalesce(created_by_relation,'-'), opened_at_seq, coalesce(closed_at_seq::text,'-')) as line
        from support_vnext_shadow.conv_goals where session_id = p_session_id) g), '')
      ||
      coalesce((select string_agg(line, '' order by line) from (
      select format('F|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s'||chr(10), fa.fact_id, fa.fact_code,
                    coalesce(fa.case_id::text,'-'), coalesce(fa.goal_id::text,'-'), fa.value_kind,
                    case fa.value_kind when 'TEXT' then fa.value_text
                                       when 'BOOL' then (case when fa.value_bool then 't' else 'f' end)
                                       else fa.value_num::text end,
                    fa.source, fa.confidence, fa.status,
                    case when fa.authoritative then 't' else 'f' end, fa.recorded_at_seq,
                    coalesce(fa.superseded_by::text,'-'), coalesce(fa.superseded_at_seq::text,'-'),
                    coalesce(fa.supersession_reason,'-'), coalesce(fa.conflicts_with::text,'-'),
                    coalesce((select string_agg(d.from_fact_id::text, ',' order by d.from_fact_id::text)
                                from support_vnext_shadow.conv_fact_derivations d where d.fact_id = fa.fact_id),'-')) as line
        from support_vnext_shadow.conv_facts fa where fa.session_id = p_session_id) f), '')
      ||
      coalesce((select format('Q|%s|%s|%s|%s|%s|%s'||chr(10), question_id, question_code, fact_code, goal_id,
                              priority_class, asked_at_seq)
        from support_vnext_shadow.conv_question_stack
        where session_id = p_session_id and state = 'PENDING'), 'Q|-'||chr(10))
      ||
      coalesce((select string_agg(line, '' order by line) from (
      select format('P|%s|%s'||chr(10), lpad(park_order::text, 6, '0'), question_id) as line
        from support_vnext_shadow.conv_question_stack
        where session_id = p_session_id and state = 'PARKED') p), '')
      ||
      coalesce((select string_agg(line, '' order by line) from (
      select format('A|%s|%s|%s|%s|%s'||chr(10), action_id, action_code, executor, goal_id,
                    coalesce(fact_code::text,'-')) as line
        from support_vnext_shadow.conv_pending_actions
        where session_id = p_session_id and status = 'PENDING') a), '')
$$;

create or replace function support_vnext_shadow.conv_state_hash(p_session_id uuid)
returns char(64)
language sql stable
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
  select encode(extensions.digest(support_vnext_shadow.conv_state_canonical(p_session_id), 'sha256'), 'hex')::char(64)
$$;

-- ---------------------------------------------------------------------------
-- 5. Aplicacao de operacoes (validacao ESTRUTURAL; nenhuma semantica de dominio)
-- ---------------------------------------------------------------------------
create or replace function support_vnext_shadow.conv_apply_ops(
  p_session_id uuid,
  p_seq bigint,
  p_ops jsonb,
  p_allow_authoritative boolean,
  p_signal_id uuid,
  p_covered_fact_codes text[]
) returns integer
language plpgsql
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare op jsonb; n integer := 0; v_kind text; v_auth boolean; d jsonb;
begin
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'transition ops must be an array' using errcode='22023';
  end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    n := n + 1;
    case op->>'op'
      when 'open_case' then
        insert into support_vnext_shadow.conv_cases(
          case_id, session_id, subject_kind, subject_ref_hmac, identity_key_version, opened_at_seq)
        values ((op->>'case_id')::uuid, p_session_id, op->>'subject_kind', op->>'subject_ref_hmac',
                (op->>'identity_key_version')::smallint, p_seq);

      when 'push_goal' then
        insert into support_vnext_shadow.conv_goals(
          goal_id, session_id, case_id, topic_id, goal_code, status, status_reason, parent_goal_id, overlay_of,
          stack_index, informational, return_to_parent, created_by_relation, opened_at_seq, closed_at_seq)
        values ((op->>'goal_id')::uuid, p_session_id, (op->>'case_id')::uuid, (op->>'topic_id')::uuid,
                (op->>'goal_code')::support_vnext_shadow.conv_goal_code,
                coalesce((op->>'status')::support_vnext_shadow.conv_goal_status,'ACTIVE'),
                op->>'status_reason', (op->>'parent_goal_id')::uuid, (op->>'overlay_of')::uuid,
                (op->>'stack_index')::int, coalesce((op->>'informational')::boolean,false),
                coalesce((op->>'return_to_parent')::boolean,false), op->>'created_by_relation', p_seq,
                -- um subfluxo pode nascer e fechar na mesma transicao (pergunta informativa)
                case when coalesce(op->>'status','ACTIVE') in ('RESOLVED','ABANDONED') then p_seq end);

      when 'set_goal_status' then
        update support_vnext_shadow.conv_goals
           set status = (op->>'status')::support_vnext_shadow.conv_goal_status,
               status_reason = op->>'status_reason',
               closed_at_seq = case when (op->>'status') in ('RESOLVED','ABANDONED') then p_seq else null end
         where goal_id = (op->>'goal_id')::uuid and session_id = p_session_id;
        if not found then raise exception 'goal % not found', op->>'goal_id' using errcode='22023'; end if;

      when 'record_fact' then
        v_kind := op->>'value_kind';
        v_auth := coalesce((op->>'authoritative')::boolean, false);
        if v_auth and not p_allow_authoritative then
          raise exception 'conv_apply_transition cannot create authoritative facts' using errcode='42501';
        end if;
        if v_auth and not ((op->>'fact_code') = any(p_covered_fact_codes)) then
          raise exception 'fact % is not covered by the authoritative signal', op->>'fact_code' using errcode='42501';
        end if;
        insert into support_vnext_shadow.conv_facts(
          fact_id, session_id, case_id, goal_id, fact_code, value_kind, value_text, value_bool, value_num,
          source, confidence, status, authoritative, signal_id, recorded_at_seq, conflicts_with, inbound_message_id)
        values ((op->>'fact_id')::uuid, p_session_id, (op->>'case_id')::uuid, (op->>'goal_id')::uuid,
                (op->>'fact_code')::support_vnext_shadow.conv_fact_code, v_kind,
                case when v_kind = 'TEXT' then op->>'value' end,
                case when v_kind = 'BOOL' then (op->>'value')::boolean end,
                case when v_kind = 'NUM' then (op->>'value')::numeric end,
                (op->>'source')::support_vnext_shadow.conv_fact_source,
                (op->>'confidence')::support_vnext_shadow.conv_confidence,
                'ACTIVE', v_auth, case when v_auth then p_signal_id end, p_seq,
                (op->>'conflicts_with')::uuid, (op->>'inbound_message_id')::uuid);
        for d in select value from jsonb_array_elements(coalesce(op->'derived_from','[]'::jsonb)) loop
          insert into support_vnext_shadow.conv_fact_derivations(fact_id, from_fact_id)
          values ((op->>'fact_id')::uuid, (d #>> '{}')::uuid);
        end loop;

      when 'set_fact_confidence' then
        update support_vnext_shadow.conv_facts
           set confidence = (op->>'confidence')::support_vnext_shadow.conv_confidence,
               conflicts_with = (op->>'conflicts_with')::uuid
         where fact_id = (op->>'fact_id')::uuid and session_id = p_session_id;
        if not found then raise exception 'fact % not found', op->>'fact_id' using errcode='22023'; end if;

      when 'supersede_fact' then
        update support_vnext_shadow.conv_facts
           set status = 'SUPERSEDED',
               superseded_by = (op->>'superseded_by')::uuid,
               superseded_at_seq = p_seq,
               supersession_reason = op->>'supersession_reason'
               -- conflicts_with permanece: o registro de com quem o fato conflitou
               -- faz parte do historico e nao e apagado pela supersessao.
         where fact_id = (op->>'fact_id')::uuid and session_id = p_session_id and status = 'ACTIVE';
        if not found then raise exception 'active fact % not found', op->>'fact_id' using errcode='22023'; end if;

      when 'set_question' then
        insert into support_vnext_shadow.conv_question_stack(
          question_id, session_id, goal_id, question_code, fact_code, priority_class, state, asked_at_seq)
        values ((op->>'question_id')::uuid, p_session_id, (op->>'goal_id')::uuid,
                (op->>'question_code')::support_vnext_shadow.conv_question_code,
                (op->>'fact_code')::support_vnext_shadow.conv_fact_code,
                op->>'priority_class', 'PENDING', p_seq);

      when 'park_question' then
        update support_vnext_shadow.conv_question_stack
           set state = 'PARKED', parked_at_seq = p_seq, park_order = (op->>'park_order')::int
         where question_id = (op->>'question_id')::uuid and session_id = p_session_id and state = 'PENDING';
        if not found then raise exception 'pending question % not found', op->>'question_id' using errcode='22023'; end if;

      when 'restore_question' then
        update support_vnext_shadow.conv_question_stack
           set state = 'PENDING', parked_at_seq = null, park_order = null
         where question_id = (op->>'question_id')::uuid and session_id = p_session_id and state = 'PARKED';
        if not found then raise exception 'parked question % not found', op->>'question_id' using errcode='22023'; end if;

      when 'close_question' then
        update support_vnext_shadow.conv_question_stack
           set state = op->>'state', resolved_at_seq = p_seq, park_order = null
         where question_id = (op->>'question_id')::uuid and session_id = p_session_id
           and state in ('PENDING','PARKED');
        if not found then raise exception 'open question % not found', op->>'question_id' using errcode='22023'; end if;

      when 'open_action' then
        insert into support_vnext_shadow.conv_pending_actions(
          action_id, session_id, goal_id, action_code, executor, fact_code, requested_at_seq)
        values ((op->>'action_id')::uuid, p_session_id, (op->>'goal_id')::uuid,
                (op->>'action_code')::support_vnext_shadow.conv_action_code, op->>'executor',
                (op->>'fact_code')::support_vnext_shadow.conv_fact_code, p_seq);

      when 'close_action' then
        update support_vnext_shadow.conv_pending_actions
           set status = coalesce(op->>'status','RESOLVED'), resolved_at_seq = p_seq,
               resolved_by_signal_id = p_signal_id
         where action_id = (op->>'action_id')::uuid and session_id = p_session_id and status = 'PENDING';
        if not found then raise exception 'pending action % not found', op->>'action_id' using errcode='22023'; end if;

      else
        raise exception 'unknown transition op: %', coalesce(op->>'op','<null>') using errcode='22023';
    end case;
  end loop;
  return n;
end $$;

-- Nucleo comum: lock, expected_seq, idempotencia, catalog_hash, ops, state_hash.
create or replace function support_vnext_shadow.conv_commit_transition(
  p_session_id uuid,
  p_expected_seq bigint,
  p_transition jsonb,
  p_idempotency_key char(64),
  p_event_kind support_vnext_shadow.conv_event_kind,
  p_allow_authoritative boolean,
  p_signal_id uuid,
  p_covered_fact_codes text[]
) returns jsonb
language plpgsql
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare
  st support_vnext_shadow.conv_conversation_state;
  s support_vnext_shadow.conversation_sessions;
  prior support_vnext_shadow.conv_events;
  new_seq bigint; computed char(64); declared char(64); n integer;
  result jsonb;
begin
  if p_idempotency_key !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'idempotency key must be sha256 hex' using errcode='22023';
  end if;
  if coalesce(p_transition->>'catalog_hash','') !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'transition must declare catalog_hash' using errcode='22023';
  end if;
  declared := p_transition->>'state_hash';
  if coalesce(declared,'') !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'transition must declare the expected state_hash' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('support-vnext-conv:'||p_session_id::text, 0));

  select * into s from support_vnext_shadow.conversation_sessions where session_id = p_session_id for share;
  if not found then raise exception 'session not found' using errcode='22023'; end if;
  if s.status = 'CLOSED' then raise exception 'session is closed' using errcode='22023'; end if;

  select * into st from support_vnext_shadow.conv_conversation_state
   where session_id = p_session_id for update;

  if not found then
    if p_expected_seq <> 0 then
      raise exception 'conversation state moved' using errcode='55000';
    end if;
    insert into support_vnext_shadow.conv_conversation_state(
      session_id, seq, domain_version, catalog_hash, state_hash)
    values (p_session_id, 0, 'santana-conversation-domain/v1', p_transition->>'catalog_hash',
            repeat('0',64))
    returning * into st;
  end if;

  -- Replay: nao reaplica, devolve o resultado gravado.
  select * into prior from support_vnext_shadow.conv_events
   where session_id = p_session_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('replayed', true, 'seq', st.seq, 'result', prior.result);
  end if;

  if st.seq <> p_expected_seq then
    raise exception 'conversation state moved' using errcode='55000';
  end if;
  if st.catalog_hash <> (p_transition->>'catalog_hash') then
    raise exception 'catalog hash mismatch' using errcode='22023';
  end if;

  new_seq := st.seq + 1;
  n := support_vnext_shadow.conv_apply_ops(
         p_session_id, new_seq, coalesce(p_transition->'ops','[]'::jsonb),
         p_allow_authoritative, p_signal_id, coalesce(p_covered_fact_codes, array[]::text[]));

  computed := support_vnext_shadow.conv_state_hash(p_session_id);
  if computed <> declared then
    raise exception 'state hash mismatch after transition (expected %, computed %)', declared, computed
      using errcode='22023';
  end if;

  update support_vnext_shadow.conv_conversation_state
     set seq = new_seq, state_hash = computed, updated_at = now()
   where session_id = p_session_id;

  result := jsonb_build_object('seq', new_seq, 'ops_applied', n,
              'state_hash', computed,
              'pending_question', (support_vnext_shadow.conv_get_state(p_session_id))->'pending_question',
              'pending_actions', (support_vnext_shadow.conv_get_state(p_session_id))->'pending_actions');

  insert into support_vnext_shadow.conv_events(
    session_id, event_seq, event_id, event_kind, idempotency_key, payload_hash, result,
    correlation_id, release_id, catalog_hash, inbound_message_id, handoff_id, signal_id)
  values (p_session_id, new_seq, coalesce((p_transition->>'event_id')::uuid, extensions.gen_random_uuid()),
          p_event_kind, p_idempotency_key,
          encode(extensions.digest(p_transition::text,'sha256'),'hex'), result,
          (p_transition->>'correlation_id')::uuid, s.release_id, p_transition->>'catalog_hash',
          (p_transition->>'inbound_message_id')::uuid, (p_transition->>'handoff_id')::uuid, p_signal_id);

  return jsonb_build_object('replayed', false, 'seq', new_seq, 'result', result);
end $$;

-- ---------------------------------------------------------------------------
-- 6. RPCs publicas (4)
-- ---------------------------------------------------------------------------

-- Transicao conversacional comum. NUNCA cria fato autoritativo.
create or replace function support_vnext_shadow.conv_apply_transition(
  p_session_id uuid, p_expected_seq bigint, p_transition jsonb, p_idempotency_key char(64)
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare kind support_vnext_shadow.conv_event_kind;
begin
  kind := coalesce((p_transition->>'event_kind')::support_vnext_shadow.conv_event_kind, 'ANSWER');
  if kind in ('AUTHORITATIVE_SIGNAL','SYSTEM_ROLLBACK') then
    raise exception 'event kind % requires its own entrypoint', kind using errcode='42501';
  end if;
  return support_vnext_shadow.conv_commit_transition(
    p_session_id, p_expected_seq, p_transition, p_idempotency_key, kind, false, null, null);
end $$;

-- Unica via que persiste autoridade. Grant proprio, separado da anterior.
create or replace function support_vnext_shadow.conv_apply_authoritative_signal(
  p_session_id uuid, p_expected_seq bigint, p_signal jsonb, p_transition jsonb, p_idempotency_key char(64)
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare v_signal_id uuid; v_source text; v_codes text[]; v_out jsonb; existing uuid;
begin
  v_source := p_signal->>'source';
  if v_source is null or v_source not in ('SYSTEM','DOCUMENT') then
    raise exception 'authoritative signal requires source SYSTEM or DOCUMENT, got %',
      coalesce(v_source,'<null>') using errcode='42501';
  end if;
  if coalesce(btrim(p_signal->>'actor'),'') = '' then
    raise exception 'authoritative signal requires an actor' using errcode='22023';
  end if;
  select array(select jsonb_array_elements_text(coalesce(p_signal->'covered_fact_codes','[]'::jsonb)))
    into v_codes;
  if coalesce(cardinality(v_codes),0) = 0 then
    raise exception 'authoritative signal must declare covered_fact_codes' using errcode='22023';
  end if;

  select signal_id into existing from support_vnext_shadow.conv_authoritative_signals
   where idempotency_key = p_idempotency_key;
  if existing is not null then
    return support_vnext_shadow.conv_commit_transition(
      p_session_id, p_expected_seq, p_transition, p_idempotency_key, 'AUTHORITATIVE_SIGNAL', true, existing, v_codes);
  end if;

  v_signal_id := coalesce((p_signal->>'signal_id')::uuid, extensions.gen_random_uuid());
  insert into support_vnext_shadow.conv_authoritative_signals(
    signal_id, session_id, source, actor, idempotency_key, payload_hash, covered_fact_codes, applied_at_seq)
  values (v_signal_id, p_session_id, v_source::support_vnext_shadow.conv_fact_source, p_signal->>'actor',
          p_idempotency_key, encode(extensions.digest(p_signal::text,'sha256'),'hex'),
          v_codes::support_vnext_shadow.conv_fact_code[], p_expected_seq + 1);

  v_out := support_vnext_shadow.conv_commit_transition(
    p_session_id, p_expected_seq, p_transition, p_idempotency_key, 'AUTHORITATIVE_SIGNAL', true, v_signal_id, v_codes);
  return v_out || jsonb_build_object('signal_id', v_signal_id);
end $$;

-- Rollback logico append-only: compensa com escritas novas e um evento novo.
-- Nenhum evento, fato, goal, pergunta ou acao anterior e apagado ou reescrito.
create or replace function support_vnext_shadow.conv_rollback_to_seq(
  p_session_id uuid, p_to_seq bigint, p_actor text, p_reason text
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare st support_vnext_shadow.conv_conversation_state; new_seq bigint;
        n_facts int; n_goals int; n_q int; n_a int; computed char(64); result jsonb;
begin
  if coalesce(btrim(p_actor),'') = '' then
    raise exception 'actor required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('support-vnext-conv:'||p_session_id::text, 0));
  select * into st from support_vnext_shadow.conv_conversation_state
   where session_id = p_session_id for update;
  if not found then raise exception 'conversation state not found' using errcode='22023'; end if;
  if p_to_seq < 0 or p_to_seq >= st.seq then
    raise exception 'rollback target must be an earlier seq' using errcode='22023';
  end if;
  new_seq := st.seq + 1;

  update support_vnext_shadow.conv_facts
     set status = 'SUPERSEDED', superseded_at_seq = new_seq, supersession_reason = 'ROLLBACK', conflicts_with = null
   where session_id = p_session_id and status = 'ACTIVE' and recorded_at_seq > p_to_seq;
  get diagnostics n_facts = row_count;

  update support_vnext_shadow.conv_goals
     set status = 'ABANDONED', status_reason = 'ROLLBACK', closed_at_seq = new_seq
   where session_id = p_session_id and status in ('ACTIVE','SUSPENDED','WAITING') and opened_at_seq > p_to_seq;
  get diagnostics n_goals = row_count;

  update support_vnext_shadow.conv_question_stack
     set state = 'CANCELLED', resolved_at_seq = new_seq, park_order = null
   where session_id = p_session_id and state in ('PENDING','PARKED') and asked_at_seq > p_to_seq;
  get diagnostics n_q = row_count;

  update support_vnext_shadow.conv_pending_actions
     set status = 'CANCELLED', resolved_at_seq = new_seq
   where session_id = p_session_id and status = 'PENDING' and requested_at_seq > p_to_seq;
  get diagnostics n_a = row_count;

  computed := support_vnext_shadow.conv_state_hash(p_session_id);
  result := jsonb_build_object('rolled_back_to', p_to_seq, 'seq', new_seq, 'actor', p_actor,
              'reason', p_reason, 'facts_superseded', n_facts, 'goals_abandoned', n_goals,
              'questions_cancelled', n_q, 'actions_cancelled', n_a, 'state_hash', computed);

  insert into support_vnext_shadow.conv_events(
    session_id, event_seq, event_id, event_kind, idempotency_key, payload_hash, result, catalog_hash)
  values (p_session_id, new_seq, extensions.gen_random_uuid(), 'SYSTEM_ROLLBACK',
          encode(extensions.digest('rollback:'||p_session_id::text||':'||p_to_seq::text||':'||new_seq::text,'sha256'),'hex'),
          encode(extensions.digest(result::text,'sha256'),'hex'), result, st.catalog_hash);

  update support_vnext_shadow.conv_conversation_state
     set seq = new_seq, state_hash = computed, updated_at = now()
   where session_id = p_session_id;

  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS e privilegios (modelo RPC-only)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['conv_conversation_state','conv_cases','conv_goals','conv_facts',
                           'conv_fact_derivations','conv_question_stack','conv_pending_actions',
                           'conv_authoritative_signals','conv_events'] loop
    execute format('alter table support_vnext_shadow.%I enable row level security', t);
    execute format('alter table support_vnext_shadow.%I force row level security', t);
    execute format('revoke all on support_vnext_shadow.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- PostgreSQL concede EXECUTE a PUBLIC por padrao em toda funcao nova, inclusive
-- nas funcoes de trigger: revogar antes de conceder o que e devido.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'support_vnext_shadow' and p.proname like 'conv\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;

revoke all on function support_vnext_shadow.conv_get_state(uuid) from public, anon, authenticated;
revoke all on function support_vnext_shadow.conv_apply_transition(uuid,bigint,jsonb,char) from public, anon, authenticated;
revoke all on function support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,char) from public, anon, authenticated;
revoke all on function support_vnext_shadow.conv_rollback_to_seq(uuid,bigint,text,text) from public, anon, authenticated;
-- Internas: nunca expostas.
revoke all on function support_vnext_shadow.conv_apply_ops(uuid,bigint,jsonb,boolean,uuid,text[])
  from public, anon, authenticated, service_role;
revoke all on function support_vnext_shadow.conv_commit_transition(uuid,bigint,jsonb,char,support_vnext_shadow.conv_event_kind,boolean,uuid,text[])
  from public, anon, authenticated, service_role;
revoke all on function support_vnext_shadow.conv_state_hash(uuid) from public, anon, authenticated, service_role;
revoke all on function support_vnext_shadow.conv_state_canonical(uuid) from public, anon, authenticated, service_role;

grant execute on function support_vnext_shadow.conv_get_state(uuid) to service_role;
grant execute on function support_vnext_shadow.conv_apply_transition(uuid,bigint,jsonb,char) to service_role;
-- Autoridade separada: sinal autoritativo e rollback nao acompanham a transicao comum.
grant execute on function support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,char)
  to support_vnext_admin;
grant execute on function support_vnext_shadow.conv_rollback_to_seq(uuid,bigint,text,text) to support_vnext_admin;

-- ---------------------------------------------------------------------------
-- 8. Auto-verificacao da migration
-- ---------------------------------------------------------------------------
do $$
declare missing text; leftover text;
begin
  select string_agg(t, ', ') into missing from unnest(array[
    'conv_conversation_state','conv_cases','conv_goals','conv_facts','conv_fact_derivations',
    'conv_question_stack','conv_pending_actions','conv_authoritative_signals','conv_events']) t
   where to_regclass('support_vnext_shadow.'||t) is null;
  if missing is not null then
    raise exception '0020 did not create: %', missing using errcode='55000';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into leftover
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'support_vnext_shadow' and p.proname like 'conv\_%'
     and has_function_privilege('public', p.oid, 'EXECUTE');
  if leftover is not null then
    raise exception 'PUBLIC still holds EXECUTE on: %', leftover using errcode='55000';
  end if;

  if has_function_privilege('service_role',
       'support_vnext_shadow.conv_apply_authoritative_signal(uuid,bigint,jsonb,jsonb,char)'::regprocedure, 'EXECUTE') then
    raise exception 'service_role must not execute conv_apply_authoritative_signal' using errcode='55000';
  end if;

  select string_agg(t, ', ') into leftover from unnest(array[
    'conv_conversation_state','conv_cases','conv_goals','conv_facts','conv_fact_derivations',
    'conv_question_stack','conv_pending_actions','conv_authoritative_signals','conv_events']) t
   where has_table_privilege('service_role', 'support_vnext_shadow.'||t, 'SELECT');
  if leftover is not null then
    raise exception 'service_role must not read conv_* directly: %', leftover using errcode='55000';
  end if;
end $$;

commit;
