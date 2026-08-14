#!/usr/bin/env bash
set -u -o pipefail
: "${SUPPORT_VNEXT_TEST_ENV:?set SUPPORT_VNEXT_TEST_ENV=1}"
[[ "$SUPPORT_VNEXT_TEST_ENV" == "1" ]] || { echo "refusing: test environment marker missing" >&2; exit 64; }
: "${TEST_DATABASE_URL:?isolated TEST_DATABASE_URL required}"
case "$TEST_DATABASE_URL" in *prod*|*production*) echo "refusing production-like database URL" >&2; exit 64;; esac
root="$(cd "$(dirname "$0")" && pwd)"
declare -A tests=(
 [P01]=p01_release_overlap.sql [P02]=p02_published_update.sql [P03]=p03_published_delete.sql
 [P04]=p04_content_insert_update_delete.sql [P05]=p05_source_link_insert.sql [P06]=p06_final_states.sql
 [P07]=p07_explicit_rebind.sql [P08]=p08_hash_integrity.sql [P09]=p09_session_concurrency.sql
 [P10]=p10_a_confirmar.sql [P11]=p11_confirm_concurrency.sql [P12]=p12_inbound_reuse.sql
 [P13]=p13_confirmation_rejections.sql [P14]=p14_complaint_closed.sql [P15]=p15_privileges.sql )
failed=0
for id in P01 P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15; do
  file="$root/${tests[$id]}"
  [[ -f "$file" ]] || { echo "$id FAIL missing file" >&2; failed=1; continue; }
  if [[ "$id" == P01 || "$id" == P09 || "$id" == P11 ]]; then
    if CASE_SQL="$file" DATABASE_URL_A="$TEST_DATABASE_URL" DATABASE_URL_B="$TEST_DATABASE_URL" "$root/run_concurrency.sh"; then echo "$id PASS"; else echo "$id FAIL" >&2; failed=1; fi
  elif psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$file"; then echo "$id PASS"; else echo "$id FAIL" >&2; failed=1; fi
done
[[ "$failed" -eq 0 ]] && echo 'SUMMARY PASS P01–P15' || echo 'SUMMARY FAIL'
exit "$failed"
