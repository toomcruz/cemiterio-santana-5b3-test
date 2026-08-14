-- Auxiliary C4-R5C validator coverage; not part of official P01-P15.
\ir _helpers.sql

do $$
declare
  plan jsonb := jsonb_build_object(
    'schema_version','1.0','release_id','00000000-0000-4000-8000-000000000001',
    'state_version',1,'outcome','PERMITTED','actions',jsonb_build_array('RESPONDER'),
    'response_plan',null,'state_patch',jsonb_build_object('expected_state_version',1,'operations','[]'::jsonb),
    'request_plan',null,'document_plan',null,'handoff_plan',null,'reason_codes',jsonb_build_array('TEST'),
    'validation_requirements','{}'::jsonb,'expires_at','2026-01-01T00:00:00Z'
  );
  response jsonb := jsonb_build_object('mode','DETERMINISTIC','template_variables',jsonb_build_object('nome','teste','tentativas',1,'ativo',true),'allowed_fact_refs',jsonb_build_array(jsonb_build_object('type','MESSAGE','id','00000000-0000-4000-8000-000000000002')),'asset_ids','[]'::jsonb,'max_questions',0);
  patch jsonb := jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array(jsonb_build_object('op','MERGE_COLLECTED_DATA','topic_id','00000000-0000-4000-8000-000000000003','allowed_fields',jsonb_build_object('nome','teste'))));
  valid_rule_when jsonb := jsonb_build_object('intent_code','TESTE','requires_pending_confirmation',false);
begin
  perform pg_temp.assert_true(support_vnext_shadow.valid_decision_plan(plan),'PLAN-01 DecisionPlan válido mínimo');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_plan(plan || jsonb_build_object('unknown_top_level',true)),'PLAN-02 chave desconhecida de primeiro nível');
  perform pg_temp.assert_true(support_vnext_shadow.valid_template_variables(response->'template_variables') and support_vnext_shadow.valid_response_plan(response),'PLAN-03 template_variables válido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_response_plan(jsonb_set(response,'{template_variables,nome}',jsonb_build_object('nested','no'))),'PLAN-04 template_variables com objeto arbitrário');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_response_plan(jsonb_set(response,'{template_variables}',jsonb_build_object('priority','ADMIN'))),'PLAN-05 template_variables com chave proibida');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(response->'allowed_fact_refs'),'PLAN-06 allowed_fact_refs válido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_fact_refs(jsonb_build_array(1,null,jsonb_build_object('type','MESSAGE','id','not-a-uuid'))),'PLAN-07 allowed_fact_refs inválido');
  perform pg_temp.assert_true(support_vnext_shadow.valid_state_patch(patch),'PLAN-08 state_patch válido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_state_patch(jsonb_set(patch,'{operations}',jsonb_build_array(jsonb_build_object('op','DROP_DATABASE')))),'PLAN-09 state_patch operação desconhecida');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_state_patch(jsonb_set(patch,'{operations}',jsonb_build_array(jsonb_build_object('op','MERGE_COLLECTED_DATA','topic_id','00000000-0000-4000-8000-000000000003','allowed_fields',jsonb_build_object('release_id','00000000-0000-4000-8000-000000000001'))))),'PLAN-10 state_patch campo não permitido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_state_patch(jsonb_set(patch,'{operations}',jsonb_build_array(jsonb_build_object('op','MERGE_COLLECTED_DATA','topic_id','00000000-0000-4000-8000-000000000003','allowed_fields',jsonb_build_object('nome',jsonb_build_array('array-invalido')))))),'PLAN-11 state_patch value de tipo incorreto');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_state_patch(jsonb_set(patch,'{operations}',jsonb_build_array(jsonb_build_object('op','CLEAR_PENDING_QUESTION','topic_id','00000000-0000-4000-8000-000000000003','extra',true)))),'PLAN-12 state_patch chave interna extra');

  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('type','MESSAGE','id','00000000-0000-4000-8000-000000000002'))) is true,'FACT-NULL-00 fact ref completo retorna TRUE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array('{}'::jsonb)) is false,'FACT-NULL-01 fact ref vazio retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('type','KNOWLEDGE'))) is false,'FACT-NULL-02 fact ref sem id retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000002'))) is false,'FACT-NULL-03 fact ref sem type retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('type',null,'id','00000000-0000-4000-8000-000000000002'))) is false,'FACT-NULL-04 fact ref type null retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('type','MESSAGE','id',null))) is false,'FACT-NULL-05 fact ref id null retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_fact_refs(jsonb_build_array(jsonb_build_object('type','MESSAGE','id','uuid-invalido'))) is false,'FACT-NULL-06 fact ref id inválido retorna FALSE');

  perform pg_temp.assert_true(support_vnext_shadow.valid_state_patch(jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array(jsonb_build_object('op','SET_TOPIC_STATUS','status','ACTIVE')))) is false,'PLAN-N01 state patch operation sem topic_id retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_state_patch(jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array(jsonb_build_object('op',null,'topic_id','00000000-0000-4000-8000-000000000003')))) is false,'PLAN-N02 state patch op null retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_state_patch(jsonb_build_object('expected_state_version',1,'operations',jsonb_build_array(jsonb_build_object('op','MERGE_COLLECTED_DATA','topic_id','00000000-0000-4000-8000-000000000003')))) is false,'PLAN-N03 merge sem allowed_fields retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_decision_plan('{}'::jsonb) is false,'PLAN-N04 DecisionPlan vazio retorna FALSE e não NULL');
  perform pg_temp.assert_true((support_vnext_shadow.valid_decision_plan(plan - 'response_plan')) is false,'PLAN-N05 response_plan ausente retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_response_plan(jsonb_build_object('template_variables','{}'::jsonb)) is false,'PLAN-N06 response plan sem mode retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_request_plan(jsonb_build_object('mode','PROPOSE','request_policy_id','00000000-0000-4000-8000-000000000010','subject_template_id','00000000-0000-4000-8000-000000000011','confirmation_required',true)) is false,'PLAN-N07 request plan sem proposal_field_values retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_handoff_plan(jsonb_build_object('mode','ACTIVATE','reason_code','TEST','pause_bot',true)) is false,'PLAN-N08 handoff plan sem policy retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_question_schema(jsonb_build_object('question_code','TEST')) is false,'PLAN-N09 question schema incompleto retorna FALSE');

  perform pg_temp.assert_true(support_vnext_shadow.valid_decision_rule_when(valid_rule_when) and support_vnext_shadow.valid_decision_plan(plan),'RULE-01 regra válida mínima');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_rule_when(valid_rule_when || jsonb_build_object('unknown',true)),'RULE-02 regra com chave desconhecida');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_rule_when(jsonb_build_object('operator','EQUALS')),'RULE-03 condition com operador desconhecido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_rule_when(jsonb_build_object('intent_code',jsonb_build_object('free','object'))),'RULE-04 condition com estrutura arbitrária');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_plan(plan || jsonb_build_object('action',jsonb_build_object('external_route','x'))),'RULE-05 action/result com campo desconhecido');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_plan(jsonb_set(plan,'{state_patch,expected_state_version}','true'::jsonb)),'RULE-06 action com valor de tipo incorreto');
  perform pg_temp.assert_true(not support_vnext_shadow.valid_decision_rule_when(jsonb_build_object('intent_code','TESTE','nested',jsonb_build_object('extra',true))),'RULE-10 estrutura aninhada extra');
  perform pg_temp.assert_true(support_vnext_shadow.valid_decision_rule_when(jsonb_build_object('intent_code',null)) is false,'RULE-N01 when_expression com intent null retorna FALSE');
  perform pg_temp.assert_true(support_vnext_shadow.valid_decision_rule_when(jsonb_build_object('requires_pending_confirmation',null)) is false,'RULE-N02 when_expression com boolean null retorna FALSE');
