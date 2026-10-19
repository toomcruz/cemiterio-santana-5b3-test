begin;
create schema if not exists santana_batch_lab_private;
revoke all on schema santana_batch_lab_private from public;
grant usage on schema santana_batch_lab_private to anon,authenticated,service_role;
create table public.homolog_mcp_batch_lab_access(
 subject_id uuid primary key,operator_id uuid not null,is_active boolean not null default false,expires_at timestamptz not null);
alter table public.homolog_mcp_batch_lab_access enable row level security;
revoke all on public.homolog_mcp_batch_lab_access from public,anon,authenticated;
grant select on public.homolog_mcp_batch_lab_access to service_role;
create table public.homolog_mcp_batch_lab_receipts(
 receipt_id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.homolog_mcp_batch_lab_access(subject_id),
 operator_id uuid not null,session_id uuid not null,batch_id uuid not null,manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
 challenge_nonce text not null check(length(challenge_nonce) between 40 and 100),
 auth_time timestamptz not null,reviewed_at timestamptz not null default now(),expires_at timestamptz not null,
 recipient_count integer not null check(recipient_count between 1 and 50),revoked boolean not null default false,
 unique(subject_id,batch_id,manifest_sha256,challenge_nonce));
alter table public.homolog_mcp_batch_lab_receipts enable row level security;
revoke all on public.homolog_mcp_batch_lab_receipts from public,anon,authenticated;
grant select,insert on public.homolog_mcp_batch_lab_receipts to service_role;
-- Capability lookup: UUID + 256-bit nonce + exact digest; no table enumeration.
-- SECURITY DEFINER is restricted to this non-exposed schema and returns only
-- the scoped LAB approval, after checking current operator/grant/session.
create function santana_batch_lab_private.proof(p_receipt uuid,p_nonce text,p_sha text) returns jsonb
language sql security definer set search_path=pg_catalog as $$
 select jsonb_build_object('status','verified','receipt_id',r.receipt_id,'batch_id',r.batch_id,
 'subject',r.subject_id,'operator',r.operator_id,'session',r.session_id,'manifest_sha256',r.manifest_sha256,
 'expires_at',extract(epoch from least(r.expires_at,a.expires_at)),'auth_time',extract(epoch from r.auth_time),
 'capability','lab_fixture_simulation_only','production_write_authorized',false)
 from public.homolog_mcp_batch_lab_receipts r
 join public.homolog_mcp_batch_lab_access a on a.subject_id=r.subject_id and a.operator_id=r.operator_id
 join public.homolog_mcp_operators o on o.user_id=r.subject_id
 join auth.sessions s on s.id=r.session_id and s.user_id=r.subject_id
 where length(p_nonce) between 40 and 100 and p_sha~'^[a-f0-9]{64}$'
 and r.receipt_id=p_receipt and r.challenge_nonce=p_nonce and r.manifest_sha256=p_sha
 and not r.revoked and a.is_active and o.is_active and a.expires_at>clock_timestamp()
 and r.expires_at>clock_timestamp() and r.auth_time>clock_timestamp()-interval '10 minutes'
 and (s.not_after is null or s.not_after>clock_timestamp());
$$;
revoke all on function santana_batch_lab_private.proof(uuid,text,text) from public;
grant execute on function santana_batch_lab_private.proof(uuid,text,text) to anon,authenticated,service_role;
create function public.sana_mcp_batch_lab_receipt_proof(p_receipt uuid,p_nonce text,p_sha text) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select coalesce(santana_batch_lab_private.proof(p_receipt,p_nonce,p_sha),jsonb_build_object('status','not_available'));
$$;
revoke all on function public.sana_mcp_batch_lab_receipt_proof(uuid,text,text) from public;
grant execute on function public.sana_mcp_batch_lab_receipt_proof(uuid,text,text) to anon,authenticated,service_role;
commit;
