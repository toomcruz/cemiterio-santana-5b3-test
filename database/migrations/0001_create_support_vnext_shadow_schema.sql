-- FASE 5B.1 — ARTEFATO LOCAL. NÃO EXECUTAR EM PRODUÇÃO.
-- Migração aditiva: cria somente o schema support_vnext_shadow e nunca altera service_* ou objetos legados.

-- Used only by the isolated schema's transactional UUID generation. Rollback intentionally preserves shared extensions.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists support_vnext_shadow;

create type support_vnext_shadow.ruleset_status as enum (
  'DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REVOKED', 'ARCHIVED'
);
create type support_vnext_shadow.record_status as enum (
  'DRAFT', 'PUBLISHED', 'RETIRED', 'REVOKED', 'ARCHIVED'
);
create type support_vnext_shadow.review_status as enum ('PENDING', 'VERIFIED', 'REJECTED');
create type support_vnext_shadow.automation_mode as enum ('BOT_ACTIVE', 'HUMAN_ACTIVE');
create type support_vnext_shadow.session_status as enum ('ACTIVE', 'WARNING_PENDING', 'WARNING_SENT', 'CLOSED');
create type support_vnext_shadow.topic_status as enum (
  'ACTIVE', 'WAITING_INPUT', 'WAITING_DOCUMENT', 'WAITING_CONFIRMATION',
  'WAITING_HUMAN', 'READY_FOR_REVIEW', 'SCHEDULE_REQUIRED', 'COMPLETED',
  'BLOCKED', 'A_CONFIRMAR', 'CANCELLED'
);
create type support_vnext_shadow.confirmation_status as enum (
  'PENDING', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'CONSUMED'
);
create type support_vnext_shadow.inactivity_job_type as enum ('WARNING', 'CLOSE');
create type support_vnext_shadow.inactivity_job_status as enum (
  'SCHEDULED', 'CLAIMED', 'CANCELLED', 'COMPLETED', 'SKIPPED'
);
create type support_vnext_shadow.flag_mode as enum ('OFF', 'SHADOW_ONLY', 'ENABLED');

create table support_vnext_shadow.support_ruleset_release (
  release_id uuid primary key,
  release_code text not null unique,
  release_sequence integer not null unique check (release_sequence > 0),
  scope_code text not null default 'SANTANA',
  status support_vnext_shadow.ruleset_status not null default 'DRAFT',
  parent_release_id uuid null references support_vnext_shadow.support_ruleset_release(release_id),
  effective_from timestamptz not null,
  effective_to timestamptz null,
  content_hash char(64) not null check (content_hash ~ '^[A-Fa-f0-9]{64}$'),
  change_summary text not null,
  approved_at timestamptz null,
  approved_by text null,
  published_at timestamptz null,
  published_by text null,
  revocation_mode text null check (revocation_mode is null or revocation_mode in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW')),
  revoked_at timestamptz null,
  revoked_by text null,
  revocation_reason text null,
  replacement_release_id uuid null references support_vnext_shadow.support_ruleset_release(release_id),
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  row_version bigint not null default 1,
  check (effective_to is null or effective_to > effective_from),
  check ((status <> 'PUBLISHED') or (published_at is not null and published_by is not null)),
  check ((status <> 'REVOKED') or (revoked_at is not null and revoked_by is not null and revocation_reason is not null)),
  check ((revocation_mode <> 'EXPLICIT_REBIND') or replacement_release_id is not null)
);

create index support_ruleset_release_effective_idx
  on support_vnext_shadow.support_ruleset_release(scope_code, status, effective_from desc);
create index support_ruleset_release_parent_idx
  on support_vnext_shadow.support_ruleset_release(parent_release_id);

create table support_vnext_shadow.knowledge_source (
  source_id uuid primary key,
  logical_source_id uuid not null,
  source_version integer not null check (source_version > 0),
  source_type text not null check (source_type in ('PDF','LEGISLATION','TARIFF','MANUAL','INSTITUTIONAL','CONSOLIDATION','LEGACY_WORKFLOW')),
  title text not null,
  reference text null,
  issuer text null,
  authority_level text not null check (authority_level in ('PRIMARY','INSTITUTIONAL','CONSOLIDATED','HISTORICAL','LEGACY')),
  source_date date null,
  received_at timestamptz not null default now(),
  content_hash char(64) null check (content_hash is null or content_hash ~ '^[A-Fa-f0-9]{64}$'),
  storage_bucket text null,
  storage_object_key text null,
  validation_status support_vnext_shadow.review_status not null default 'PENDING',
  supersedes_source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(),
  created_by text not null,
  reviewed_at timestamptz null,
  reviewed_by text null,
  unique (logical_source_id, source_version),
  unique (content_hash)
);

create table support_vnext_shadow.knowledge_service (
  service_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_service_id uuid not null,
  service_code text not null,
  public_name text not null,
  internal_name text not null,
  parent_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  availability_status text not null check (availability_status in ('ACTIVE','A_CONFIRMAR','RETIRED')),
  aliases text[] not null default '{}',
  scope_summary text not null,
  requires_location_type boolean not null default false,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, service_code),
  check (service_code <> 'OUVIDORIA')
);
create index knowledge_service_release_status_idx on support_vnext_shadow.knowledge_service(release_id, availability_status);
create index knowledge_service_aliases_idx on support_vnext_shadow.knowledge_service using gin(aliases);

