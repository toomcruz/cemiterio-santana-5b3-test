\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

select pg_temp.new_approved_release('P05_PUBLISHED_SCOPE') as published_release_id \gset
select pg_temp.new_approved_release('P05_DRAFT_SCOPE') as draft_release_id \gset
update support_vnext_shadow.support_ruleset_release set status='DRAFT',updated_by='fixture' where release_id=:'draft_release_id'::uuid;
select gen_random_uuid() as source_id,gen_random_uuid() as replacement_source_id \gset
insert into support_vnext_shadow.knowledge_source(source_id,logical_source_id,source_version,source_type,title,authority_level,content_hash,created_by)
values(:'source_id'::uuid,gen_random_uuid(),1,'MANUAL','P05 source','HISTORICAL',repeat('a',64),'fixture'),(:'replacement_source_id'::uuid,gen_random_uuid(),1,'MANUAL','P05 replacement','HISTORICAL',repeat('b',64),'fixture');
insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(:'published_release_id'::uuid,:'source_id'::uuid,'FACT','fixture');
select support_vnext_shadow.refresh_draft_release_content_hash(:'published_release_id'::uuid,'fixture');
select support_vnext_shadow.publish_ruleset_release(:'published_release_id'::uuid,'fixture');

select pg_temp.expect_error(format($q$insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(%L::uuid,%L::uuid,'POLICY','fixture')$q$,:'published_release_id',:'replacement_source_id'),'55000');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid),'P05-A published insert left link set unchanged');
select pg_temp.expect_error(format($q$update support_vnext_shadow.ruleset_source_link set purpose_code='DOCUMENT' where release_id=%L::uuid and source_id=%L::uuid and purpose_code='FACT'$q$,:'published_release_id',:'source_id'),'55000');
select pg_temp.assert_true((select purpose_code='FACT' from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid and source_id=:'source_id'::uuid),'P05-B published update left link unchanged');
select pg_temp.expect_error(format($q$update support_vnext_shadow.ruleset_source_link set source_id=%L::uuid where release_id=%L::uuid and source_id=%L::uuid and purpose_code='FACT'$q$,:'replacement_source_id',:'published_release_id',:'source_id'),'55000');
select pg_temp.assert_true((select source_id=:'source_id'::uuid from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid and purpose_code='FACT'),'P05-C source_id mutation rejected');
select pg_temp.expect_error(format($q$update support_vnext_shadow.ruleset_source_link set release_id=%L::uuid where release_id=%L::uuid and source_id=%L::uuid and purpose_code='FACT'$q$,:'draft_release_id',:'published_release_id',:'source_id'),'55000');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid),'P05-D published to draft rebind rejected');
insert into support_vnext_shadow.ruleset_source_link(release_id,source_id,purpose_code,created_by) values(:'draft_release_id'::uuid,:'replacement_source_id'::uuid,'FACT','fixture');
select pg_temp.expect_error(format($q$update support_vnext_shadow.ruleset_source_link set release_id=%L::uuid where release_id=%L::uuid and source_id=%L::uuid and purpose_code='FACT'$q$,:'published_release_id',:'draft_release_id',:'replacement_source_id'),'55000');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.ruleset_source_link where release_id=:'draft_release_id'::uuid),'P05-E draft to published late rebind rejected');
select pg_temp.expect_error(format($q$delete from support_vnext_shadow.ruleset_source_link where release_id=%L::uuid and source_id=%L::uuid and purpose_code='FACT'$q$,:'published_release_id',:'source_id'),'55000');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid),'P05-F published delete rejected');

update support_vnext_shadow.ruleset_source_link set purpose_code='POLICY' where release_id=:'draft_release_id'::uuid and source_id=:'replacement_source_id'::uuid and purpose_code='FACT';
select pg_temp.assert_true((select purpose_code='POLICY' from support_vnext_shadow.ruleset_source_link where release_id=:'draft_release_id'::uuid and source_id=:'replacement_source_id'::uuid),'P05-G draft source link mutation is permitted');
select pg_temp.expect_error(format($q$update support_vnext_shadow.knowledge_source set title='mutated published source' where source_id=%L::uuid$q$,:'source_id'),'55000');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.ruleset_source_link where release_id=:'published_release_id'::uuid and source_id=:'source_id'::uuid and purpose_code='FACT'),'P05 published source link unchanged');
\echo 'PASS P05-A..P05-G published source links and linked source are immutable'
rollback;
