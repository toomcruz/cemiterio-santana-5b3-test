-- 5B.3-C: preserve the authoritative SHADOW_INBOUND provenance on inbound persistence.
begin;

create or replace function support_vnext_shadow.persist_shadow_inbound_message(
  p_inbound_message_id uuid,
  p_session_id uuid,
  p_topic_id uuid,
  p_release_id uuid,
  p_content text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,support_vnext_shadow,extensions
as $$
declare
  s support_vnext_shadow.conversation_sessions;
  t support_vnext_shadow.conversation_topics;
  d char(64);
  ch char(64);
begin
  if p_content is null then
    raise exception 'inbound content is required' using errcode='22023';
  end if;

  select * into s from support_vnext_shadow.conversation_sessions
   where session_id=p_session_id for share;
  select * into t from support_vnext_shadow.conversation_topics
   where topic_id=p_topic_id for share;

  if s.session_id is null or t.topic_id is null or s.release_id<>p_release_id
     or t.session_id<>s.session_id or s.status='CLOSED' then
    raise exception 'inbound state/release mismatch' using errcode='22023';
  end if;

  ch:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object(
    'content_hash_version','INBOUND_CONTENT_V1','content',p_content));
  d:=support_vnext_shadow.canonical_jsonb_sha256(jsonb_build_object(
    'inbound_message_id',p_inbound_message_id,'session_id',p_session_id,
    'topic_id',p_topic_id,'release_id',p_release_id,'content_hash',ch));

  insert into support_vnext_shadow.inbound_messages(
    inbound_message_id, session_id, topic_id, release_id,
    message_digest, content_hash, source
  ) values (
    p_inbound_message_id, p_session_id, p_topic_id, p_release_id,
    d, ch, 'SHADOW_INBOUND'
  )
  on conflict(inbound_message_id) do nothing;

  if not exists(
    select 1 from support_vnext_shadow.inbound_messages
     where inbound_message_id=p_inbound_message_id
       and session_id=p_session_id and topic_id=p_topic_id
       and release_id=p_release_id and content_hash=ch
       and source='SHADOW_INBOUND'
  ) then
    raise exception 'inbound id already belongs to different state or content' using errcode='22023';
  end if;

  return jsonb_build_object(
    'inbound_message_id',p_inbound_message_id,
    'content_hash',ch,'status','PERSISTED');
end
$$;

commit;