create table support_vnext_shadow.knowledge_intent (
  intent_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_intent_id uuid not null,
  intent_code text not null,
  display_name text null,
  visibility text not null check (visibility in ('PUBLIC','INTERNAL','SYSTEM')),
  intent_kind text not null check (intent_kind in ('SERVICE','CONVERSATION','DOCUMENT','CONFIRMATION','COMPLAINT','SYSTEM')),
  aliases text[] not null default '{}',
  description text not null,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, intent_code),
  check (intent_code <> 'OUVIDORIA'),
  check ((intent_code <> 'RECLAMACAO_INTERNA') or (visibility = 'INTERNAL' and intent_kind = 'COMPLAINT'))
);
create index knowledge_intent_aliases_idx on support_vnext_shadow.knowledge_intent using gin(aliases);

create table support_vnext_shadow.knowledge_condition (
  condition_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_condition_id uuid not null,
  condition_code text not null,
  service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  condition_type text not null,
  human_summary text not null,
  predicate_schema jsonb not null,
  resulting_fact text null,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, condition_code),
  check (jsonb_typeof(predicate_schema) = 'object')
);
create index knowledge_condition_service_idx on support_vnext_shadow.knowledge_condition(release_id, service_id, condition_type);

create table support_vnext_shadow.knowledge_asset (
  asset_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_asset_id uuid not null,
  asset_code text not null,
  asset_kind text not null check (asset_kind in ('PDF','FORM','IMAGE','LINK','QR_CODE','TERM')),
  title text not null,
  storage_bucket text not null,
  storage_object_key text not null,
  sha256 char(64) not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  language_code text not null default 'pt-BR',
  access_scope text not null check (access_scope in ('INTERNAL','CITIZEN_SENDABLE')),
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  source_version_label text null,
  published_url text null,
  effective_from date not null,
  effective_to date null,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, asset_code),
  unique (storage_bucket, storage_object_key),
  check (effective_to is null or effective_to > effective_from)
);
create index knowledge_asset_hash_idx on support_vnext_shadow.knowledge_asset(sha256);

create table support_vnext_shadow.knowledge_document_requirement (
  document_requirement_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_requirement_id uuid not null,
  requirement_code text not null,
  service_id uuid not null references support_vnext_shadow.knowledge_service(service_id),
  condition_id uuid null references support_vnext_shadow.knowledge_condition(condition_id),
  document_code text not null,
  display_name text not null,
  requirement_level text not null check (requirement_level in ('REQUIRED','CONDITIONAL','INFORMATIONAL')),
  purpose text not null,
  official_description text not null,
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  source_locator text null,
  asset_id uuid null references support_vnext_shadow.knowledge_asset(asset_id),
  effective_from date not null,
  effective_to date null,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, requirement_code),
  check ((requirement_level <> 'CONDITIONAL') or condition_id is not null),
  check (effective_to is null or effective_to > effective_from)
);
create index knowledge_document_requirement_service_idx on support_vnext_shadow.knowledge_document_requirement(release_id, service_id);

