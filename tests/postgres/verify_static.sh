#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
declare -A cases=(
  [P01]=p01_release_overlap.sql [P02]=p02_published_update.sql [P03]=p03_published_delete.sql
  [P04]=p04_content_insert_update_delete.sql [P05]=p05_source_link_insert.sql [P06]=p06_final_states.sql
  [P07]=p07_explicit_rebind.sql [P08]=p08_hash_integrity.sql [P09]=p09_session_concurrency.sql
  [P10]=p10_a_confirmar.sql [P11]=p11_confirm_concurrency.sql [P12]=p12_inbound_reuse.sql
  [P13]=p13_confirmation_rejections.sql [P14]=p14_complaint_closed.sql [P15]=p15_privileges.sql
)
for id in P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15; do
  file="$root/${cases[$id]}"
  [[ -s "$file" ]] || { echo "$id missing" >&2; exit 1; }
  rg -q 'assert_true|expect_error|raise exception' "$file" || { echo "$id lacks executable assertion" >&2; exit 1; }
  ! rg -qi 'requires .*runner|fixture-driven|instruction|executar manualmente|todo|simular' "$file" || { echo "$id contains descriptive-only marker" >&2; exit 1; }
done
classifier="$root/../../edge-functions/support-classifier/index.ts"
rg -q 'import \{ assertMethod, HttpProblem, json, parseJson, problem \}' "$classifier" || { echo 'support-classifier does not import HttpProblem' >&2; exit 1; }
rg -q 'throw new HttpProblem' "$classifier" || { echo 'support-classifier HttpProblem path missing' >&2; exit 1; }
decision_engine="$root/../../edge-functions/support-decision-engine/index.ts"
decision_engine_test="$root/../unit/decision_engine_test.ts"
rg -Fq '"noUncheckedIndexedAccess": true' "$root/../../deno.json" || { echo 'noUncheckedIndexedAccess must remain enabled' >&2; exit 1; }
rg -Fq 'const firstApplicable = applicable[0];' "$decision_engine" || { echo 'decision engine lacks explicit first applicable narrowing' >&2; exit 1; }
rg -Fq 'if (!firstApplicable) return aConfirmar(input, "NO_MATCHING_PUBLISHED_RULE");' "$decision_engine" || { echo 'decision engine lacks first applicable fail-closed branch' >&2; exit 1; }
! rg -Fq 'const highestPriority = applicable[0].priority;' "$decision_engine" || { echo 'decision engine retains unchecked applicable[0] access' >&2; exit 1; }
for token in 'function permittedPlan' 'RULE_CONFLICT_OR_INVALID_PLAN' 'valid same-priority conflicting rules fail closed deterministically' 'restWithRules'; do
  rg -Fq "$token" "$decision_engine_test" || { echo "decision engine unit regression test missing: $token" >&2; exit 1; }
done
immutability_migration="$root/../../database/migrations/0010_5b2c4_release_immutability_fix.sql"
[[ -s "$immutability_migration" ]] || { echo 'release immutability fix migration missing' >&2; exit 1; }
for token in "tg_op in ('UPDATE','DELETE')" old.release_id "tg_op in ('INSERT','UPDATE')" new.release_id "Release content is immutable"; do
  rg -Fq "$token" "$immutability_migration" || { echo "release immutability fix missing: $token" >&2; exit 1; }
done
authority_migration="$root/../../database/migrations/0011_5b2c4_classifier_authority.sql"
[[ -s "$authority_migration" ]] || { echo 'classifier authority migration missing' >&2; exit 1; }
for token in classifier_authorities content_hash classifier_assertion_material extensions.hmac "drop function if exists support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text)" authority_nonce; do
  rg -Fq "$token" "$authority_migration" || { echo "classifier authority migration missing: $token" >&2; exit 1; }
