\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
-- Build actual draft content, then publish the same release so every rejected
-- operation necessarily reaches guard_release_content_immutable.
select pg_temp.new_approved_release('P04_PUBLISHED_SCOPE') as published_release_id \gset
select gen_random_uuid() as published_rule_id \gset
insert into support_vnext_shadow.decision_rule(
  decision_rule_id,release_id,logical_rule_id,rule_code,priority,when_expression,
  then_plan,reason_code,created_by
) values (
  :'published_rule_id'::uuid,:'published_release_id'::uuid,gen_random_uuid(),'P04_PUBLISHED_RULE',1,'{}'::jsonb,
  jsonb_build_object(
    'schema_version','1.0','release_id',:'published_release_id'::text,'outcome','A_CONFIRMAR',
    'actions','[]'::jsonb,'reason_codes','[]'::jsonb,
    'state_patch',jsonb_build_object('expected_state_version',1,'operations','[]'::jsonb),
    'validation_requirements','{}'::jsonb,'response_plan',null,'request_plan',null,
    'document_plan',null,'handoff_plan',null
  ),'P04','fixture'
);
select support_vnext_shadow.refresh_draft_release_content_hash(:'published_release_id'::uuid,'fixture');
select support_vnext_shadow.publish_ruleset_release(:'published_release_id'::uuid,'fixture');

select pg_temp.new_approved_release('P04_DRAFT_SCOPE') as draft_release_id \gset
update support_vnext_shadow.support_ruleset_release
   set status='DRAFT', updated_by='fixture'
 where release_id=:'draft_release_id'::uuid;
select gen_random_uuid() as draft_rule_id \gset
insert into support_vnext_shadow.decision_rule(
  decision_rule_id,release_id,logical_rule_id,rule_code,priority,when_expression,
  then_plan,reason_code,created_by
) values (
  :'draft_rule_id'::uuid,:'draft_release_id'::uuid,gen_random_uuid(),'P04_DRAFT_RULE',1,'{}'::jsonb,
  jsonb_build_object(
    'schema_version','1.0','release_id',:'draft_release_id'::text,'outcome','A_CONFIRMAR',
    'actions','[]'::jsonb,'reason_codes','[]'::jsonb,
    'state_patch',jsonb_build_object('expected_state_version',1,'operations','[]'::jsonb),
    'validation_requirements','{}'::jsonb,'response_plan',null,'request_plan',null,
    'document_plan',null,'handoff_plan',null
  ),'P04','fixture'
);

-- A. INSERT late into PUBLISHED fails through NEW.release_id.
select pg_temp.expect_error(format($q$
  insert into support_vnext_shadow.decision_rule(decision_rule_id,release_id,logical_rule_id,rule_code,priority,when_expression,then_plan,reason_code,created_by)
  values(gen_random_uuid(),%L::uuid,gen_random_uuid(),'P04_LATE',1,'{}'::jsonb,
  jsonb_build_object('schema_version','1.0','release_id',%L::text,'outcome','A_CONFIRMAR','actions','[]'::jsonb,'reason_codes','[]'::jsonb,'state_patch',jsonb_build_object('expected_state_version',1,'operations','[]'::jsonb),'validation_requirements','{}'::jsonb,'response_plan',null,'request_plan',null,'document_plan',null,'handoff_plan',null),'P04','fixture')
$q$,:'published_release_id',:'published_release_id'),'55000');
-- B. UPDATE within PUBLISHED fails through OLD.release_id.
select pg_temp.expect_error(format('update support_vnext_shadow.decision_rule set reason_code=%L where decision_rule_id=%L','P04_MUTATED',:'published_rule_id'),'55000');
-- C. PUBLISHED -> draft cannot escape through a mutable NEW.release_id.
select pg_temp.expect_error(format('update support_vnext_shadow.decision_rule set release_id=%L where decision_rule_id=%L',:'draft_release_id',:'published_rule_id'),'55000');
-- D. Draft -> PUBLISHED cannot introduce changed content into a final snapshot.
select pg_temp.expect_error(format('update support_vnext_shadow.decision_rule set release_id=%L where decision_rule_id=%L',:'published_release_id',:'draft_rule_id'),'55000');
-- E. DELETE from PUBLISHED fails through OLD.release_id.
select pg_temp.expect_error(format('delete from support_vnext_shadow.decision_rule where decision_rule_id=%L',:'published_rule_id'),'55000');
-- F. The same ordinary mutation remains allowed in a non-final release.
update support_vnext_shadow.decision_rule set reason_code='P04_DRAFT_UPDATED' where decision_rule_id=:'draft_rule_id'::uuid;
select pg_temp.assert_true((select reason_code='P04_DRAFT_UPDATED' from support_vnext_shadow.decision_rule where decision_rule_id=:'draft_rule_id'::uuid),'P04 draft content update is permitted');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.decision_rule where decision_rule_id=:'published_rule_id'::uuid),'P04 published content remained unchanged');
\echo 'PASS P04 published content INSERT/UPDATE/rebind/DELETE guards enforced'
rollback;
