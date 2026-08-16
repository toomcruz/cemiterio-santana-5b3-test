#!/usr/bin/env bash
# Executes coordinated PostgreSQL guarantees only against an explicitly marked isolated DB.
set -u -o pipefail
: "${SUPPORT_VNEXT_TEST_ENV:?set SUPPORT_VNEXT_TEST_ENV=1}"
[[ "$SUPPORT_VNEXT_TEST_ENV" == "1" ]] || { echo "refusing: test environment marker missing" >&2; exit 64; }
: "${DATABASE_URL_A:?isolated connection A required}"
: "${DATABASE_URL_B:?isolated connection B required}"
: "${CASE_SQL:?P01, P09 or P11 SQL file required}"
for url in "$DATABASE_URL_A" "$DATABASE_URL_B"; do
  [[ "$url" =~ ^postgres(ql)?:// ]] || { echo "refusing non-PostgreSQL URL" >&2; exit 64; }
  [[ ! "${url,,}" =~ (prod|production) ]] || { echo "refusing production-like database URL" >&2; exit 64; }
done
case "$(basename "$CASE_SQL")" in p01_release_overlap.sql|p09_session_concurrency.sql|p11_confirm_concurrency.sql|p25_conv_concurrency.sql) ;; *) echo "unsupported concurrency case" >&2; exit 64;; esac
run_case() {
  local url="$1" mode="$2" worker="${3:-}"
  local args=("$url" -X -v ON_ERROR_STOP=1 -v "is_${mode}=true" -f "$CASE_SQL")
  [[ -z "$worker" ]] || args+=( -v "worker=$worker" )
  psql "${args[@]}"
}
run_case "$DATABASE_URL_A" setup
run_case "$DATABASE_URL_A" worker A & a=$!
run_case "$DATABASE_URL_B" worker B & b=$!
wait "$a"; rc_a=$?
wait "$b"; rc_b=$?
# P01 deliberately makes one exclusion-conflict worker fail; P09/P11 must have no worker error.
if [[ "$(basename "$CASE_SQL")" == "p01_release_overlap.sql" ]]; then
  [[ "$rc_a" -eq 0 || "$rc_b" -eq 0 ]] && [[ "$rc_a" -ne 0 || "$rc_b" -ne 0 ]] || { echo "P01 expected exactly one exclusion-conflict worker: A=$rc_a B=$rc_b" >&2; exit 1; }
elif [[ "$rc_a" -ne 0 || "$rc_b" -ne 0 ]]; then
  echo "concurrency workers failed unexpectedly: A=$rc_a B=$rc_b" >&2
  exit 1
fi
run_case "$DATABASE_URL_A" assert
echo "concurrency case PASS: $(basename "$CASE_SQL")"