create table support_vnext_shadow.knowledge_price (
  price_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_price_id uuid not null,
  price_code text not null,
  service_id uuid not null references support_vnext_shadow.knowledge_service(service_id),
  location_type text null check (location_type is null or location_type in ('QUADRA_GERAL','JAZIGO','OSSUARIO')),
  condition_id uuid null references support_vnext_shadow.knowledge_condition(condition_id),
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null default 'BRL' check (currency = 'BRL'),
  price_basis text not null check (price_basis in ('TOTAL','COMPONENT','RECURRING','FEE')),
  billing_interval text null check (billing_interval is null or billing_interval in ('ONCE','MONTH','YEAR','FIVE_YEARS','INDETERMINATE')),
  display_group text not null,
  display_order smallint not null default 0,
  effective_from date not null,
  effective_to date null,
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  source_locator text null,
  is_public boolean not null default true,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, price_code),
  check (effective_to is null or effective_to > effective_from)
);
create index knowledge_price_scope_idx on support_vnext_shadow.knowledge_price(release_id, service_id, location_type, effective_from desc);
create index knowledge_price_display_idx on support_vnext_shadow.knowledge_price(release_id, display_group, display_order);

create table support_vnext_shadow.knowledge_hours (
  hours_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  hours_code text not null,
  service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  location_scope text not null default 'SANTANA',
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time null,
  closes_at time null,
  is_closed boolean not null default false,
  effective_from date not null,
  effective_to date null,
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, hours_code, weekday, effective_from),
  check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at)),
  check (effective_to is null or effective_to > effective_from)
);

create table support_vnext_shadow.knowledge_hours_exception (
  hours_exception_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  hours_id uuid not null references support_vnext_shadow.knowledge_hours(hours_id),
  exception_date date not null,
  is_closed boolean not null,
  opens_at time null,
  closes_at time null,
  source_id uuid not null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  unique (hours_id, exception_date),
  check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at))
);

create table support_vnext_shadow.knowledge_message_template (
  template_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_template_id uuid not null,
  template_code text not null,
  channel text not null default 'WHATSAPP' check (channel = 'WHATSAPP'),
  locale text not null default 'pt-BR',
  template_kind text not null,
  render_mode text not null check (render_mode in ('DETERMINISTIC','FIELD_TEMPLATE','GEMINI_ALLOWED')),
  body text not null,
  variable_schema jsonb not null default '{}'::jsonb,
  allowed_fact_types text[] not null default '{}',
  is_critical boolean not null default false,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, template_code, channel, locale),
  check (jsonb_typeof(variable_schema) = 'object'),
  check (not is_critical or render_mode <> 'GEMINI_ALLOWED')
);

create table support_vnext_shadow.decision_handoff_policy (
  handoff_policy_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  policy_code text not null,
  scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  trigger_expression jsonb not null,
  requires_request boolean not null default false,
  automation_mode_after support_vnext_shadow.automation_mode not null,
  queue_code text null,
  message_template_id uuid null references support_vnext_shadow.knowledge_message_template(template_id),
  resume_mode text not null check (resume_mode in ('EXPLICIT_AGENT','EXPLICIT_POLICY','NONE')),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, policy_code),
  check (jsonb_typeof(trigger_expression) = 'object')
);

create table support_vnext_shadow.decision_request_policy (
  request_policy_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  policy_code text not null,
  scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  request_category_code text not null,
  subject_template_id uuid not null references support_vnext_shadow.knowledge_message_template(template_id),
  confirmation_required boolean not null default true check (confirmation_required),
  confirmation_template_id uuid not null references support_vnext_shadow.knowledge_message_template(template_id),
  confirmation_expiry_policy jsonb not null,
  required_data_schema jsonb not null default '{}'::jsonb,
  required_document_requirement_ids uuid[] not null default '{}',
  allow_create boolean not null default false,
  -- No default protocol format is invented. A policy that creates requests must publish both values.
  protocol_scope text null,
  protocol_prefix text null,
  idempotency_scope text not null default 'SESSION_TOPIC_PROPOSAL' check (idempotency_scope = 'SESSION_TOPIC_PROPOSAL'),
  handoff_policy_id uuid null references support_vnext_shadow.decision_handoff_policy(handoff_policy_id),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, policy_code),
  check (jsonb_typeof(confirmation_expiry_policy) = 'object'),
  check (jsonb_typeof(required_data_schema) = 'object'),
  check ((not allow_create) or (protocol_scope is not null and btrim(protocol_scope) <> '' and protocol_prefix is not null and btrim(protocol_prefix) <> ''))
);

