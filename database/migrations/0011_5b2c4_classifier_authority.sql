-- C4-R5B: classifier assertions are independently verifiable from service_role.
-- Authority secrets are provisioned outside this repository. Missing authority fails closed.
begin;

create table support_vnext_shadow.classifier_authorities (
  authority_key_id uuid primary key,
  authority_name text not null unique,
  verifier_secret text not null,
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz null,
  created_at timestamptz not null default now(),
  created_by text not null,
  check (valid_to is null or valid_to > valid_from)
);
alter table support_vnext_shadow.classifier_authorities enable row level security;

alter table support_vnext_shadow.inbound_messages
  add column content_hash char(64),
  add column content_hash_version text not null default 'INBOUND_CONTENT_V1';
alter table support_vnext_shadow.inbound_messages
  add constraint inbound_messages_content_hash_ck check (content_hash ~ '^[A-Fa-f0-9]{64}$');
alter table support_vnext_shadow.inbound_messages alter column content_hash set not null;

alter table support_vnext_shadow.inbound_classifications
  add column inbound_content_hash char(64),
  add column classifier_version text,
  add column authority_key_id uuid references support_vnext_shadow.classifier_authorities(authority_key_id) on delete restrict,
  add column authority_nonce uuid,
  add column authority_assertion_hash char(64);
alter table support_vnext_shadow.inbound_classifications
  add constraint inbound_classifications_content_hash_ck check (inbound_content_hash ~ '^[A-Fa-f0-9]{64}$'),
  add constraint inbound_classifications_assertion_hash_ck check (authority_assertion_hash is null or authority_assertion_hash ~ '^[A-Fa-f0-9]{64}$');
create unique index inbound_classification_authority_nonce_uq
  on support_vnext_shadow.inbound_classifications(authority_key_id,authority_nonce)
  where authority_key_id is not null and authority_nonce is not null;

create or replace function support_vnext_shadow.classifier_assertion_material(
  p_inbound_message_id uuid,p_content_hash char(64),p_confirmation_id uuid,p_session_id uuid,
  p_topic_id uuid,p_release_id uuid,p_classification_code text,p_classification_status text,
  p_classifier_version text,p_authority_nonce uuid
) returns char(64)
language sql immutable set search_path=pg_catalog,support_vnext_shadow as $$
  select support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object(
    'assertion_version','CLASSIFIER_ASSERTION_V1','inbound_message_id',p_inbound_message_id,
    'content_hash',p_content_hash,'confirmation_id',p_confirmation_id,'session_id',p_session_id,
    'topic_id',p_topic_id,'release_id',p_release_id,'classification_code',p_classification_code,
    'classification_status',p_classification_status,'classifier_version',p_classifier_version,
    'authority_nonce',p_authority_nonce)) $$;

create or replace function support_vnext_shadow.persist_shadow_inbound_message(
  p_inbound_message_id uuid,p_session_id uuid,p_topic_id uuid,p_release_id uuid,p_content text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; d char(64); ch char(64);
begin
  if p_content is null then raise exception 'inbound content is required' using errcode='22023'; end if;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if s.session_id is null or t.topic_id is null or s.release_id<>p_release_id or t.session_id<>s.session_id or s.status='CLOSED' then raise exception 'inbound state/release mismatch' using errcode='22023'; end if;
  ch:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('content_hash_version','INBOUND_CONTENT_V1','content',p_content));
  d:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('inbound_message_id',p_inbound_message_id,'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,'content_hash',ch));
  insert into support_vnext_shadow.inbound_messages(inbound_message_id,session_id,topic_id,release_id,message_digest,content_hash)
  values(p_inbound_message_id,p_session_id,p_topic_id,p_release_id,d,ch)
  on conflict(inbound_message_id) do nothing;
  if not exists(select 1 from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id and session_id=p_session_id and topic_id=p_topic_id and release_id=p_release_id and content_hash=ch) then raise exception 'inbound id already belongs to different state or content' using errcode='22023'; end if;
  return jsonb_build_object('inbound_message_id',p_inbound_message_id,'content_hash',ch,'status','PERSISTED');
end $$;
drop function if exists support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid);

