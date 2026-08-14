\set ON_ERROR_STOP on
begin;
\ir _helpers.sql
\ir fixtures/confirmation_flow_fixture.sql
create table if not exists support_vnext_test.p00_classifier_authority_scenarios(scenario_code text primary key);
insert into support_vnext_test.p00_classifier_authority_scenarios(scenario_code) values
 ('AUTH-01'),('AUTH-02'),('AUTH-03'),('AUTH-04'),('AUTH-05'),('AUTH-06'),('AUTH-07'),('AUTH-08');
create table if not exists support_vnext_test.p00_classifier_contract_scenarios(scenario_code text primary key);
insert into support_vnext_test.p00_classifier_contract_scenarios(scenario_code) values
 ('CLASS-01'),('CLASS-02'),('CLASS-03'),('CLASS-04'),('CLASS-05'),('CLASS-06'),('CLASS-07'),('CLASS-08');

-- AUTH-01 through AUTH-07 use an unconsumed fixture and invoke the final RPC.
select extensions.gen_random_uuid() as test_run_id \gset
select support_vnext_test.create_confirmation_fixture(:'test_run_id'::uuid,false,false);
select * from support_vnext_test.confirmation_fixture_context where test_run_id=:'test_run_id'::uuid \gset
select support_vnext_test.ensure_classifier_authority() \gset authority_
select support_vnext_shadow.persist_shadow_inbound_message(:'inbound_message_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'support_vnext_test inbound '||:'inbound_message_id');

-- AUTH-01: service_role-shaped caller has no authority key/assertion and cannot fabricate affirmative.
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC','runtime',null,null,null)$q$,:'inbound_message_id',:'confirmation_id',:'session_id',:'topic_id',:'release_id'),'22023');
select pg_temp.assert_true((select count(*)=0 from support_vnext_shadow.inbound_classifications where inbound_message_id=:'inbound_message_id'::uuid),'CLASS-05 affirmative without evidence was not persisted');
-- AUTH-02: invalid assertion is rejected.
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC','runtime',%L::uuid,gen_random_uuid(),repeat('0',64))$q$,:'inbound_message_id',:'confirmation_id',:'session_id',:'topic_id',:'release_id',:'authority_authority_key_id'),'22023');
-- AUTH-03: assertion material for inbound A cannot be used for inbound B.
select extensions.gen_random_uuid() as inbound_b \gset
select support_vnext_shadow.persist_shadow_inbound_message(:'inbound_b'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'different inbound B');
select content_hash as content_hash_a from support_vnext_shadow.inbound_messages where inbound_message_id=:'inbound_message_id'::uuid \gset
select extensions.gen_random_uuid() as authority_nonce \gset
select support_vnext_shadow.classifier_assertion_material(:'inbound_message_id'::uuid,:'content_hash_a'::char(64),:'confirmation_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'CONFIRMATION_AFFIRMATIVE','OK','support-vnext-test-classifier-v1',:'authority_nonce'::uuid) as material \gset
select encode(extensions.hmac(:'material',:'authority_verifier_secret','sha256'),'hex') as assertion \gset
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC','support-vnext-test-classifier-v1',%L::uuid,%L::uuid,%L)$q$,:'inbound_b',:'confirmation_id',:'session_id',:'topic_id',:'release_id',:'authority_authority_key_id',:'authority_nonce',:'assertion'),'22023');
-- AUTH-04: content hash is immutable; content B cannot replace the persisted inbound A hash.
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_shadow_inbound_message(%L::uuid,%L::uuid,%L::uuid,%L::uuid,'content changed after classification')$q$,:'inbound_message_id',:'session_id',:'topic_id',:'release_id'),'22023');
-- AUTH-05: a helper with the separately configured test authority persists an affirmative record.
select extensions.gen_random_uuid() as valid_inbound \gset
select extensions.gen_random_uuid() as valid_classification \gset
select support_vnext_test.persist_test_inbound_classification(:'valid_classification'::uuid,:'valid_inbound'::uuid,:'confirmation_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid) as auth05 \gset
select pg_temp.assert_true((:'auth05'::jsonb->>'status')='PERSISTED','AUTH-05 authoritative affirmative persisted');
-- AUTH-06 / CLASS-01: a legitimate OTHER result persists without confirmation evidence.
select extensions.gen_random_uuid() as other_classification \gset
select support_vnext_test.persist_test_inbound_classification(:'other_classification'::uuid,:'inbound_b'::uuid,null,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'OTHER','OK');
select pg_temp.assert_true((select classification_code='OTHER' and classification_status='OK' and confirmation_id is null and authority_key_id is null and authority_nonce is null and authority_assertion_hash is null from support_vnext_shadow.inbound_classifications where classification_id=:'other_classification'::uuid),'CLASS-01 OTHER persists without confirmation or authority evidence');
-- CLASS-02: OTHER is never authorization evidence.
select pg_temp.expect_error(format($q$select support_vnext_shadow.authorize_persisted_confirmation(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)$q$,:'other_classification',:'confirmation_id',:'confirmation_nonce',:'inbound_b',:'session_id',:'topic_id',:'release_id'),'22023');
select pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.confirmation_authorizations where classification_id=:'other_classification'::uuid),'CLASS-02 OTHER did not create authorization');
-- CLASS-03: OTHER cannot use a status outside the final allowlist.
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,null::uuid,%L::uuid,%L::uuid,%L::uuid,'OTHER','INVALID','DETERMINISTIC','support-vnext-test-classifier-v1',null,null,null)$q$,:'inbound_b',:'session_id',:'topic_id',:'release_id'),'22023');
select pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.inbound_classifications where inbound_message_id=:'inbound_b'::uuid and classification_status='INVALID'),'CLASS-03 invalid OTHER status was not persisted');
-- CLASS-04: affirmative is impossible without a pending confirmation reference.
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,null::uuid,%L::uuid,%L::uuid,%L::uuid,'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC','support-vnext-test-classifier-v1',null,null,null)$q$,:'inbound_message_id',:'session_id',:'topic_id',:'release_id'),'22023');
select pg_temp.assert_true(not exists(select 1 from support_vnext_shadow.inbound_classifications where inbound_message_id=:'inbound_message_id'::uuid and classification_code='CONFIRMATION_AFFIRMATIVE'),'CLASS-04 affirmative without confirmation was not persisted');
-- CLASS-05 is AUTH-01: affirmative without authority/HMAC is rejected.
-- CLASS-06 is AUTH-05: a fully evidenced affirmative persists.
-- CLASS-07: OTHER cannot be transformed into affirmative after persistence.
select pg_temp.expect_error(format($q$update support_vnext_shadow.inbound_classifications set classification_code='CONFIRMATION_AFFIRMATIVE' where classification_id=%L::uuid$q$,:'other_classification'),'55000');
select pg_temp.assert_true((select classification_code='OTHER' from support_vnext_shadow.inbound_classifications where classification_id=:'other_classification'::uuid),'CLASS-07 OTHER remains immutable after affirmative update attempt');
-- CLASS-08: affirmative cannot be transformed into OTHER after persistence.
select pg_temp.expect_error(format($q$update support_vnext_shadow.inbound_classifications set classification_code='OTHER' where classification_id=%L::uuid$q$,:'valid_classification'),'55000');
select pg_temp.assert_true((select classification_code='CONFIRMATION_AFFIRMATIVE' from support_vnext_shadow.inbound_classifications where classification_id=:'valid_classification'::uuid),'CLASS-08 affirmative remains immutable after OTHER update attempt');
-- AUTH-07: replaying a valid assertion nonce cannot create a second classification.
select authority_nonce as valid_nonce, inbound_content_hash as valid_content_hash from support_vnext_shadow.inbound_classifications where classification_id=:'valid_classification'::uuid \gset
select support_vnext_shadow.classifier_assertion_material(:'valid_inbound'::uuid,:'valid_content_hash'::char(64),:'confirmation_id'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid,'CONFIRMATION_AFFIRMATIVE','OK','support-vnext-test-classifier-v1',:'valid_nonce'::uuid) as valid_material \gset
select encode(extensions.hmac(:'valid_material',:'authority_verifier_secret','sha256'),'hex') as valid_assertion \gset
select pg_temp.expect_error(format($q$select support_vnext_shadow.persist_inbound_classification(gen_random_uuid(),%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,'CONFIRMATION_AFFIRMATIVE','OK','DETERMINISTIC','support-vnext-test-classifier-v1',%L::uuid,%L::uuid,%L)$q$,:'valid_inbound',:'confirmation_id',:'session_id',:'topic_id',:'release_id',:'authority_authority_key_id',:'valid_nonce',:'valid_assertion'),'23505');
-- AUTH-08: authoritative evidence supports authorization and one real CONFIRM.
select support_vnext_shadow.authorize_persisted_confirmation(:'valid_classification'::uuid,:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'valid_inbound'::uuid,:'session_id'::uuid,:'topic_id'::uuid,:'release_id'::uuid) as authorization \gset
select support_vnext_shadow.confirm_request_transaction(:'confirmation_id'::uuid,:'confirmation_nonce'::uuid,:'valid_classification'::uuid,:'valid_inbound'::uuid,'AUTH-08') as confirm_result \gset
select pg_temp.assert_true((:'confirm_result'::jsonb->>'outcome')='CONFIRMED','AUTH-08 authoritative classification confirms exactly once');
select pg_temp.assert_true((select count(*)=1 from support_vnext_shadow.service_requests where confirmation_id=:'confirmation_id'::uuid),'AUTH-08 created one request');
select pg_temp.assert_true((:'auth05'::jsonb->>'status')='PERSISTED','CLASS-06 fully evidenced affirmative persisted');
select pg_temp.assert_true((select count(*)=8 from support_vnext_test.p00_classifier_authority_scenarios),'AUTH-01 through AUTH-08 were registered');
select pg_temp.assert_true((select count(*)=8 from support_vnext_test.p00_classifier_contract_scenarios),'CLASS-01 through CLASS-08 were registered');
select pg_temp.assert_true((select is_nullable='YES' from information_schema.columns where table_schema='support_vnext_shadow' and table_name='inbound_classifications' and column_name='confirmation_id'),'classification confirmation_id is nullable for OTHER');
select pg_temp.assert_true((select exists(select 1 from pg_constraint where conrelid='support_vnext_shadow.inbound_classifications'::regclass and conname='inbound_classifications_code_status_confirmation_ck')),'classification final conditional evidence constraint exists');
select pg_temp.assert_true((select pg_get_constraintdef(oid) like '%OTHER%' from pg_constraint where conrelid='support_vnext_shadow.inbound_classifications'::regclass and conname='inbound_classifications_classification_code_check'),'classification code allowlist replaced exclusive affirmative check');
\echo 'PASS AUTH-01..AUTH-08 classifier authority'
rollback;
