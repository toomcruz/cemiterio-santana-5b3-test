#!/usr/bin/env bash
# One-time VPS setup using a dedicated public key. Never copy a private key or LAB token here.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'ROOT_REQUIRED' >&2; exit 2; }
public_key_file=${1:?Usage: bootstrap-deploy-access.sh PATH_TO_ED25519_PUBLIC_KEY}
test -f "$public_key_file" || { echo 'PUBLIC_KEY_MISSING' >&2; exit 2; }
read -r key_type key_body _ <"$public_key_file"
[[ $key_type == ssh-ed25519 && $key_body =~ ^[A-Za-z0-9+/=]+$ ]] || { echo 'INVALID_PUBLIC_KEY' >&2; exit 2; }
test "$(wc -l <"$public_key_file")" = 1 || { echo 'ONE_PUBLIC_KEY_REQUIRED' >&2; exit 2; }
ssh-keygen -lf "$public_key_file" >/dev/null
account=sana-lab-deploy
home_dir=/var/lib/sana-lab-ssh
if ! id "$account" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$home_dir" --shell /bin/bash "$account"
fi
test "$(getent passwd "$account" | cut -d: -f6)" = "$home_dir" || { echo 'DEPLOY_ACCOUNT_HOME_MISMATCH' >&2; exit 2; }
[[ " $(id -nG "$account") " != *' docker '* ]] || { echo 'DEPLOY_ACCOUNT_HAS_DOCKER_ACCESS' >&2; exit 2; }
# OpenSSH can reject public-key access to an account whose shadow field is '!' or '!!'.
# NP is an invalid password hash: key access works but password login cannot match it.
shadow_marker=$(getent shadow "$account" | cut -d: -f2)
if [[ $shadow_marker == '!' || $shadow_marker == '!!' ]]; then
  usermod -p NP "$account"
elif [[ $shadow_marker != NP ]]; then
  echo 'DEPLOY_ACCOUNT_PASSWORD_MARKER_UNEXPECTED' >&2
  exit 2
fi
test "$(getent shadow "$account" | cut -d: -f2)" = NP || { echo 'DEPLOY_ACCOUNT_PASSWORD_MARKER_INVALID' >&2; exit 2; }
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 sana-lab/ssh-dispatch.sh /usr/local/libexec/sana-lab-ssh-dispatch
install -o root -g root -m 0755 sana-lab/deploy-entry.sh /usr/local/sbin/sana-lab-deploy-entry
install -o root -g root -m 0755 sana-lab/deploy-functional-gate.sh /usr/local/sbin/sana-lab-deploy-functional-gate
install -d -o "$account" -g "$account" -m 0700 "$home_dir/.ssh"
expected_key=$(printf 'restrict,command="/usr/local/libexec/sana-lab-ssh-dispatch" %s %s\n' "$key_type" "$key_body")
authorized_keys="$home_dir/.ssh/authorized_keys"
if [[ -e $authorized_keys && $(cat "$authorized_keys") != "$expected_key" ]]; then
  echo 'EXISTING_DEPLOY_KEYS_DIFFER' >&2; exit 2
fi
printf '%s\n' "$expected_key" | install -o "$account" -g "$account" -m 0600 /dev/stdin "$authorized_keys"
sudoers_file=/etc/sudoers.d/sana-lab-deploy
expected_rule="$account ALL=(root) NOPASSWD: /usr/local/sbin/sana-lab-deploy-entry"
if [[ -e $sudoers_file && $(cat "$sudoers_file") != "$expected_rule" ]]; then
  echo 'EXISTING_SUDO_RULE_DIFFERS' >&2; exit 2
fi
printf '%s\n' "$expected_rule" | install -o root -g root -m 0440 /dev/stdin "$sudoers_file"
visudo -cf "$sudoers_file" >/dev/null
echo 'LAB_DEPLOY_ACCESS_READY ACCOUNT=sana-lab-deploy SSH=FORCED_COMMAND SUDO=ONE_ENTRYPOINT'
