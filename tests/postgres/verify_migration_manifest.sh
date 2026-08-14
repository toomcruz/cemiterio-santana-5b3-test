#!/usr/bin/env bash
set -euo pipefail

package_root="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
migration_dir="$package_root/database/migrations"
manifest="$package_root/docs/runtime-object-manifest.md"

[[ -d "$migration_dir" && -f "$manifest" ]] || {
  echo 'migration directory or runtime manifest missing' >&2
  exit 1
}

mapfile -t invalid_sql < <(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' ! -regextype posix-extended ! -regex '.*/[0-9]{4}_.+\.sql' -printf '%f\n' | sort)
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

echo "migration manifest PASS: ${numbers[0]}-${numbers[${#numbers[@]}-1]} (${#numbers[@]} migrations)"
