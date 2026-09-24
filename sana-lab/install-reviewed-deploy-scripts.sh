#!/usr/bin/env bash
# Administrative one-time install of the reviewed restricted deploy sources.
# Run only as root after an independent review of the exact commit and key fingerprint.
set -Eeuo pipefail
umask 077

sha=${1:?usage: install-reviewed-deploy-scripts.sh FULL_SHA PUBLIC_KEY_FILE EXPECTED_SHA256_FINGERPRINT}
pubkey=${2:?usage: install-reviewed-deploy-scripts.sh FULL_SHA PUBLIC_KEY_FILE EXPECTED_SHA256_FINGERPRINT}
expected_fingerprint=${3:?usage: install-reviewed-deploy-scripts.sh FULL_SHA PUBLIC_KEY_FILE EXPECTED_SHA256_FINGERPRINT}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo INVALID_COMMIT_SHA >&2; exit 2; }
[[ $expected_fingerprint =~ ^SHA256:[A-Za-z0-9+/]{20,}=?$ ]] || { echo INVALID_KEY_FINGERPRINT >&2; exit 2; }
test "$(id -u)" = 0 || { echo ROOT_REQUIRED >&2; exit 2; }

checkout=/docker/sana-lab-bridge-src
branch=sana-lab-exumacao-f0-f2
deploy_user=sana-lab-deploy
sudo_entry=/usr/local/sbin/sana-lab-deploy-entry
destinations=(
  /usr/local/sbin/sana-lab-deploy-entry
  /usr/local/libexec/sana-lab-ssh-dispatch
  /usr/local/sbin/sana-lab-deploy-functional-gate
)
sources=(
  sana-lab/deploy-entry.sh
  sana-lab/ssh-dispatch.sh
  sana-lab/deploy-functional-gate.sh
)

test -d "$checkout/.git" && test "$(stat -c '%u' "$checkout")" = 0 || { echo TRUSTED_CHECKOUT_REQUIRED >&2; exit 2; }
test ! -L "$pubkey" && test -f "$pubkey" || { echo PUBLIC_KEY_FILE_REQUIRED >&2; exit 2; }
cd "$checkout"
test "$(git branch --show-current)" = "$branch" || { echo WRONG_BRANCH >&2; exit 2; }
test "$(git rev-parse HEAD)" = "$sha" || { echo CHECKOUT_SHA_MISMATCH >&2; exit 2; }
test -z "$(git status --porcelain)" || { echo DIRTY_CHECKOUT >&2; exit 2; }

# Explicitly select and verify the automation key by its independently supplied
# public-key fingerprint. Never scan for or print an arbitrary first key.
actual_fingerprint=$(ssh-keygen -lf "$pubkey" -E sha256 | awk 'NR==1 {print $2}')
test "$actual_fingerprint" = "$expected_fingerprint" || { echo AUTOMATION_KEY_FINGERPRINT_MISMATCH >&2; exit 2; }
account_line=$(getent passwd "$deploy_user") || { echo DEPLOY_ACCOUNT_MISSING >&2; exit 2; }
account_uid=$(cut -d: -f3 <<<"$account_line")
account_home=$(cut -d: -f6 <<<"$account_line")
test "$account_home" = /var/lib/sana-lab-ssh || { echo DEPLOY_HOME_MISMATCH >&2; exit 2; }
test "$(passwd -S "$deploy_user" | awk '{print $2}')" = NP || { echo DEPLOY_PASSWORD_STATE_MISMATCH >&2; exit 2; }
if id -nG "$deploy_user" | tr ' ' '\n' | grep -Fxq docker; then echo DEPLOY_USER_IN_DOCKER_GROUP >&2; exit 2; fi