done
! rg -Fq "grant execute on function support_vnext_shadow.persist_inbound_classification(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text) to service_role" "$authority_migration" || { echo 'old insecure classifier RPC granted to service_role' >&2; exit 1; }
classification_alignment_migration="$root/../../database/migrations/0013_5b2c4_classification_contract_alignment.sql"
[[ -s "$classification_alignment_migration" ]] || { echo 'classification contract alignment migration missing' >&2; exit 1; }
for token in 'alter column confirmation_id drop not null' "classification_code in ('CONFIRMATION_AFFIRMATIVE', 'OTHER')" inbound_classifications_code_status_confirmation_ck 'authority_key_id is not null' 'authority_key_id is null'; do
  rg -Fq "$token" "$classification_alignment_migration" || { echo "classification contract alignment missing: $token" >&2; exit 1; }
done
authority_test="$root/p00_classifier_authority.sql"
[[ -s "$authority_test" ]] || { echo 'classifier authority test missing' >&2; exit 1; }
for marker in AUTH-01 AUTH-02 AUTH-03 AUTH-04 AUTH-05 AUTH-06 AUTH-07 AUTH-08; do rg -Fq "$marker" "$authority_test" || { echo "classifier authority test missing: $marker" >&2; exit 1; }; done
for marker in CLASS-01 CLASS-02 CLASS-03 CLASS-04 CLASS-05 CLASS-06 CLASS-07 CLASS-08; do rg -Fq "$marker" "$authority_test" || { echo "classifier contract test missing: $marker" >&2; exit 1; }; done
for token in persist_shadow_inbound_message persist_inbound_classification authorize_persisted_confirmation confirm_request_transaction expect_error assert_true; do rg -Fq "$token" "$authority_test" || { echo "classifier authority test lacks real operation: $token" >&2; exit 1; }; done
rg -Fq "classification_code='OTHER'" "$authority_test" || { echo 'AUTH-06 does not persist OTHER before immutability assertion' >&2; exit 1; }
rg -Fq "p_authority_assertion" "$root/../../edge-functions/support-classifier/index.ts" || { echo 'classifier does not submit authority assertion' >&2; exit 1; }
for token in insert update old.release_id new.release_id delete expect_error assert_true; do
  rg -Fqi "$token" "$root/p04_content_insert_update_delete.sql" || { echo "P04 missing immutability coverage: $token" >&2; exit 1; }
done
for file in "$root"/p*.sql; do [[ "$(basename "$file")" =~ ^p(00|0[1-9]|1[0-5])_ ]] || { echo "unexpected P test $file" >&2; exit 1; }; done
[[ "$(find "$root" -maxdepth 1 -name 'p*.sql' ! -name 'p00_*' | wc -l | tr -d ' ')" == 15 ]] || { echo 'expected exactly 15 official P01-P15 files' >&2; exit 1; }
for token in fixtures/confirmation_flow_fixture.sql confirmation_id classification_id authorization_id confirm_request_transaction "worker" service_requests protocol assert_true; do
  rg -Fq "$token" "$root/p11_confirm_concurrency.sql" || { echo "P11 missing real concurrency token: $token" >&2; exit 1; }
done
rg -Fq "worker in ('A','B')" "$root/p11_confirm_concurrency.sql" || { echo 'P11 lacks both worker identities' >&2; exit 1; }
rg -Fq "is_assert" "$root/p11_confirm_concurrency.sql" || { echo 'P11 lacks final assert stage' >&2; exit 1; }
! rg -Fq 'confirm_request_transaction(uuid,uuid,uuid,text)' "$root/p11_confirm_concurrency.sql" || { echo 'P11 references the retired confirmation RPC signature' >&2; exit 1; }
for token in fixtures/confirmation_flow_fixture.sql confirm_request_transaction inbound_message_id classification_id authorization_id confirmation_nonce confirmation_id ALREADY_CONFIRMED service_requests protocol consumed p12_expect_consumed_authorization_rejected assert_true; do
  rg -Fq "$token" "$root/p12_inbound_reuse.sql" || { echo "P12 missing real reuse token: $token" >&2; exit 1; }
