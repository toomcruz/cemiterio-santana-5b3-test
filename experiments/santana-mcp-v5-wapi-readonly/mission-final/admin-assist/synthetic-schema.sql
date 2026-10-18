-- In-memory test schema only. Never apply to an existing Supabase project.
create role anon;create role authenticated;create role service_role bypassrls;
create table public.support_members(user_id uuid primary key,role text,is_active boolean,approval_status text,permissions text[]);
create table public.sana_conversations(conversation_id uuid primary key,contact_key text,lifecycle text default 'closed',automation_mode text default 'human',revision integer default 1,state_json jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
create table public.sana_inbox_messages(message_key text primary key,conversation_id uuid,inbound_text text,response_text text,attachments jsonb default '[]',sender_role text default 'citizen',delivery_state text default 'received',external_message_id text,actor_id uuid,action_id uuid,no_send boolean default false,hidden boolean default false,created_at timestamptz default now(),settled_at timestamptz);
create table public.sana_outbox(outbox_id uuid primary key,conversation_id uuid,response_text text,delivery_state text,created_at timestamptz,settled_at timestamptz);
create table public.sana_operator_deliveries(outbox_id uuid,no_send boolean default false);
create table public.sana_message_audit(message_key text,outbox_id uuid,delivered_at timestamptz,conversation_id uuid,no_send boolean default false,status text,stage text,error_code text);
create table public.sana_cases(case_id uuid primary key,conversation_id uuid,service_family text,status text,revision integer,created_at timestamptz,updated_at timestamptz);
create table public.sana_documents(document_id uuid primary key,case_id uuid,provider_artifact_id text,document_type text,state text,created_at timestamptz);
create table public.support_access_audit(id bigint primary key,action text,target_id text,details jsonb,created_at timestamptz);
create table public.synthetic_quota(allowed boolean);insert into public.synthetic_quota values(true);
create function public.sana_mcp_read_rate_check(uuid,uuid,integer) returns boolean language sql as $$select allowed from public.synthetic_quota$$;
grant usage on schema public to service_role,anon,authenticated;
grant select on public.support_members,public.sana_conversations,public.sana_inbox_messages,public.sana_outbox,public.sana_operator_deliveries,public.sana_message_audit,public.sana_cases,public.sana_documents,public.support_access_audit,public.synthetic_quota to service_role;