keys_file="$account_home/.ssh/authorized_keys"
test -d "$account_home/.ssh" && test ! -L "$account_home/.ssh" || { echo SSH_DIRECTORY_REQUIRED >&2; exit 2; }
test "$(stat -c '%u' "$account_home/.ssh")" = "$account_uid" || { echo SSH_DIRECTORY_OWNER_MISMATCH >&2; exit 2; }
ssh_dir_mode=$(stat -c '%a' "$account_home/.ssh")
(( (8#$ssh_dir_mode & 077) == 0 )) || { echo SSH_DIRECTORY_MODE_TOO_OPEN >&2; exit 2; }
test -f "$keys_file" && test ! -L "$keys_file" || { echo AUTHORIZED_KEYS_REQUIRED >&2; exit 2; }
test "$(stat -c '%u' "$keys_file")" = "$account_uid" || { echo AUTHORIZED_KEYS_OWNER_MISMATCH >&2; exit 2; }
key_mode=$(stat -c '%a' "$keys_file")
(( (8#$key_mode & 077) == 0 )) || { echo AUTHORIZED_KEYS_MODE_TOO_OPEN >&2; exit 2; }
python3 - "$keys_file" "$pubkey" <<'PY'
import sys
keys_path, public_path = sys.argv[1:]
public = open(public_path, encoding="utf-8").read().split()
if len(public) < 2:
    raise SystemExit("PUBLIC_KEY_INVALID")
expected = public[:2]
required_options = 'restrict,command="/usr/local/libexec/sana-lab-ssh-dispatch" '
matches = 0
for line in open(keys_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if not line.startswith(required_options):
        continue
    fields = line[len(required_options):].split()
    if len(fields) >= 2 and fields[:2] == expected:
        matches += 1
if matches != 1:
    raise SystemExit("AUTOMATION_KEY_RESTRICTED_ENTRY_COUNT_INVALID")
print("AUTOMATION_KEY_SELECTION=PASS FORCED_COMMAND=PASS")
PY

visudo -c >/dev/null || { echo SUDOERS_SYNTAX_INVALID >&2; exit 2; }
sudo_listing=$(sudo -l -U "$deploy_user" 2>/dev/null) || { echo SUDO_RULE_UNAVAILABLE >&2; exit 2; }
python3 - "$sudo_listing" <<'PY'
import re, sys
lines = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
commands = [line for line in lines if re.match(r"^\(.*\)\s+(?:NOPASSWD:\s*)?[/A-Za-z]", line)]
if commands != ["(root) NOPASSWD: /usr/local/sbin/sana-lab-deploy-entry"]:
    raise SystemExit("SUDO_SCOPE_MISMATCH")
print("SUDO_SCOPE=PASS SINGLE_ROOT_ENTRYPOINT=PASS")
PY

for i in "${!destinations[@]}"; do
  source=${sources[$i]}
  target=${destinations[$i]}
  directory=$(dirname "$target")
  test -d "$directory" && test ! -L "$directory" && test "$(stat -c '%u' "$directory")" = 0 || {
    echo PRIVILEGED_TARGET_DIRECTORY_REQUIRED >&2; exit 2;
  }
  git cat-file -e "$sha:$source" || { echo REVIEWED_SOURCE_MISSING >&2; exit 2; }
  test -f "$target" && test ! -L "$target" && test "$(stat -c '%u' "$target")" = 0 || {
    echo INSTALLED_ROOT_OWNED_SCRIPT_REQUIRED >&2; exit 2;
  }
done

container=sana-lab-bridge
snapshot_bridge() {
  python3 - "$container" <<'PY'
import hashlib, json, subprocess, sys
name=sys.argv[1]
raw=subprocess.run(["docker","inspect",name],capture_output=True,text=True,check=True).stdout
obj=json.loads(raw)[0]
 mounts=sorted((m.get("Destination"),m.get("Source"),m.get("Type"),m.get("RW")) for m in obj.get("Mounts",[]))
networks=sorted(obj.get("NetworkSettings",{}).get("Networks",{}).keys())
ports=obj.get("HostConfig",{}).get("PortBindings")
if obj.get("State",{}).get("Running") is not True or ports not in (None, {}):
    raise SystemExit("BRIDGE_BASELINE_NOT_HEALTHY_PRIVATE")
if networks != ["n8n-ntga_default"] or obj.get("HostConfig",{}).get("ReadonlyRootfs") is not True:
    raise SystemExit("BRIDGE_BASELINE_SECURITY_MISMATCH")
hashes=[]
for path in ("/app/sana-lab/engine.ts","/app/sana-lab/recadastro.ts"):
    result=subprocess.run(["docker","exec",name,"sha256sum",path],capture_output=True,text=True,check=True)
    hashes.append(result.stdout.split()[0])
snapshot={"id":obj.get("Id"),"image_id":obj.get("Image"),"image":obj.get("Config",{}).get("Image"),
          "running":obj.get("State",{}).get("Running"),"restart_count":obj.get("RestartCount"),
          "network":networks,"ports":ports,"readonly":obj.get("HostConfig",{}).get("ReadonlyRootfs"),
          "user":obj.get("Config",{}).get("User"),"mounts":mounts,"source_hashes":hashes}
print(hashlib.sha256(json.dumps(snapshot,sort_keys=True,separators=(",",":")).encode()).hexdigest())
PY
}
bridge_before=$(snapshot_bridge) || { echo BRIDGE_BASELINE_FAILED >&2; exit 2; }
account_before=$(sha256sum "$keys_file" | cut -d ' ' -f1)
sudo_before=$(printf '%s' "$sudo_listing" | sha256sum | cut -d ' ' -f1)
admin_dir=/var/backups/sana-lab-admin
install -d -o root -g root -m 0700 "$admin_dir"
backup="$admin_dir/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
install -d -o root -g root -m 0700 "$backup"
for i in "${!destinations[@]}"; do
  target=${destinations[$i]}
  cp -a -- "$target" "$backup/$(basename "$target")"
done
{
  printf 'commit=%s\nkey_fingerprint=%s\n' "$sha" "$actual_fingerprint"
  for i in "${!destinations[@]}"; do
    target=${destinations[$i]}
    printf '%s  %s\n' "$(sha256sum "$target" | cut -d ' ' -f1)" "$target"
  done
} > "$backup/MANIFEST.txt"
chmod 0600 "$backup/MANIFEST.txt"

installed=0
restore_scripts() {
  local failed=0
  for i in "${!destinations[@]}"; do
    target=${destinations[$i]}
    saved="$backup/$(basename "$target")"
    directory=$(dirname "$target")
    tmp=$(mktemp "$directory/.sana-lab-rollback.XXXXXX") || { failed=1; continue; }
    if ! cp -a -- "$saved" "$tmp" || ! mv -f -- "$tmp" "$target"; then
      rm -f "$tmp"
      failed=1
    fi
  done
  (( failed == 0 )) && echo ADMIN_SCRIPT_ROLLBACK=PASS || echo ADMIN_SCRIPT_ROLLBACK=FAIL >&2
  return "$failed"
}
on_failure() {
  local status=$?
  trap - EXIT
  if (( status != 0 && installed == 1 )); then restore_scripts || status=90; fi
  exit "$status"
}
trap on_failure EXIT

for i in "${!destinations[@]}"; do
  source=${sources[$i]}
  target=${destinations[$i]}
  directory=$(dirname "$target")
  tmp=$(mktemp "$directory/.sana-lab-install.XXXXXX")
  if ! git show "$sha:$source" > "$tmp"; then rm -f "$tmp"; echo REVIEWED_SOURCE_READ_FAILED >&2; exit 1; fi
  chown root:root "$tmp"
  chmod 0755 "$tmp"
  mv -f -- "$tmp" "$target"
  installed=1
done

for i in "${!destinations[@]}"; do
  source=${sources[$i]}
  target=${destinations[$i]}
  expected=$(git show "$sha:$source" | sha256sum | cut -d ' ' -f1)
  actual=$(sha256sum "$target" | cut -d ' ' -f1)
  test "$actual" = "$expected" || { echo INSTALLED_SOURCE_HASH_MISMATCH >&2; exit 1; }
  test "$(stat -c '%u:%g:%a' "$target")" = 0:0:755 || { echo INSTALLED_SOURCE_MODE_MISMATCH >&2; exit 1; }
done
visudo -c >/dev/null || { echo SUDOERS_POSTCHECK_FAILED >&2; exit 1; }
test "$(sha256sum "$keys_file" | cut -d ' ' -f1)" = "$account_before" || { echo AUTHORIZED_KEYS_CHANGED >&2; exit 1; }
test "$(printf '%s' "$(sudo -l -U "$deploy_user" 2>/dev/null)" | sha256sum | cut -d ' ' -f1)" = "$sudo_before" || { echo SUDO_SCOPE_CHANGED >&2; exit 1; }
test "$(snapshot_bridge)" = "$bridge_before" || { echo BRIDGE_CHANGED_DURING_ADMIN_INSTALL >&2; exit 1; }
installed=0
trap - EXIT
printf 'ADMIN_INSTALL=PASS\nREVIEWED_COMMIT=%s\nAUTOMATION_KEY_FINGERPRINT=%s\nBACKUP=%s\nAUTHORIZED_KEYS_UNCHANGED=YES\nSUDO_SCOPE_UNCHANGED=YES\nBRIDGE_UNCHANGED=YES\n' "$sha" "$actual_fingerprint" "$backup"
