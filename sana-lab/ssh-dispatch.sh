#!/usr/bin/env bash
# Installed root-owned as /usr/local/libexec/sana-lab-ssh-dispatch.
set -Eeuo pipefail
umask 077
command_text=${SSH_ORIGINAL_COMMAND:-}
if [[ ! $command_text =~ ^(deploy|rollback-test|diagnose)[[:space:]]([0-9a-f]{40})$ ]]; then
  echo 'LAB_DEPLOY_COMMAND_REJECTED' >&2
  exit 2
fi
exec sudo -n /usr/local/sbin/sana-lab-deploy-entry "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
