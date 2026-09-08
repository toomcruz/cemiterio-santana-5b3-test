-- Complemento idempotente para o laboratório já criado antes da inclusão do
-- espelho de documentos no fixture inicial. Não contém dados reais.
begin;

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

alter table public.support_documents enable row level security;
revoke all on public.support_documents from public, anon, authenticated;
grant all on public.support_documents to service_role;

commit;