done
rg -Fq "raise exception" "$root/p12_inbound_reuse.sql" || { echo 'P12 lacks executable failure path' >&2; exit 1; }
for assertion in "P12 final service_request count is one" "P12 final protocol count is one" "P12 authorization consumed once" "P12 classification remains consumed"; do
  rg -Fq "$assertion" "$root/p12_inbound_reuse.sql" || { echo "P12 missing final assertion: $assertion" >&2; exit 1; }
done
! rg -Fq 'confirm_request_transaction(uuid,uuid,uuid,text)' "$root/p12_inbound_reuse.sql" || { echo 'P12 references the retired confirmation RPC signature' >&2; exit 1; }
for token in fixtures/confirmation_flow_fixture.sql confirm_request_transaction classification_id inbound_message_id confirmation_nonce service_requests protocol assert_true; do
  rg -Fq "$token" "$root/p13_confirmation_rejections.sql" || { echo "P13 missing real rejection token: $token" >&2; exit 1; }
done
for marker in P13-A P13-B P13-C P13-D P13-E P13-F P13-G P13-H P13-I P13-J P13-K P13-L; do
  rg -Fq "$marker" "$root/p13_confirmation_rejections.sql" || { echo "P13 missing scenario marker: $marker" >&2; exit 1; }
done
rg -Fq "authorize_persisted_confirmation(%L::uuid" "$root/p13_confirmation_rejections.sql" || { echo 'P13-J does not exercise authorization rejection for OTHER' >&2; exit 1; }
rg -Fq ":'j_other_classification_id'" "$root/p13_confirmation_rejections.sql" || { echo 'P13-J lacks OTHER classification evidence' >&2; exit 1; }
rg -Fq "raise exception" "$root/p13_confirmation_rejections.sql" || { echo 'P13 lacks executable failure path' >&2; exit 1; }
! rg -Fq 'confirm_request_transaction(uuid,uuid,uuid,text)' "$root/p13_confirmation_rejections.sql" || { echo 'P13 references the retired confirmation RPC signature' >&2; exit 1; }
for token in fixtures/confirmation_flow_fixture.sql create_complaint_proposal_fixture RECLAMACAO_INTERNA RECLAMACAO propose_request_transaction confirm_request_transaction classification_id authorization attachment_ids uuid_array service_requests protocol assert_true; do
  rg -Fq "$token" "$root/p14_complaint_closed.sql" || { echo "P14 missing end-to-end complaint token: $token" >&2; exit 1; }
done
for marker in P14-VALID-01 P14-VALID-02 P14-VALID-03 P14-VALID-04 P14-I01 P14-I02 P14-I03 P14-I04 P14-I05 P14-I06 P14-I07 P14-I08 P14-I09 P14-I10 P14-I11 P14-I12 P14-A01 P14-A02 P14-A03 P14-A04 P14-A05 P14-A06 P14-A07 P14-A08 P14-R01 P14-R02 P14-R03 P14-R04; do
  rg -Fq "$marker" "$root/p14_complaint_closed.sql" || { echo "P14 missing scenario marker: $marker" >&2; exit 1; }
done
for assertion in 'P14 valid request count is one' 'P14 valid protocol count is one' 'P14 rejected proposal created no service_requests' 'P14 request has no prohibited complaint routing fields'; do
  rg -Fq "$assertion" "$root/p14_complaint_closed.sql" || { echo "P14 missing persisted-state assertion: $assertion" >&2; exit 1; }
