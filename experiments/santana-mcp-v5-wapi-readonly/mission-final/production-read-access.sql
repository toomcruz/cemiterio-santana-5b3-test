begin;
create table public.sana_mcp_read_access (
 issuer text not null check(issuer='https://xdccjulfqcqefykunwtg.supabase.co/auth/v1'),subject_id uuid not null,client_id uuid not null,
 operator_id uuid not null references public.support_members(user_id),conversation_id uuid not null references public.sana_conversations(conversation_id),
 scopes text[] not null,is_active boolean not null default true,expires_at timestamptz not null,created_at timestamptz not null default now(),
 primary key(issuer,subject_id,client_id,conversation_id),
 check(scopes<@array['santana.conversations.read','santana.messages.read_metadata','santana.messages.read_content','santana.files.read_metadata']::text[])
);
create table public.sana_mcp_read_quota(subject_id uuid not null,client_id uuid not null,window_start timestamptz not null,hits integer not null,primary key(subject_id,client_id,window_start));
create table public.sana_mcp_read_audit(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),subject_id uuid not null,client_id uuid not null,operator_id uuid not null,operation text not null,conversation_id uuid,item_count integer not null,outcome text not null);
alter table public.sana_mcp_read_access enable row level security;
alter table public.sana_mcp_read_quota enable row level security;
alter table public.sana_mcp_read_audit enable row level security;
revoke all on public.sana_mcp_read_access,public.sana_mcp_read_quota,public.sana_mcp_read_audit from public,anon,authenticated;
grant select,insert,update,delete on public.sana_mcp_read_access,public.sana_mcp_read_quota,public.sana_mcp_read_audit to service_role;
create function public.sana_mcp_read_rate_check(p_subject uuid,p_client uuid,p_limit integer) returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare n integer;begin
 if p_limit not between 1 and 30 then return false;end if;
 insert into public.sana_mcp_read_quota(subject_id,client_id,window_start,hits) values(p_subject,p_client,date_trunc('minute',now()),1)
 on conflict(subject_id,client_id,window_start) do update set hits=public.sana_mcp_read_quota.hits+1 returning hits into n;
 return n<=p_limit;
end $$;
revoke all on function public.sana_mcp_read_rate_check(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.sana_mcp_read_rate_check(uuid,uuid,integer) to service_role;
insert into public.sana_mcp_read_access(issuer,subject_id,client_id,operator_id,conversation_id,scopes,expires_at) values
('https://xdccjulfqcqefykunwtg.supabase.co/auth/v1','3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','789ea855-4e5e-5767-aae8-1316129c2ddc',array['santana.conversations.read','santana.messages.read_metadata','santana.messages.read_content','santana.files.read_metadata'],now()+interval '7 days');
commit;