create or replace function support_vnext_shadow.guard_inbound_message_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'persisted inbound content is immutable' using errcode='55000';
end $$;
drop trigger if exists trg_inbound_message_immutable on support_vnext_shadow.inbound_messages;
create trigger trg_inbound_message_immutable before update or delete on support_vnext_shadow.inbound_messages
for each row execute function support_vnext_shadow.guard_inbound_message_immutable();

create or replace function support_vnext_shadow.persist_inbound_classification(
  p_classification_id uuid,p_inbound_message_id uuid,p_confirmation_id uuid,p_session_id uuid,p_topic_id uuid,p_release_id uuid,
  p_classification_code text,p_classification_status text,p_source text,p_classifier_version text,
  p_authority_key_id uuid,p_authority_nonce uuid,p_authority_assertion text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare s support_vnext_shadow.conversation_sessions; t support_vnext_shadow.conversation_topics; i support_vnext_shadow.inbound_messages;
  c support_vnext_shadow.pending_confirmations; a support_vnext_shadow.classifier_authorities; h char(64); material char(64); expected text;
begin
  if p_classification_code not in ('CONFIRMATION_AFFIRMATIVE','OTHER') or p_classification_status not in ('OK','AMBIGUOUS','BLOCKED') or p_source<>'DETERMINISTIC' or coalesce(btrim(p_classifier_version),'')='' then raise exception 'invalid persisted classifier result' using errcode='22023'; end if;
  select * into i from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id for share;
  select * into s from support_vnext_shadow.conversation_sessions where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics where topic_id=p_topic_id for share;
  if i.inbound_message_id is null or s.session_id is null or t.topic_id is null or i.session_id<>p_session_id or i.topic_id<>p_topic_id or i.release_id<>p_release_id or s.release_id<>p_release_id or t.session_id<>p_session_id or s.status='CLOSED' then raise exception 'classification does not belong to persisted inbound/state' using errcode='22023'; end if;
  if p_classification_code='CONFIRMATION_AFFIRMATIVE' then
    select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id for share;
    select * into a from support_vnext_shadow.classifier_authorities where authority_key_id=p_authority_key_id and active and valid_from<=now() and (valid_to is null or valid_to>now()) for share;
    if c.confirmation_id is null or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id or a.authority_key_id is null or p_authority_nonce is null or coalesce(p_authority_assertion,'') !~ '^[A-Fa-f0-9]{64}$' then raise exception 'affirmative classifier authority is invalid' using errcode='22023'; end if;
    material:=support_vnext_shadow.classifier_assertion_material(p_inbound_message_id,i.content_hash,p_confirmation_id,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,p_classifier_version,p_authority_nonce);
    expected:=encode(extensions.hmac(material,a.verifier_secret,'sha256'),'hex');
    if lower(p_authority_assertion)<>expected then raise exception 'classifier assertion verification failed' using errcode='22023'; end if;
  elsif p_confirmation_id is not null or p_authority_key_id is not null or p_authority_nonce is not null or p_authority_assertion is not null then
    raise exception 'non-affirmative classification cannot carry authority evidence' using errcode='22023';
  end if;
  h:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object('classification_id',p_classification_id,'inbound_message_id',p_inbound_message_id,'content_hash',i.content_hash,'confirmation_id',p_confirmation_id,'session_id',p_session_id,'topic_id',p_topic_id,'release_id',p_release_id,'classification_code',p_classification_code,'classification_status',p_classification_status,'source',p_source,'classifier_version',p_classifier_version,'authority_key_id',p_authority_key_id,'authority_nonce',p_authority_nonce));
  insert into support_vnext_shadow.inbound_classifications(classification_id,inbound_message_id,confirmation_id,session_id,topic_id,release_id,classification_code,classification_status,source,classification_hash,inbound_content_hash,classifier_version,authority_key_id,authority_nonce,authority_assertion_hash)
  values(p_classification_id,p_inbound_message_id,p_confirmation_id,p_session_id,p_topic_id,p_release_id,p_classification_code,p_classification_status,p_source,h,i.content_hash,p_classifier_version,p_authority_key_id,p_authority_nonce,case when p_authority_assertion is null then null else encode(extensions.digest(lower(p_authority_assertion),'sha256'),'hex')::char(64) end);
  return jsonb_build_object('classification_id',p_classification_id,'classification_hash',h,'content_hash',i.content_hash,'status','PERSISTED');