done
rg -Fq "raise exception" "$root/p14_complaint_closed.sql" || { echo 'P14 lacks executable failure path' >&2; exit 1; }
! rg -Fq 'confirm_request_transaction(uuid,uuid,uuid,text)' "$root/p14_complaint_closed.sql" || { echo 'P14 references the retired confirmation RPC signature' >&2; exit 1; }
uuid_migration="$root/../../database/migrations/0009_5b2c4_uuid_array_support.sql"
[[ -s "$uuid_migration" ]] || { echo 'UUID-array migration missing' >&2; exit 1; }
rg -Fq "expected='uuid_array'" "$uuid_migration" || { echo 'UUID-array type support missing' >&2; exit 1; }
rg -Fq "is_valid_uuid_string" "$uuid_migration" || { echo 'UUID-array cast validator missing' >&2; exit 1; }
rg -Fq "jsonb_typeof(v)<>'array'" "$uuid_migration" || { echo 'UUID-array rejects non-arrays missing' >&2; exit 1; }
rg -Fq '"attachment_ids":{"type":"uuid_array"}' "$root/fixtures/confirmation_flow_fixture.sql" || { echo 'Fixture does not use uuid_array attachment_ids' >&2; exit 1; }
! rg -Fq '"attachment_ids":{"type":"string"}' "$root/fixtures/confirmation_flow_fixture.sql" || { echo 'Fixture retains string attachment_ids' >&2; exit 1; }
uuid_test="$root/p00_uuid_array_validator.sql"
[[ -s "$uuid_test" ]] || { echo 'UUID-array validator test missing' >&2; exit 1; }
for token in uuid_array "00000000-0000-4000-8000-000000000001" uuid-invalido valid_proposal_fields valid_complaint_payload_strict assert_true; do
  rg -Fq "$token" "$uuid_test" || { echo "UUID-array test missing: $token" >&2; exit 1; }
done
decision_schema_migration="$root/../../database/migrations/0012_5b2c4_deep_decision_schema.sql"
[[ -s "$decision_schema_migration" ]] || { echo 'deep decision schema migration missing' >&2; exit 1; }
for token in valid_decision_plan valid_template_variables valid_fact_refs valid_state_patch valid_state_patch_operation valid_decision_rule_when validate_decision_rule_shape "order by x.priority desc,x.rule_code,x.decision_rule_id" "RULE_CONFLICT_OR_INVALID_PLAN"; do
  rg -Fq "$token" "$decision_schema_migration" "$root/../../edge-functions/support-decision-engine/index.ts" || { echo "deep decision schema support missing: $token" >&2; exit 1; }
done
decision_schema_test="$root/p00_decision_schema_closure.sql"
[[ -s "$decision_schema_test" ]] || { echo 'decision schema closure test missing' >&2; exit 1; }
for marker in PLAN-01 PLAN-02 PLAN-03 PLAN-04 PLAN-05 PLAN-06 PLAN-07 PLAN-08 PLAN-09 PLAN-10 PLAN-11 PLAN-12 RULE-01 RULE-02 RULE-03 RULE-04 RULE-05 RULE-06 RULE-07 RULE-08 RULE-09 RULE-10; do
  rg -Fq "$marker" "$decision_schema_test" || { echo "decision schema closure test missing: $marker" >&2; exit 1; }
done
for token in valid_decision_plan valid_template_variables valid_fact_refs valid_state_patch valid_decision_rule_when expect_error assert_true "raise exception"; do
  rg -Fq "$token" "$decision_schema_test" || { echo "decision schema closure test lacks executable assertion: $token" >&2; exit 1; }
done
! rg -Fq 'jsonb_typeof(p->''template_variables'')=''object''' "$decision_schema_migration" || { echo 'template_variables remains shallow' >&2; exit 1; }
decision_fail_closed_migration="$root/../../database/migrations/0014_5b2c4_decision_validator_fail_closed.sql"
[[ -s "$decision_fail_closed_migration" ]] || { echo 'decision validator fail-closed migration missing' >&2; exit 1; }
for token in 'valid_fact_refs' 'valid_state_patch_operation' 'valid_state_patch' 'valid_template_variables' 'valid_decision_plan' 'valid_decision_rule_when' 'p ?& array' 'is not true' 'return false' 'coalesce(support_vnext_shadow.is_uuid_text'; do
  rg -Fq "$token" "$decision_fail_closed_migration" || { echo "decision validator fail-closed support missing: $token" >&2; exit 1; }
