-- Seeds the canonical IDs from tests/fixtures/ids.ts so the prepared P10
-- integration test (tests/integration/p10_a_confirmar_integration_test.ts) can
-- run against the isolated laboratory. Artificial data only; SHADOW_ONLY.
-- Idempotent: re-running it leaves the same rows.
\set ON_ERROR_STOP on
begin;

\ir ../_helpers.sql

do $$
declare
  v_release uuid := '11111111-1111-4111-8111-111111111111';
  v_conversation uuid := '44444444-4444-4444-8444-444444444444';
  v_session uuid := '55555555-5555-4555-8555-555555555555';
  v_topic uuid := '66666666-6666-4666-8666-666666666666';
  v_intent uuid := extensions.gen_random_uuid();
  n integer;
begin
  if not exists (select 1 from support_vnext_shadow.support_ruleset_release where release_id = v_release) then
    select coalesce(max(release_sequence),0)+1 into n from support_vnext_shadow.support_ruleset_release;
    insert into support_vnext_shadow.support_ruleset_release(
      release_id, release_code, release_sequence, scope_code, status, effective_from,
      content_hash, change_summary, approved_at, approved_by, created_by, updated_by)
    values (v_release,'P10-INTEGRATION',n,'P10_INTEGRATION_SCOPE','APPROVED',now()-interval '1 minute',
      repeat('0',64),'P10 integration fixture',now(),'p10-fixture','p10-fixture','p10-fixture');
    -- The topic coherence guard requires an intent bound to the same release,
    -- and published content is immutable, so seed it before publishing.
    insert into support_vnext_shadow.knowledge_intent(
      intent_id, release_id, logical_intent_id, intent_code, display_name,
      visibility, intent_kind, description, record_status, created_by)
    values (v_intent, v_release, extensions.gen_random_uuid(), 'P10_INTEGRATION',
      'P10 integration intent','INTERNAL','SERVICE','P10 integration fixture intent','PUBLISHED','p10-fixture');
    perform support_vnext_shadow.refresh_draft_release_content_hash(v_release,'p10-fixture');
    perform support_vnext_shadow.publish_ruleset_release(v_release,'p10-fixture');
  end if;
  select intent_id into v_intent from support_vnext_shadow.knowledge_intent where release_id=v_release limit 1;

  -- The release carries no decision_rule on purpose: the integration test asks
  -- for an unmatched intent/service and requires the A_CONFIRMAR fail-closed path.

  insert into support_vnext_shadow.conversation_sessions(session_id, conversation_id, release_id, status, automation_mode)
  values (v_session, v_conversation, v_release, 'ACTIVE', 'BOT_ACTIVE')
  on conflict (session_id) do nothing;

  insert into support_vnext_shadow.conversation_topics(topic_id, session_id, intent_id, status)
  values (v_topic, v_session, v_intent, 'WAITING_INPUT')
  on conflict (topic_id) do nothing;
end $$;

select pg_temp.assert_true(
  (select status='PUBLISHED' from support_vnext_shadow.support_ruleset_release where release_id='11111111-1111-4111-8111-111111111111'),
  'P10 fixture release is published');
select pg_temp.assert_true(
  exists(select 1 from support_vnext_shadow.conversation_sessions where session_id='55555555-5555-4555-8555-555555555555'),
  'P10 fixture session exists');
select pg_temp.assert_true(
  exists(select 1 from support_vnext_shadow.conversation_topics where topic_id='66666666-6666-4666-8666-666666666666'),
  'P10 fixture topic exists');

commit;