create table support_vnext_shadow.decision_sla_policy (
  sla_policy_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  policy_code text not null,
  scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  trigger_event text not null,
  target_seconds integer not null check (target_seconds > 0),
  business_hours_id uuid null references support_vnext_shadow.knowledge_hours(hours_id),
  pause_conditions jsonb not null default '{}'::jsonb,
  breach_action text not null check (breach_action in ('LOG_ONLY','NOTIFY_HUMAN','ESCALATE')),
  message_template_id uuid null references support_vnext_shadow.knowledge_message_template(template_id),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, policy_code)
);

create table support_vnext_shadow.decision_conversation_policy (
  conversation_policy_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  policy_code text not null,
  event_type text not null check (event_type in ('FIRST_INBOUND','MENU','CONTINUATION','TOPIC_CHANGE','A_CONFIRMAR','HUMAN_ACTIVE','SESSION_CLOSED','DOCUMENT_RECEIVED')),
  scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  guard_expression jsonb not null default '{}'::jsonb,
  transition_type text not null check (transition_type in ('KEEP_TOPIC','START_TOPIC','CLOSE_TOPIC','CLOSE_SESSION','NO_CHANGE')),
  preserve_history boolean not null default true,
  close_active_topic boolean not null default false,
  message_template_id uuid null references support_vnext_shadow.knowledge_message_template(template_id),
  fallback_mode text not null check (fallback_mode in ('ASK_CLARIFICATION','HUMAN_HANDOFF','NO_ACTION')),
  priority integer not null default 100 check (priority >= 0),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, policy_code)
);

create table support_vnext_shadow.decision_session_policy (
  session_policy_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  policy_code text not null,
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  warning_after_seconds integer not null check (warning_after_seconds = 180),
  close_after_warning_seconds integer not null check (close_after_warning_seconds = 120),
  suppress_when_human_active boolean not null default true,
  suppress_when_request_active boolean not null default true,
  new_inbound_after_close text not null check (new_inbound_after_close = 'CREATE_NEW_SESSION'),
  warning_template_id uuid not null references support_vnext_shadow.knowledge_message_template(template_id),
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, policy_code)
);

create table support_vnext_shadow.decision_rule (
  decision_rule_id uuid primary key,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  logical_rule_id uuid not null,
  rule_code text not null,
  priority integer not null check (priority >= 0),
  enabled boolean not null default true,
  scope_intent_id uuid null references support_vnext_shadow.knowledge_intent(intent_id),
  scope_service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  scope_location_type text null check (scope_location_type is null or scope_location_type in ('QUADRA_GERAL','JAZIGO','OSSUARIO')),
  when_expression jsonb not null,
  then_plan jsonb not null,
  stop_processing boolean not null default false,
  reason_code text not null,
  record_status support_vnext_shadow.record_status not null default 'DRAFT',
  source_id uuid null references support_vnext_shadow.knowledge_source(source_id),
  created_at timestamptz not null default now(), created_by text not null,
  reviewed_at timestamptz null, reviewed_by text null,
  approved_at timestamptz null, approved_by text null,
  retired_at timestamptz null, retired_by text null, audit_reason text null,
  unique (release_id, rule_code),
  check (jsonb_typeof(when_expression) = 'object'),
  check (jsonb_typeof(then_plan) = 'object')
);
create index decision_rule_resolution_idx on support_vnext_shadow.decision_rule(release_id, enabled, priority, scope_intent_id, scope_service_id);

