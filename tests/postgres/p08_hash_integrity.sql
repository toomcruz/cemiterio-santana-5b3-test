\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

select pg_temp.new_approved_release('P08_A') as release_a \gset
select gen_random_uuid() as source_a \gset
insert into support_vnext_shadow.knowledge_source(source_id,logical_source_id,source_version,source_type,title,authority_level,content_hash,created_by) values(:'source_a'::uuid,gen_random_uuid(),1,'MANUAL','P08 source A','HISTORICAL',repeat('c',64),'fixture');
insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(:'release_a'::uuid,:'source_a'::uuid,'FACT','fixture');
select support_vnext_shadow.refresh_draft_release_content_hash(:'release_a'::uuid,'fixture');
select content_hash as p08_hash_a \gset from support_vnext_shadow.support_ruleset_release where release_id=:'release_a'::uuid;
select pg_temp.assert_true(:'p08_hash_a'=support_vnext_shadow.compute_release_content_hash(:'release_a'::uuid),'P08-B intact snapshot validates');
select pg_temp.assert_true(support_vnext_shadow.compute_release_content_hash(:'release_a'::uuid)=support_vnext_shadow.compute_release_content_hash(:'release_a'::uuid),'P08-G repeated calculation is deterministic');
select support_vnext_shadow.publish_ruleset_release(:'release_a'::uuid,'fixture');
select pg_temp.expect_error(format($q$insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(%L::uuid,%L::uuid,'POLICY','fixture')$q$,:'release_a',:'source_a'),'55000');

select pg_temp.new_approved_release('P08_DIVERGENT') as release_d \gset
select gen_random_uuid() as source_d \gset
insert into support_vnext_shadow.knowledge_source(source_id,logical_source_id,source_version,source_type,title,authority_level,content_hash,created_by) values(:'source_d'::uuid,gen_random_uuid(),1,'MANUAL','P08 source D','HISTORICAL',repeat('d',64),'fixture');
insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(:'release_d'::uuid,:'source_d'::uuid,'FACT','fixture');
select support_vnext_shadow.refresh_draft_release_content_hash(:'release_d'::uuid,'fixture');
update support_vnext_shadow.knowledge_source set content_hash=repeat('e',64) where source_id=:'source_d'::uuid;
select pg_temp.assert_true((select content_hash<>support_vnext_shadow.compute_release_content_hash(release_id) from support_vnext_shadow.support_ruleset_release where release_id=:'release_d'::uuid),'P08-D material divergence produces HASH_MISMATCH');
select pg_temp.expect_error(format($q$select support_vnext_shadow.publish_ruleset_release(%L::uuid,'fixture')$q$,:'release_d'),'22023');

select pg_temp.new_approved_release('P08_B') as release_b \gset
select gen_random_uuid() as source_b \gset
insert into support_vnext_shadow.knowledge_source(source_id,logical_source_id,source_version,source_type,title,authority_level,content_hash,created_by) values(:'source_b'::uuid,gen_random_uuid(),1,'MANUAL','P08 source B','HISTORICAL',repeat('f',64),'fixture');
insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(:'release_b'::uuid,:'source_b'::uuid,'FACT','fixture');
select support_vnext_shadow.refresh_draft_release_content_hash(:'release_b'::uuid,'fixture');
select pg_temp.assert_true(support_vnext_shadow.compute_release_content_hash(:'release_a'::uuid)<>support_vnext_shadow.compute_release_content_hash(:'release_b'::uuid),'P08-E release A hash cannot validate release B');
select pg_temp.assert_true((select content_hash from support_vnext_shadow.knowledge_source where source_id=:'source_a'::uuid)<> (select content_hash from support_vnext_shadow.knowledge_source where source_id=:'source_b'::uuid),'P08-F source/link material is represented in a different snapshot');
\echo 'PASS P08-A..P08-G adversarial release hash integrity'
rollback;