exception when others then
  if sqlstate='P0001' then raise; end if;
  raise exception 'decision schema closure test failed: %',sqlerrm using errcode='P0001';
end $$;

-- RULE-07 through RULE-09 use the production SQL resolver. The TypeScript
-- decision engine combines the selected equal-priority set and is covered by
-- tests/unit/decision_engine_test.ts for the fail-closed conflict result.
do $$
declare
  release_a uuid:=extensions.gen_random_uuid(); release_b uuid:=extensions.gen_random_uuid(); release_c uuid:=extensions.gen_random_uuid();
  seq_a integer; seq_b integer; seq_c integer; high_plan jsonb; low_plan jsonb; conflict_a jsonb; conflict_b jsonb;
  rules_a jsonb; rules_b jsonb; rules_c jsonb; normalized_a jsonb; normalized_c jsonb; r uuid;
begin
  select coalesce(max(release_sequence),0)+1 into seq_a from support_vnext_shadow.support_ruleset_release;
  seq_b:=seq_a+1; seq_c:=seq_a+2;
  foreach r in array array[release_a,release_b,release_c] loop
    insert into support_vnext_shadow.support_ruleset_release(release_id,release_code,release_sequence,scope_code,status,effective_from,content_hash,change_summary,created_at,created_by,updated_by)
    values(r,'P00-RULE-'||replace(r::text,'-',''),case when r=release_b then seq_b when r=release_c then seq_c else seq_a end,'P00_RULE_'||r::text,'DRAFT',now()-interval '1 minute',repeat('0',64),'decision resolver fixture',now(),'p00','p00');
  end loop;
  high_plan:=jsonb_build_object('schema_version','1.0','release_id',release_a::text,'outcome','PERMITTED','actions',jsonb_build_array('RESPONDER'),'response_plan',null,'state_patch',jsonb_build_object('expected_state_version',1,'operations','[]'::jsonb),'request_plan',null,'document_plan',null,'handoff_plan',null,'reason_codes',jsonb_build_array('HIGH'),'validation_requirements','{}'::jsonb);
  low_plan:=high_plan || jsonb_build_object('reason_codes',jsonb_build_array('LOW'));
  conflict_a:=high_plan || jsonb_build_object('reason_codes',jsonb_build_array('CONFLICT_A'),'response_plan',jsonb_build_object('mode','DETERMINISTIC','template_variables',jsonb_build_object('message','a'),'allowed_fact_refs','[]'::jsonb,'asset_ids','[]'::jsonb,'max_questions',0));
  conflict_b:=high_plan || jsonb_build_object('reason_codes',jsonb_build_array('CONFLICT_B'),'response_plan',jsonb_build_object('mode','DETERMINISTIC','template_variables',jsonb_build_object('message','b'),'allowed_fact_refs','[]'::jsonb,'asset_ids','[]'::jsonb,'max_questions',0));
  perform pg_temp.expect_error(format($q$insert into support_vnext_shadow.decision_rule(decision_rule_id,release_id,logical_rule_id,rule_code,priority,when_expression,then_plan,reason_code,record_status,created_by) values (extensions.gen_random_uuid(),%L::uuid,extensions.gen_random_uuid(),'RULE_N03',1,'{}'::jsonb,'{}'::jsonb,'INVALID','PUBLISHED','p00')$q$,release_a),'22023');
  perform pg_temp.assert_true(true,'RULE-N03 persisted DecisionRule with incomplete then_plan is rejected by trigger');
  insert into support_vnext_shadow.decision_rule(decision_rule_id,release_id,logical_rule_id,rule_code,priority,when_expression,then_plan,reason_code,record_status,created_by) values
    (extensions.gen_random_uuid(),release_a,extensions.gen_random_uuid(),'RULE_LOW',10,'{}'::jsonb,low_plan,'LOW','PUBLISHED','p00'),
    (extensions.gen_random_uuid(),release_a,extensions.gen_random_uuid(),'RULE_HIGH',20,'{}'::jsonb,high_plan,'HIGH','PUBLISHED','p00'),
    (extensions.gen_random_uuid(),release_b,extensions.gen_random_uuid(),'RULE_CONFLICT_A',20,'{}'::jsonb,conflict_a,'A','PUBLISHED','p00'),
    (extensions.gen_random_uuid(),release_b,extensions.gen_random_uuid(),'RULE_CONFLICT_B',20,'{}'::jsonb,conflict_b,'B','PUBLISHED','p00'),
    (extensions.gen_random_uuid(),release_c,extensions.gen_random_uuid(),'RULE_CONFLICT_B',20,'{}'::jsonb,conflict_b,'B','PUBLISHED','p00'),
    (extensions.gen_random_uuid(),release_c,extensions.gen_random_uuid(),'RULE_CONFLICT_A',20,'{}'::jsonb,conflict_a,'A','PUBLISHED','p00');
  foreach r in array array[release_a,release_b,release_c] loop
    perform support_vnext_shadow.refresh_draft_release_content_hash(r,'p00');
    update support_vnext_shadow.support_ruleset_release set status='APPROVED',approved_at=now(),approved_by='p00',updated_by='p00' where release_id=r;
    perform support_vnext_shadow.publish_ruleset_release(r,'p00');
  end loop;
  rules_a:=support_vnext_shadow.get_runtime_decision_rules(release_a,'TESTE',null,null);
  rules_b:=support_vnext_shadow.get_runtime_decision_rules(release_b,'TESTE',null,null);
  rules_c:=support_vnext_shadow.get_runtime_decision_rules(release_c,'TESTE',null,null);
  perform pg_temp.assert_true(rules_a->0->>'rule_code'='RULE_HIGH' and rules_a->1->>'rule_code'='RULE_LOW','RULE-07 resolver real ordena prioridade superior antes da inferior');
  perform pg_temp.assert_true(jsonb_array_length(rules_b)=2 and (rules_b->0->'then_plan') is distinct from (rules_b->1->'then_plan'),'RULE-08 resolver real entrega conjunto conflitante de mesma prioridade ao decision engine');
  select jsonb_agg(jsonb_build_object('rule_code',e->>'rule_code','priority',e->'priority','then_plan',e->'then_plan') order by e->>'rule_code') into normalized_a from jsonb_array_elements(rules_b) e;
  select jsonb_agg(jsonb_build_object('rule_code',e->>'rule_code','priority',e->'priority','then_plan',e->'then_plan') order by e->>'rule_code') into normalized_c from jsonb_array_elements(rules_c) e;
  perform pg_temp.assert_true(normalized_a=normalized_c and rules_b->0->>'rule_code'=rules_c->0->>'rule_code','RULE-09 resolver real é independente da ordem de INSERT');
exception when others then
  raise exception 'decision resolver closure test failed: %',sqlerrm using errcode='P0001';
end $$;