create table support_vnext_shadow.conversation_sessions (
  session_id uuid primary key,
  conversation_id uuid not null,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  status support_vnext_shadow.session_status not null default 'ACTIVE',
  automation_mode support_vnext_shadow.automation_mode not null default 'BOT_ACTIVE',
  opened_at timestamptz not null default now(),
  last_inbound_at timestamptz null,
  warning_due_at timestamptz null,
  warning_sent_at timestamptz null,
  close_due_at timestamptz null,
  closed_at timestamptz null,
  close_reason text null,
  provider_window_expires_at timestamptz null,
  inactivity_generation bigint not null default 0,
  state_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, session_id),
  check ((status <> 'CLOSED') or closed_at is not null)
);
create unique index conversation_sessions_one_open_idx on support_vnext_shadow.conversation_sessions(conversation_id) where status <> 'CLOSED';
create index conversation_sessions_release_idx on support_vnext_shadow.conversation_sessions(release_id, status);

create table support_vnext_shadow.session_release_transitions (
  transition_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  from_release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  to_release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  reason text not null,
  initiated_by text not null,
  created_at timestamptz not null default now(),
  check (from_release_id <> to_release_id)
);

create table support_vnext_shadow.conversation_topics (
  topic_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  intent_id uuid not null references support_vnext_shadow.knowledge_intent(intent_id),
  service_id uuid null references support_vnext_shadow.knowledge_service(service_id),
  location_type text null check (location_type is null or location_type in ('QUADRA_GERAL','JAZIGO','OSSUARIO','NAO_INFORMADO','A_CONFIRMAR')),
  status support_vnext_shadow.topic_status not null default 'ACTIVE',
  collected_data jsonb not null default '{}'::jsonb,
  topic_version bigint not null default 1,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(collected_data) = 'object')
);
create unique index conversation_topics_one_active_idx on support_vnext_shadow.conversation_topics(session_id) where status = 'ACTIVE';

create table support_vnext_shadow.pending_questions (
  question_id uuid primary key,
  topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id),
  question_code text not null,
  question_template_id uuid null references support_vnext_shadow.knowledge_message_template(template_id),
  expected_answer_schema jsonb not null,
  asked_at timestamptz not null default now(),
  expires_at timestamptz null,
  status text not null check (status in ('OPEN','ANSWERED','EXPIRED','CANCELLED')),
  source_decision_id uuid null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(expected_answer_schema) = 'object')
);
create unique index pending_questions_one_open_idx on support_vnext_shadow.pending_questions(topic_id) where status = 'OPEN';

create table support_vnext_shadow.message_batches (
  batch_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  first_message_id uuid not null,
  last_message_id uuid not null,
  external_message_ids text[] not null,
  assembled_text text not null,
  attachments jsonb not null default '[]'::jsonb,
  quiet_seconds integer not null default 7 check (quiet_seconds = 7),
  status text not null check (status in ('OPEN','READY','CONSUMED','DUPLICATE')),
  created_at timestamptz not null default now(),
  unique (session_id, external_message_ids),
  check (jsonb_typeof(attachments) = 'array')
);

create table support_vnext_shadow.received_documents (
  received_document_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid null references support_vnext_shadow.conversation_topics(topic_id),
  inbound_message_id uuid null,
  storage_bucket text not null,
  storage_object_key text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 char(64) not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  technical_status text not null check (technical_status in ('RECEIVED','REJECTED_TECHNICAL','DUPLICATE')),
  human_review_status text not null check (human_review_status in ('NOT_REQUIRED','PENDING','SENT_TO_HUMAN','REVIEWED')),
  received_at timestamptz not null default now(),
  unique (session_id, sha256)
);

create table support_vnext_shadow.pending_confirmations (
  confirmation_id uuid primary key,
  confirmation_nonce uuid not null unique,
  conversation_id uuid not null,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id),
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  request_policy_id uuid not null references support_vnext_shadow.decision_request_policy(request_policy_id),
  proposal_snapshot jsonb not null,
  proposal_hash char(64) not null check (proposal_hash ~ '^[A-Fa-f0-9]{64}$'),
  status support_vnext_shadow.confirmation_status not null default 'PENDING',
  expires_at timestamptz not null,
  expected_state_version bigint not null,
  expected_topic_version bigint not null,
  confirmed_inbound_message_id uuid null,
  request_id uuid null,
  consumed_at timestamptz null,
  decision_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(proposal_snapshot) = 'object'),
  check (expires_at > created_at)
);
create unique index pending_confirmations_one_pending_idx on support_vnext_shadow.pending_confirmations(topic_id) where status = 'PENDING';
create index pending_confirmations_expiry_idx on support_vnext_shadow.pending_confirmations(status, expires_at) where status = 'PENDING';

