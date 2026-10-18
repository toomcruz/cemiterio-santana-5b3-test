begin;
create table if not exists public.homolog_mcp_send_intents (
 id uuid primary key,owner_id uuid not null references auth.users(id),client_id text not null,
 idempotency_key uuid not null,payload jsonb not null,payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 attachment_base64 text,state text not null check(state in ('prepared','human_reviewed_dispatch_blocked')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),review_session_id uuid,reviewed_at timestamptz,
 unique(owner_id,client_id,idempotency_key),
 check((state='prepared' and reviewed_by is null and review_session_id is null and reviewed_at is null) or
 (state='human_reviewed_dispatch_blocked' and reviewed_by=owner_id and review_session_id is not null and reviewed_at is not null))
);
create table if not exists public.homolog_mcp_send_audit (
 id bigint generated always as identity primary key,owner_id uuid not null,intent_id uuid not null references public.homolog_mcp_send_intents(id),
 operation text not null check(operation in ('prepare','status','human_preview','human_review')),session_id uuid,created_at timestamptz not null default now()
);
alter table public.homolog_mcp_send_intents enable row level security;
alter table public.homolog_mcp_send_audit enable row level security;
revoke all on public.homolog_mcp_send_intents, public.homolog_mcp_send_audit from public,anon,authenticated;
grant select,insert,update on public.homolog_mcp_send_intents to service_role;
grant insert on public.homolog_mcp_send_audit to service_role;
grant usage,select on sequence public.homolog_mcp_send_audit_id_seq to service_role;
commit;
