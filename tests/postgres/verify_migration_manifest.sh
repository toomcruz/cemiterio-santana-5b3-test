#!/usr/bin/env bash
set -euo pipefail

package_root="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
migration_dir="$package_root/database/migrations"
manifest="$package_root/docs/runtime-object-manifest.md"

[[ -d "$migration_dir" && -f "$manifest" ]] || {
  echo 'migration directory or runtime manifest missing' >&2
  exit 1
}

mapfile -t invalid_sql < <(find "$migration_dir" -maxdepth 1 -regextype posix-extended -type f -name '*.sql' ! -regex '.*/([0-9]{4}|[0-9]{14})_.+\.sql' -printf '%f\n' | sort)
(( ${#invalid_sql[@]} == 0 )) || {
  echo "non-migration SQL file present: ${invalid_sql[*]}" >&2
  exit 1
}

mapfile -t files < <(find "$migration_dir" -maxdepth 1 -type f -regextype posix-extended -regex '.*/[0-9]{4}_.+\.sql' -printf '%f\n' | sort)
(( ${#files[@]} > 0 )) || { echo 'no migrations found' >&2; exit 1; }

numbers=()
for file in "${files[@]}"; do numbers+=("${file:0:4}"); done
duplicates="$(printf '%s\n' "${numbers[@]}" | uniq -d)"
[[ -z "$duplicates" ]] || { echo "duplicate migration prefix: $duplicates" >&2; exit 1; }

for index in "${!numbers[@]}"; do
  expected="$(printf '%04d' "$((index + 1))")"
  [[ "${numbers[$index]}" == "$expected" ]] || {
    echo "migration sequence gap: expected $expected, found ${numbers[$index]}" >&2
    exit 1
  }
done

marker="$(rg -N '^MIGRATIONS_COVERED: [0-9]{4}-[0-9]{4}$' "$manifest" || true)"
[[ -n "$marker" ]] || { echo 'manifest MIGRATIONS_COVERED marker missing or malformed' >&2; exit 1; }
covered_min="${marker#*: }"
covered_min="${covered_min%-*}"
covered_max="${marker##*-}"
[[ "$covered_min" == "${numbers[0]}" && "$covered_max" == "${numbers[${#numbers[@]}-1]}" ]] || {
  echo "manifest range $covered_min-$covered_max does not match migrations ${numbers[0]}-${numbers[${#numbers[@]}-1]}" >&2
  exit 1
}

mapfile -t timestamp_files < <(find "$migration_dir" -maxdepth 1 -regextype posix-extended -type f -regex '.*/[0-9]{14}_.+\.sql' -printf '%f\n' | sort)
timestamp_numbers=()
for file in "${timestamp_files[@]}"; do timestamp_numbers+=("${file:0:14}"); done
timestamp_marker="$(rg -N '^TIMESTAMP_MIGRATIONS: [0-9]{14}( [0-9]{14})*$' "$manifest" || true)"
if (( ${#timestamp_numbers[@]} > 0 )); then
  [[ -n "$timestamp_marker" ]] || { echo 'timestamp migration manifest missing' >&2; exit 1; }
  timestamp_duplicates="$(printf '%s\n' "${timestamp_numbers[@]}" | uniq -d)"
  [[ -z "$timestamp_duplicates" ]] || { echo "duplicate timestamp migration: $timestamp_duplicates" >&2; exit 1; }
  [[ "${timestamp_marker#*: }" == "${timestamp_numbers[*]}" ]] || {
    echo 'timestamp migrations do not match explicit manifest' >&2; exit 1;
  }
elif [[ -n "$timestamp_marker" ]]; then
  echo 'manifest lists absent timestamp migrations' >&2; exit 1
fi

echo "migration manifest PASS: ${numbers[0]}-${numbers[${#numbers[@]}-1]} (${#numbers[@]} historical), ${#timestamp_numbers[@]} timestamp migrations"
