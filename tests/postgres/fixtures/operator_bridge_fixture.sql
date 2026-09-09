-- Isolated synthetic fixture only. Mirrors columns/constraints inspected on
-- 2026-09-09; never execute this file against a project with real data.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.support_members (
  user_id uuid primary key, display_name text not null, role text not null default 'agent',
  is_active boolean not null default true, approval_status text not null default 'approved',
  permissions text[] not null default array['atendimentos'::text]
);
create function public.is_support_member() returns boolean language sql stable as $$
  select exists(select 1 from public.support_members where user_id=auth.uid() and is_active);
$$;
alter table public.support_conversations add column human_takeover_at timestamptz;
alter table public.support_conversations add column closed_at timestamptz;
alter table public.support_conversations add column awaiting_response_since timestamptz;
alter table public.support_conversations add column response_due_at timestamptz;
alter table public.support_conversations drop constraint support_conversations_subject_check;
alter table public.support_conversations add constraint support_conversations_subject_check
  check(subject in ('nao_classificado','obito_jazigo','exumacao','recadastro','ossuario','concessao','comercial','atendimento_humano'));
alter table public.support_documents drop constraint support_documents_status_check;
alter table public.support_documents add constraint support_documents_status_check
  check(status in ('pending','approved','rejected','requested_new'));
alter table public.support_documents add constraint support_documents_reviewed_by_fkey
  foreign key(reviewed_by) references public.support_members(user_id);
create sequence public.support_service_request_protocol_seq;
create table public.support_service_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id),
  protocol text not null unique, subject text not null,
  status text not null default 'pending_review' check(status in ('pending_review','waiting_human','in_review','approved','rejected','cancelled','completed')),
  summary text not null,snapshot jsonb not null default '{}'::jsonb,idempotency_key text not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  priority text not null default 'normal' check(priority in ('normal','high','urgent')),
  responsible_sector text not null default 'Administração',assigned_to uuid,
  opened_by uuid references public.support_members(user_id),due_at timestamptz,closed_at timestamptz,
  reopened_at timestamptz,resolution_note text,topic_id uuid,
  unique(conversation_id,idempotency_key)
);
create table public.support_events(
  id uuid primary key default gen_random_uuid(),conversation_id uuid,event_type text,
  description text,actor_id uuid,data jsonb
);
create table public.support_conversation_topics(
  id uuid primary key default gen_random_uuid(),conversation_id uuid,
  is_active boolean default true,status text default 'collecting',request_id uuid,
  closed_at timestamptz,updated_at timestamptz
);
grant select on public.support_members to authenticated;
grant select,update on public.support_conversations,public.support_conversation_topics to authenticated;
grant insert on public.support_events to authenticated;
grant usage on schema auth to authenticated;
create policy operator_fixture_select on public.support_conversations for select to authenticated using(true);
create policy operator_fixture_update on public.support_conversations for update to authenticated using(true) with check(true);

create function public.support_business_deadline(p_days integer) returns timestamptz
language plpgsql stable set search_path='' as $$
declare v_date date:=(now() at time zone 'America/Sao_Paulo')::date; v_added integer:=0;
begin
  if p_days is null or p_days<0 or p_days>30 then raise exception 'Invalid business-day interval';end if;
  while v_added<p_days loop v_date:=v_date+1; if extract(isodow from v_date) between 1 and 5 then v_added:=v_added+1;end if;end loop;
  return (v_date+time '17:00') at time zone 'America/Sao_Paulo';
end $$;
CREATE OR REPLACE FUNCTION public.support_service_request_apply_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.subject = 'comercial'
     and (new.responsible_sector is null
       or nullif(btrim(new.responsible_sector), '') is null
       or new.responsible_sector = 'Administração')
  then
    new.responsible_sector := 'Setor Comercial';
  elsif new.subject = 'concessao'
     and (new.responsible_sector is null
       or nullif(btrim(new.responsible_sector), '') is null
       or new.responsible_sector = 'Administração')
  then
    new.responsible_sector := 'Setor de Concessão';
  elsif new.responsible_sector is null
     or nullif(btrim(new.responsible_sector), '') is null
  then
    new.responsible_sector := 'Administração';
  end if;

  if new.due_at is null then
    new.due_at := case
      when new.priority = 'urgent' then now() + interval '4 hours'
      when new.subject = 'comercial' then now() + interval '24 hours'
      else public.support_business_deadline(5)
    end;
  end if;

  if new.status in ('completed', 'cancelled', 'rejected')
     and nullif(btrim(coalesce(new.resolution_note, '')), '') is null
  then
    raise exception 'Resolution note is required for final request statuses';
  end if;

  return new;
end;
$function$;
create trigger support_service_request_apply_defaults before insert or update of subject,priority,responsible_sector,due_at,status,resolution_note on public.support_service_requests for each row execute function public.support_service_request_apply_defaults();