create table support_vnext_shadow.service_requests (
  request_id uuid primary key,
  legacy_request_id uuid null,
  confirmation_id uuid not null unique references support_vnext_shadow.pending_confirmations(confirmation_id),
  conversation_id uuid not null,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid not null references support_vnext_shadow.conversation_topics(topic_id),
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  category_code text not null,
  subject text not null,
  request_payload jsonb not null default '{}'::jsonb,
  -- The command persists the request first, then allocates and writes the protocol in the same transaction.
  protocol text null unique,
  protocol_issued_at timestamptz null,
  idempotency_key char(64) not null unique check (idempotency_key ~ '^[A-Fa-f0-9]{64}$'),
  status text not null default 'OPEN' check (status in ('OPEN','WAITING_HUMAN','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(request_payload) = 'object'),
  check ((category_code <> 'RECLAMACAO') or not (request_payload ?| array['severity','gravidade','assigned_sector_id','sector','setor','setor_id','external_email','ouvidoria']))
);
create index service_requests_topic_idx on support_vnext_shadow.service_requests(topic_id, created_at desc);

create table support_vnext_shadow.handoffs (
  handoff_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid null references support_vnext_shadow.conversation_topics(topic_id),
  request_id uuid null references support_vnext_shadow.service_requests(request_id),
  handoff_policy_id uuid null references support_vnext_shadow.decision_handoff_policy(handoff_policy_id),
  status text not null check (status in ('PENDING','ACTIVE','COMPLETED','CANCELLED')),
  automation_mode_before support_vnext_shadow.automation_mode not null,
  automation_mode_after support_vnext_shadow.automation_mode not null,
  queue_code text null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  completed_at timestamptz null
);
create unique index handoffs_one_active_idx on support_vnext_shadow.handoffs(session_id) where status = 'ACTIVE';

create table support_vnext_shadow.inactivity_jobs (
  job_id uuid primary key,
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  generation bigint not null,
  job_type support_vnext_shadow.inactivity_job_type not null,
  due_at timestamptz not null,
  status support_vnext_shadow.inactivity_job_status not null default 'SCHEDULED',
  claimed_at timestamptz null,
  claimed_by text null,
  outbox_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, generation, job_type)
);
create index inactivity_jobs_due_idx on support_vnext_shadow.inactivity_jobs(status, due_at) where status = 'SCHEDULED';

create table support_vnext_shadow.state_events (
  event_id uuid primary key,
  occurred_at timestamptz not null default now(),
  correlation_id uuid not null,
  component text not null,
  component_version text not null,
  conversation_id uuid null,
  session_id uuid null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid null references support_vnext_shadow.conversation_topics(topic_id),
  release_id uuid null references support_vnext_shadow.support_ruleset_release(release_id),
  decision_id uuid null,
  event_type text not null,
  outcome text not null,
  metadata_redacted jsonb not null default '{}'::jsonb,
  payload_hash char(64) null check (payload_hash is null or payload_hash ~ '^[A-Fa-f0-9]{64}$'),
  actor_type text not null check (actor_type in ('SYSTEM','EDGE_FUNCTION','N8N','HUMAN','TEST')),
  check (jsonb_typeof(metadata_redacted) = 'object')
);
create index state_events_correlation_idx on support_vnext_shadow.state_events(correlation_id, occurred_at);
create index state_events_session_idx on support_vnext_shadow.state_events(session_id, occurred_at desc);

create table support_vnext_shadow.decision_plans (
  decision_id uuid primary key,
  correlation_id uuid not null,
  release_id uuid not null references support_vnext_shadow.support_ruleset_release(release_id),
  session_id uuid not null references support_vnext_shadow.conversation_sessions(session_id),
  topic_id uuid null references support_vnext_shadow.conversation_topics(topic_id),
  expected_state_version bigint not null,
  outcome text not null check (outcome in ('PERMITTED','BLOCKED','A_CONFIRMAR')),
  actions text[] not null default '{}',
  plan jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(plan) = 'object')
);
create index decision_plans_lookup_idx on support_vnext_shadow.decision_plans(session_id, created_at desc);