done
for marker in FACT-NULL-01 FACT-NULL-02 FACT-NULL-03 FACT-NULL-04 FACT-NULL-05 FACT-NULL-06 PLAN-N01 PLAN-N02 PLAN-N03 PLAN-N04 PLAN-N05 PLAN-N06 PLAN-N07 PLAN-N08 PLAN-N09 RULE-N01 RULE-N02; do
  rg -Fq "$marker" "$decision_schema_test" || { echo "decision schema NULL regression missing: $marker" >&2; exit 1; }
done
for token in 'get_runtime_decision_rules' 'support_vnext_shadow.decision_rule' 'RULE-07 resolver real' 'RULE-08 resolver real' 'RULE-09 resolver real' 'refresh_draft_release_content_hash' 'publish_ruleset_release'; do
  rg -Fq "$token" "$decision_schema_test" || { echo "decision resolver regression missing: $token" >&2; exit 1; }
done
! rg -Fq 'create temporary table p00_rule_order' "$decision_schema_test" || { echo 'RULE-07/RULE-09 retain synthetic temporary-table resolver' >&2; exit 1; }
! rg -Fq "raise exception 'RULE-08 same-priority conflicting rules'" "$decision_schema_test" || { echo 'RULE-08 retains fabricated exception' >&2; exit 1; }
rg -Fq 'higher-priority runtime rule governs regardless of transport order' "$decision_engine_test" || { echo 'decision engine priority regression test missing' >&2; exit 1; }
for token in ruleset_source_link source_id release_id insert update delete expect_error assert_true P05-A P05-B P05-C P05-D P05-E P05-F P05-G; do
  rg -Fqi "$token" "$root/p05_source_link_insert.sql" || { echo "P05 missing adversarial source-link coverage: $token" >&2; exit 1; }
done
for token in compute_release_content_hash HASH_MISMATCH publish_ruleset_release content_hash release_a release_b expect_error assert_true P08-D P08-E P08-F P08-G; do
  rg -Fq "$token" "$root/p08_hash_integrity.sql" || { echo "P08 missing adversarial hash coverage: $token" >&2; exit 1; }
done
for token in is_setup is_worker is_assert p09_concurrency_barrier "worker in ('A','B')" wait_p09_barrier resolve_shadow_session assert_true; do
  rg -Fq "$token" "$root/p09_session_concurrency.sql" || { echo "P09 missing deterministic concurrency coverage: $token" >&2; exit 1; }
done
rg -Fq 'p09_session_concurrency.sql' "$root/run_concurrency.sh" || { echo 'concurrency runner lacks P09 route' >&2; exit 1; }
for token in A_CONFIRMAR create_complaint_proposal_fixture get_runtime_decision_rules decision_rule service_requests protocol template_variables service_ legacy P10-A P10-B P10-C P10-D P10-E P10-F P10-G P10-H P10-I P10-J assert_true; do
  rg -Fq "$token" "$root/p10_a_confirmar.sql" || { echo "P10 missing end-to-end fail-closed coverage: $token" >&2; exit 1; }
done
integration_p10="$root/../integration/p10_a_confirmar_integration_test.ts"
[[ -s "$integration_p10" ]] || { echo 'P10 integration test missing' >&2; exit 1; }
for token in get_runtime_decision_rules decide A_CONFIRMAR store_shadow_decision render propose_request_transaction service_requests protocol; do
  rg -Fq "$token" "$integration_p10" || { echo "P10 integration chain missing: $token" >&2; exit 1; }
done
for token in 'decide(' 'A_CONFIRMAR' 'RULE_CONFLICT_OR_INVALID_PLAN' 'get_runtime_decision_rules' 'support-renderer' 'renderer rejects' 'P10 decision engine'; do
  rg -Fq "$token" "$root/../unit/p10_a_confirmar_test.ts" || { echo "P10 Deno production-engine coverage missing: $token" >&2; exit 1; }
done
for token in PUBLIC anon authenticated service_role support_vnext_publisher support_vnext_auditor has_table_privilege has_function_privilege to_regprocedure pg_proc SECURITY DEFINER search_path persist_shadow_inbound_message persist_inbound_classification confirm_request_transaction classifier_authorities p15_expected_functions function_identity expected_service_role; do
  rg -Fq "$token" "$root/p15_privileges.sql" || { echo "P15 missing final privilege coverage: $token" >&2; exit 1; }
