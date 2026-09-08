-- Somente laboratório: réplica mínima do contrato de projeção que o painel
-- existente consome. Não é migration de produção e não contém dados reais.
begin;

create table if not exists public.support_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  external_id text unique,
  contact_name text not null,
  phone_e164 text not null,
  subject text not null default 'nao_classificado' check (subject in ('nao_classificado','exumacao','recadastro','ossuario','concessao','comercial','atendimento_humano')),
  stage text not null default 'novos' check (stage in ('novos','pendencias','documentos','aguardando','concluidos')),
  automation_mode text not null default 'bot' check (automation_mode in ('bot','human','closed')),
  queue_status text not null default 'inbox' check (queue_status in ('inbox','waiting_citizen','scheduled_return','closed')),
  unread_count integer not null default 0 check (unread_count >= 0),
  flow_state jsonb not null default '{}'::jsonb,
  last_inbound_at timestamptz null,
  last_outbound_at timestamptz null,
  last_message_at timestamptz not null default now(),
  return_at timestamptz null,
  return_reason text null,
  queue_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  sender_type text not null check (sender_type in ('citizen','agent','bot','system')),
  body text null,
  message_type text not null default 'text' check (message_type in ('text','image','document','audio','template','event')),
  external_message_id text unique,
  delivery_status text not null default 'received' check (delivery_status in ('queued','received','sent','delivered','read','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_conversation_created_idx on public.support_messages(conversation_id, created_at);

-- Espelho mínimo do acervo que o painel usa para abrir anexos. A presença do
-- registro representa somente arquivo armazenado; nunca equivale a documento
-- validado nem a solicitação criada.
create table if not exists public.support_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text null,
  document_type text null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  reviewed_by uuid null,
  review_notes text null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  topic_id uuid null
);
create index if not exists support_documents_conversation_created_idx
  on public.support_documents(conversation_id, created_at);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_documents enable row level security;
revoke all on public.support_conversations, public.support_messages, public.support_documents from public, anon, authenticated;
grant all on public.support_conversations, public.support_messages, public.support_documents to service_role;

commit;