create table support_vnext_shadow.protocol_sequences (
  sequence_scope text primary key,
  current_value bigint not null default 0 check (current_value >= 0),
  updated_at timestamptz not null default now()
);

create table support_vnext_shadow.feature_flags (
  flag_key text primary key,
  description text not null,
  default_mode support_vnext_shadow.flag_mode not null default 'OFF',
  kill_switch boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table support_vnext_shadow.feature_flag_targets (
  target_id uuid primary key,
  flag_key text not null references support_vnext_shadow.feature_flags(flag_key),
  target_type text not null check (target_type in ('PHONE_HASH','CONVERSATION_ID','SERVICE_CODE','COMPONENT','RELEASE_ID','GLOBAL')),
  target_value text not null,
  mode support_vnext_shadow.flag_mode not null,
  release_id uuid null references support_vnext_shadow.support_ruleset_release(release_id),
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  created_at timestamptz not null default now(),
  created_by text not null,
  check (effective_to is null or effective_to > effective_from),
  unique (flag_key, target_type, target_value, effective_from)
);
create index feature_flag_targets_lookup_idx on support_vnext_shadow.feature_flag_targets(flag_key, target_type, target_value, effective_from desc);

create table support_vnext_shadow.shadow_comparisons (
  comparison_id uuid primary key,
  correlation_id uuid not null,
  conversation_id uuid null,
  session_id uuid null,
  release_id uuid null,
  legacy_summary jsonb not null default '{}'::jsonb,
  new_summary jsonb not null default '{}'::jsonb,
  difference_codes text[] not null default '{}',
  review_status text not null default 'PENDING' check (review_status in ('PENDING','MATCH','EXPECTED_DIFF','UNEXPECTED_DIFF')),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(legacy_summary) = 'object' and jsonb_typeof(new_summary) = 'object')
);
create index shadow_comparisons_review_idx on support_vnext_shadow.shadow_comparisons(review_status, created_at desc);

-- A release is a coherent snapshot. These composite constraints prevent a fact/policy from another
-- release from being referenced accidentally while retaining immutable UUID identity for audit.
alter table support_vnext_shadow.knowledge_service add constraint knowledge_service_release_id_unique unique (release_id, service_id);
alter table support_vnext_shadow.knowledge_intent add constraint knowledge_intent_release_id_unique unique (release_id, intent_id);
alter table support_vnext_shadow.knowledge_condition add constraint knowledge_condition_release_id_unique unique (release_id, condition_id);
alter table support_vnext_shadow.knowledge_asset add constraint knowledge_asset_release_id_unique unique (release_id, asset_id);
alter table support_vnext_shadow.knowledge_document_requirement add constraint knowledge_document_requirement_release_id_unique unique (release_id, document_requirement_id);
alter table support_vnext_shadow.knowledge_price add constraint knowledge_price_release_id_unique unique (release_id, price_id);
alter table support_vnext_shadow.knowledge_hours add constraint knowledge_hours_release_id_unique unique (release_id, hours_id);
alter table support_vnext_shadow.knowledge_message_template add constraint knowledge_message_template_release_id_unique unique (release_id, template_id);
alter table support_vnext_shadow.decision_handoff_policy add constraint decision_handoff_policy_release_id_unique unique (release_id, handoff_policy_id);
alter table support_vnext_shadow.decision_request_policy add constraint decision_request_policy_release_id_unique unique (release_id, request_policy_id);
alter table support_vnext_shadow.decision_sla_policy add constraint decision_sla_policy_release_id_unique unique (release_id, sla_policy_id);
alter table support_vnext_shadow.decision_conversation_policy add constraint decision_conversation_policy_release_id_unique unique (release_id, conversation_policy_id);
alter table support_vnext_shadow.decision_session_policy add constraint decision_session_policy_release_id_unique unique (release_id, session_policy_id);
alter table support_vnext_shadow.decision_rule add constraint decision_rule_release_id_unique unique (release_id, decision_rule_id);