done
for token in 'prosecdef' 'unclassified function overload' 'RPC matrix'; do
  rg -Fqi "$token" "$root/p15_privileges.sql" || { echo "P15 RPC catalogue matrix missing: $token" >&2; exit 1; }
done
for token in pg_class pg_namespace expected_tables 'support_ruleset_release' 'inbound_classifications' 'feature_flags' 'inactivity_outbox' 'P15 unclassified table'; do
  rg -Fq "$token" "$root/p15_privileges.sql" || { echo "P15 cumulative table matrix missing: $token" >&2; exit 1; }
done
rg -Fq 'persist_confirmation_classification(uuid,uuid,uuid,uuid,uuid,uuid)' "$root/p15_privileges.sql" || { echo 'P15 missing retired wrapper introspection' >&2; exit 1; }
publisher_install="$root/../../database/install/010_provision_operational_roles.sql"
publisher_revoke="$root/../../database/install/011_revoke_operational_roles.sql"
publisher_test="$root/p00_publisher_operational.sql"
for file in "$publisher_install" "$publisher_revoke" "$publisher_test"; do
  [[ -s "$file" ]] || { echo "R5-E publisher artifact missing: $file" >&2; exit 1; }
done
for token in installation_admin_role 'grant support_vnext_publisher' 'service_role' 'authenticated' 'rolcanlogin' 'rolinherit' 'rolsuper' 'NOINHERIT'; do
  rg -Fqi "$token" "$publisher_install" "$publisher_revoke" || { echo "R5-E publisher provisioning missing: $token" >&2; exit 1; }
done
for token in 'SET ROLE' 'RESET ROLE' 'REVOKE'; do
  rg -Fqi "$token" "$publisher_install" "$publisher_revoke" "$root/p00_publisher_operational.sql" "$root/../../docs/permissions-matrix.md" || { echo "R5-E publisher operational flow missing: $token" >&2; exit 1; }
done
for marker in PUB-01 PUB-02 PUB-03 PUB-04 PUB-05 PUB-06 PUB-07 PUB-08 PUB-09 PUB-10 PUB-11 PUB-12 PUB-13; do
  rg -Fq "$marker" "$publisher_test" || { echo "R5-E publisher test missing: $marker" >&2; exit 1; }
done
for token in has_function_privilege has_table_privilege pg_has_role 'grant support_vnext_publisher' 'revoke support_vnext_publisher'; do
  rg -Fq "$token" "$publisher_test" || { echo "R5-E publisher test lacks executable check: $token" >&2; exit 1; }
done
for token in 'p00_publisher_operator' 'SET ROLE support_vnext_publisher' "current_user='support_vnext_publisher'" 'rolinherit' 'PUB-08' 'PUB-13'; do
  rg -Fq "$token" "$publisher_test" || { echo "publisher target-role flow missing: $token" >&2; exit 1; }
done
operational_rollback="$root/../../database/rollback/0012_operational_off.sql"
physical_rollback="$root/../../database/rollback/0012_full_physical_rollback.sql"
rollback_test="$root/p00_rollback_surface.sql"
manifest="$root/../../docs/runtime-object-manifest.md"
for file in "$operational_rollback" "$physical_rollback" "$rollback_test" "$manifest"; do
  [[ -s "$file" ]] || { echo "R5-E rollback artifact missing: $file" >&2; exit 1; }
done
for token in feature_flags kill_switch 'revoke all on all functions' 'revoke usage on schema'; do
  rg -Fqi "$token" "$operational_rollback" || { echo "R5-E operational rollback missing: $token" >&2; exit 1; }
done
for token in 'drop schema if exists support_vnext_shadow cascade' classifier_authorities 'drop role' 'revoke all on all functions' 'service_*'; do
  rg -Fqi "$token" "$physical_rollback" || { echo "R5-E physical rollback missing: $token" >&2; exit 1; }
