#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/sana-lab-deploy-entry.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'ROOT_REQUIRED' >&2; exit 2; }
[[ $# == 2 && ( $1 == deploy || $1 == rollback-test || $1 == diagnose ) && $2 =~ ^[0-9a-f]{40}$ ]] || {
  echo 'INVALID_DEPLOY_REQUEST' >&2; exit 2;
}
checkout=/docker/sana-lab-bridge-src
test -d "$checkout/.git" && test "$(stat -c '%u' "$checkout")" = 0 || {
  echo 'TRUSTED_CHECKOUT_REQUIRED' >&2; exit 2;
}
test -f "$checkout/sana-lab/deploy-functional-gate.sh" &&
  test ! -L "$checkout/sana-lab/deploy-functional-gate.sh" &&
  test "$(stat -c '%u' "$checkout/sana-lab/deploy-functional-gate.sh")" = 0 || {
  echo 'TRUSTED_DEPLOY_SCRIPT_REQUIRED' >&2; exit 2;
}
cd "$checkout"
installed=/usr/local/sbin/sana-lab-deploy-functional-gate
test -f "$installed" && test ! -L "$installed" && test "$(stat -c '%u' "$installed")" = 0 || {
  echo 'INSTALLED_DEPLOY_SCRIPT_REQUIRED' >&2; exit 2;
}
# Changes to the privileged deployment procedure require a separate bootstrap review.
git fetch --no-tags origin sana-lab-exumacao-f0-f2
test "$(git rev-parse FETCH_HEAD)" = "$2" || { echo 'DEPLOY_BRANCH_MOVED' >&2; exit 2; }
candidate_hash=$(git show "$2:sana-lab/deploy-functional-gate.sh" | sha256sum | cut -d ' ' -f 1)
installed_hash=$(sha256sum "$installed" | cut -d ' ' -f 1)
test "$candidate_hash" = "$installed_hash" || { echo 'DEPLOY_SCRIPT_UPDATE_NEEDS_BOOTSTRAP' >&2; exit 2; }
exec bash "$installed" "$2" "$1"