alter table support_vnext_shadow.knowledge_service
  add constraint knowledge_service_parent_same_release foreign key (release_id, parent_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id);
alter table support_vnext_shadow.knowledge_condition
  add constraint knowledge_condition_service_same_release foreign key (release_id, service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id);
alter table support_vnext_shadow.knowledge_document_requirement
  add constraint knowledge_document_requirement_service_same_release foreign key (release_id, service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint knowledge_document_requirement_condition_same_release foreign key (release_id, condition_id)
  references support_vnext_shadow.knowledge_condition(release_id, condition_id),
  add constraint knowledge_document_requirement_asset_same_release foreign key (release_id, asset_id)
  references support_vnext_shadow.knowledge_asset(release_id, asset_id);
alter table support_vnext_shadow.knowledge_price
  add constraint knowledge_price_service_same_release foreign key (release_id, service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint knowledge_price_condition_same_release foreign key (release_id, condition_id)
  references support_vnext_shadow.knowledge_condition(release_id, condition_id);
alter table support_vnext_shadow.knowledge_hours
  add constraint knowledge_hours_service_same_release foreign key (release_id, service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id);
alter table support_vnext_shadow.knowledge_hours_exception
  add constraint knowledge_hours_exception_hours_same_release foreign key (release_id, hours_id)
  references support_vnext_shadow.knowledge_hours(release_id, hours_id);
alter table support_vnext_shadow.decision_handoff_policy
  add constraint decision_handoff_intent_same_release foreign key (release_id, scope_intent_id)
  references support_vnext_shadow.knowledge_intent(release_id, intent_id),
  add constraint decision_handoff_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint decision_handoff_template_same_release foreign key (release_id, message_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id);
alter table support_vnext_shadow.decision_request_policy
  add constraint decision_request_intent_same_release foreign key (release_id, scope_intent_id)
  references support_vnext_shadow.knowledge_intent(release_id, intent_id),
  add constraint decision_request_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint decision_request_subject_template_same_release foreign key (release_id, subject_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id),
  add constraint decision_request_confirmation_template_same_release foreign key (release_id, confirmation_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id),
  add constraint decision_request_handoff_same_release foreign key (release_id, handoff_policy_id)
  references support_vnext_shadow.decision_handoff_policy(release_id, handoff_policy_id);
alter table support_vnext_shadow.decision_sla_policy
  add constraint decision_sla_intent_same_release foreign key (release_id, scope_intent_id)
  references support_vnext_shadow.knowledge_intent(release_id, intent_id),
  add constraint decision_sla_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint decision_sla_hours_same_release foreign key (release_id, business_hours_id)
  references support_vnext_shadow.knowledge_hours(release_id, hours_id),
  add constraint decision_sla_template_same_release foreign key (release_id, message_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id);
alter table support_vnext_shadow.decision_conversation_policy
  add constraint decision_conversation_intent_same_release foreign key (release_id, scope_intent_id)
  references support_vnext_shadow.knowledge_intent(release_id, intent_id),
  add constraint decision_conversation_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint decision_conversation_template_same_release foreign key (release_id, message_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id);
alter table support_vnext_shadow.decision_session_policy
  add constraint decision_session_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id),
  add constraint decision_session_template_same_release foreign key (release_id, warning_template_id)
  references support_vnext_shadow.knowledge_message_template(release_id, template_id);
alter table support_vnext_shadow.decision_rule
  add constraint decision_rule_intent_same_release foreign key (release_id, scope_intent_id)
  references support_vnext_shadow.knowledge_intent(release_id, intent_id),
  add constraint decision_rule_service_same_release foreign key (release_id, scope_service_id)
  references support_vnext_shadow.knowledge_service(release_id, service_id);

comment on schema support_vnext_shadow is 'FASE 5B.1 package. Isolated additive schema; service_* remains historical read-only comparison source only and is never a runtime fallback.';