end $$;
drop function if exists support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text);

create or replace function support_vnext_shadow.guard_inbound_classification_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'classification evidence is immutable' using errcode='55000'; end if;
  if old.inbound_message_id is distinct from new.inbound_message_id or old.confirmation_id is distinct from new.confirmation_id or old.session_id is distinct from new.session_id or old.topic_id is distinct from new.topic_id or old.release_id is distinct from new.release_id or old.classification_code is distinct from new.classification_code or old.classification_status is distinct from new.classification_status or old.classification_hash is distinct from new.classification_hash or old.inbound_content_hash is distinct from new.inbound_content_hash or old.classifier_version is distinct from new.classifier_version or old.authority_key_id is distinct from new.authority_key_id or old.authority_nonce is distinct from new.authority_nonce or old.authority_assertion_hash is distinct from new.authority_assertion_hash then raise exception 'classification evidence is immutable' using errcode='55000'; end if;
  if old.status='VALID' and new.status='CONSUMED' and old.consumed_at is null and new.consumed_at is not null then return new; end if;
  raise exception 'classification status is immutable' using errcode='55000';
end $$;
drop trigger if exists trg_inbound_classification_immutable on support_vnext_shadow.inbound_classifications;
create trigger trg_inbound_classification_immutable before update or delete on support_vnext_shadow.inbound_classifications for each row execute function support_vnext_shadow.guard_inbound_classification_immutable();

create or replace function support_vnext_shadow.authorize_persisted_confirmation(p_classification_id uuid,p_confirmation_id uuid,p_confirmation_nonce uuid,p_inbound_message_id uuid,p_session_id uuid,p_topic_id uuid,p_release_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,support_vnext_shadow,extensions as $$
declare c support_vnext_shadow.pending_confirmations; cl support_vnext_shadow.inbound_classifications; i support_vnext_shadow.inbound_messages; a uuid:=extensions.gen_random_uuid();
begin
 select * into c from support_vnext_shadow.pending_confirmations where confirmation_id=p_confirmation_id and confirmation_nonce=p_confirmation_nonce for update;
 select * into cl from support_vnext_shadow.inbound_classifications where classification_id=p_classification_id for update;
 select * into i from support_vnext_shadow.inbound_messages where inbound_message_id=p_inbound_message_id for share;
 if c.confirmation_id is null or cl.classification_id is null or i.inbound_message_id is null or c.status<>'PENDING' or c.expires_at<=now() or cl.classification_code<>'CONFIRMATION_AFFIRMATIVE' or cl.classification_status<>'OK' or cl.status<>'VALID' or cl.consumed_at is not null or cl.confirmation_id<>c.confirmation_id or cl.inbound_message_id<>p_inbound_message_id or cl.inbound_content_hash<>i.content_hash or cl.authority_key_id is null or cl.authority_nonce is null or cl.authority_assertion_hash is null or cl.session_id<>p_session_id or cl.topic_id<>p_topic_id or cl.release_id<>p_release_id or c.session_id<>p_session_id or c.topic_id<>p_topic_id or c.release_id<>p_release_id then raise exception 'classification cannot authorize confirmation' using errcode='22023'; end if;
 insert into support_vnext_shadow.confirmation_authorizations(authorization_id,confirmation_id,inbound_message_id,session_id,topic_id,release_id,classification_hash,classification_code,classification_id) values(a,c.confirmation_id,p_inbound_message_id,p_session_id,p_topic_id,p_release_id,cl.classification_hash,'CONFIRMATION_AFFIRMATIVE',cl.classification_id);
 return jsonb_build_object('authorization_id',a,'classification_id',cl.classification_id,'classification_hash',cl.classification_hash,'status','AUTHORIZED');
end $$;

revoke all on function support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid,text),support_vnext_shadow.classifier_assertion_material(uuid,char(64),uuid,uuid,uuid,uuid,text,text,text,uuid),support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function support_vnext_shadow.persist_shadow_inbound_message(uuid,uuid,uuid,uuid,text),support_vnext_shadow.classifier_assertion_material(uuid,char(64),uuid,uuid,uuid,uuid,text,text,text,uuid),support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text),support_vnext_shadow.authorize_persisted_confirmation(uuid,uuid,uuid,uuid,uuid,uuid,uuid) to service_role;

commit;
