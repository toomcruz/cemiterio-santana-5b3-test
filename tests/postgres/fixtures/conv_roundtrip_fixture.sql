-- Sessoes artificiais para o round-trip da 0020. Dados sinteticos; SHADOW_ONLY.
-- Idempotente: reexecutar deixa as mesmas linhas.
do $$
declare
  v_release uuid := '77777777-7777-4777-8777-777777777777';
  n integer;
  i integer;
begin
  if not exists (select 1 from support_vnext_shadow.support_ruleset_release where release_id = v_release) then
    select coalesce(max(release_sequence),0)+1 into n from support_vnext_shadow.support_ruleset_release;
    insert into support_vnext_shadow.support_ruleset_release(
      release_id, release_code, release_sequence, scope_code, status, effective_from,
      content_hash, change_summary, created_by, updated_by)
    values (v_release,'CONV-ROUNDTRIP',n,'CONV_ROUNDTRIP_SCOPE','DRAFT',now()-interval '1 minute',
      repeat('0',64),'round-trip 5B.4-B','conv-fixture','conv-fixture');
  end if;

  for i in 1..30 loop
    insert into support_vnext_shadow.conversation_sessions(session_id, conversation_id, release_id, status, automation_mode)
    values (('55555555-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
            ('66666666-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
            v_release, 'ACTIVE', 'BOT_ACTIVE')
    on conflict (session_id) do nothing;
  end loop;
end $$;