done
for token in PRE POST POST_OPERATIONAL confirm_request_transaction persist_inbound_classification classifier_authorities publish_ruleset_release feature_flags; do
  rg -Fq "$token" "$rollback_test" || { echo "R5-E rollback surface test missing: $token" >&2; exit 1; }
done
for token in valid_decision_plan valid_fact_refs inbound_classifications_code_status_confirmation_ck; do
  rg -Fq "$token" "$rollback_test" || { echo "rollback surface test missing final 0013/0014 surface: $token" >&2; exit 1; }
done
ci="$root/../../.github/workflows/shadow-static.yml"
[[ -s "$ci" ]] || { echo 'R5-E CI workflow missing' >&2; exit 1; }
for token in 'deno-version: v2.1.4' 'deno fmt --check' 'deno lint' 'deno check edge-functions/*/index.ts' 'deno test --allow-env --allow-read tests/unit tests/shadow' 'bash -n tests/postgres/run_all.sh' 'tests/postgres/verify_static.sh'; do
  rg -Fq "$token" "$ci" || { echo "R5-E CI missing: $token" >&2; exit 1; }
done
manifest_verifier="$root/verify_migration_manifest.sh"
[[ -r "$manifest_verifier" ]] || { echo 'migration/manifest verifier missing or unreadable' >&2; exit 1; }
rg -Fq 'verify_migration_manifest.sh' "$ci" || { echo 'CI does not execute migration/manifest verifier' >&2; exit 1; }
! rg -Fq 'head -14' "$ci" || { echo 'CI still truncates migration inventory' >&2; exit 1; }
for token in 'MIGRATIONS_COVERED: 0001-0019' '0013' '0014' '0015' '0016' '0017' '0018' '0019'; do
  rg -Fq "$token" "$root/../../docs/runtime-object-manifest.md" || { echo "manifest cumulative migration coverage missing: $token" >&2; exit 1; }
done
for token in 'oid::regprocedure' 'to_regprocedure(function_identity)' 'p15_expected_functions' 'function_identity text primary key' 'classification' 'PUBLISHER_RPC' 'RUNTIME_RPC' 'INTERNAL_HELPER' 'unclassified function overload' 'expected_public' 'expected_anon' 'expected_authenticated' 'expected_service_role' 'expected_publisher' 'expected_auditor' 'has_function_privilege' 'expected function missing' 'SELECT matrix' 'INSERT matrix' 'UPDATE matrix' 'DELETE matrix' 'unclassified table'; do
  rg -Fqi "$token" "$root/p15_privileges.sql" || { echo "P15 complete catalog/matrix missing: $token" >&2; exit 1; }
done
! rg -Fq 'continue-on-error' "$ci" || { echo 'R5-E CI masks failures with continue-on-error' >&2; exit 1; }
! rg -Fq '|| true' "$ci" || { echo 'R5-E CI masks failures with || true' >&2; exit 1; }
# 5B.3-C inbound_messages source contract hardening
inbound_source_migration="$root/../../database/migrations/0015_5b3c_fix_inbound_source_contract.sql"
[[ -s "$inbound_source_migration" ]] || { echo 'inbound source contract migration missing' >&2; exit 1; }
inbound_source_migration_compact="$(tr -d ' \t\n' < "$inbound_source_migration")"
for token in 'inbound_message_id,session_id,topic_id,release_id,message_digest,content_hash,source' "'SHADOW_INBOUND'" 'content_hash'; do
  case "$inbound_source_migration_compact" in
    *"$token"*) ;;
    *) echo "inbound source contract migration missing: $token" >&2; exit 1 ;;
  esac
done
for token in 'insert into support_vnext_shadow.inbound_messages' 'create or replace function support_vnext_shadow.persist_shadow_inbound_message'; do
  rg -Fq "$token" "$inbound_source_migration" || { echo "inbound source contract migration missing: $token" >&2; exit 1; }
done

echo 'P01–P15 static structure PASS'
