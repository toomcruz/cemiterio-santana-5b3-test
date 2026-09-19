-- LAB ONLY: minimal operator-bridge prerequisites for runtime qualification.
-- This fixture is never a production migration and contains no real data.
begin;

create table if not exists public.support_members (
  user_id uuid primary key,
  display_name text not null,
  role text not null default 'agent',
  is_active boolean not null default true,
  approval_status text not null default 'approved',
  permissions text[] not null default array['atendimentos'::text]
);

create or replace function public.is_support_member() returns boolean
language sql stable security invoker set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.support_members
    where user_id = auth.uid() and is_active and approval_status = 'approved'
  );
$$;

alter table public.support_conversations add column if not exists human_takeover_at timestamptz;
alter table public.support_conversations add column if not exists closed_at timestamptz;
alter table public.support_conversations add column if not exists awaiting_response_since timestamptz;
alter table public.support_conversations add column if not exists response_due_at timestamptz;

alter table public.support_documents drop constraint if exists support_documents_status_check;
alter table public.support_documents add constraint support_documents_status_check
  check (status in ('pending','approved','rejected','requested_new'));
alter table public.support_documents drop constraint if exists support_documents_reviewed_by_fkey;
alter table public.support_documents add constraint support_documents_reviewed_by_fkey
  foreign key (reviewed_by) references public.support_members(user_id);

create sequence if not exists public.support_service_request_protocol_seq;
create table if not exists public.support_service_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id),
  protocol text not null unique,
  subject text not null,
  status text not null default 'pending_review',
  summary text not null,
  snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  priority text not null default 'normal',
  responsible_sector text not null default 'Administração',
  assigned_to uuid,
  opened_by uuid references public.support_members(user_id),
  due_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  resolution_note text,
  topic_id uuid,
  unique (conversation_id, idempotency_key)
);

create table if not exists public.support_events (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id),
  event_type text,
  description text,
  actor_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.support_business_deadline(p_days integer) returns timestamptz
language plpgsql stable set search_path = public, pg_catalog as $$
declare v_date date := (now() at time zone 'America/Sao_Paulo')::date; v_added integer := 0;
begin
  if p_days is null or p_days < 0 or p_days > 30 then raise exception 'Invalid business-day interval'; end if;
  while v_added < p_days loop
    v_date := v_date + 1;
    if extract(isodow from v_date) between 1 and 5 then v_added := v_added + 1; end if;
  end loop;
  return (v_date + time '17:00') at time zone 'America/Sao_Paulo';
end $$;

create or replace function public.support_service_request_apply_defaults() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.subject = 'comercial' and (new.responsible_sector is null or btrim(new.responsible_sector) = ''
    or new.responsible_sector = 'Administração') then new.responsible_sector := 'Setor Comercial'; end if;
  if new.due_at is null then new.due_at := public.support_business_deadline(5); end if;
  return new;
end $$;

drop trigger if exists support_service_request_apply_defaults on public.support_service_requests;
create trigger support_service_request_apply_defaults
  before insert or update of subject, priority, responsible_sector, due_at
  on public.support_service_requests for each row
  execute function public.support_service_request_apply_defaults();

commit;
