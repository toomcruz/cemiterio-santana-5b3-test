#!/usr/bin/env bash
# Deploy solely the existing private LAB bridge; run via restricted SSH or for manual recovery.
set -Eeuo pipefail
umask 077

expected_sha=${1:?Usage: deploy-functional-gate.sh COMMIT_SHA [deploy|rollback-test|diagnose]}
mode=${2:-deploy}
[[ $expected_sha =~ ^[0-9a-f]{40}$ ]] || { echo 'INVALID_COMMIT_SHA' >&2; exit 2; }
[[ $mode == deploy || $mode == rollback-test || $mode == diagnose ]] || { echo 'INVALID_DEPLOY_MODE' >&2; exit 2; }
branch=sana-lab-exumacao-f0-f2
network=n8n-ntga_default
container=sana-lab-bridge
record_dir=${SANA_LAB_DEPLOY_RECORD_DIR:-/var/lib/sana-lab-deploy}
stage=CHECKOUT

# A diagnostic request can read only the already sanitized, root-owned record
# for this exact commit. It cannot inspect other containers or invoke a shell.
if [[ $mode == diagnose ]]; then
  report="$record_dir/diagnostics/$expected_sha.txt"
  [[ -f $report && ! -L $report ]] || { echo 'LAB_DIAGNOSTIC_UNAVAILABLE' >&2; exit 2; }
  test "$(stat -c '%u' "$report")" = "$(id -u)" || { echo 'LAB_DIAGNOSTIC_UNTRUSTED' >&2; exit 2; }
  cat "$report"
  exit 0
fi

# Reject a stale run before changing the runtime.
git fetch --no-tags origin "$branch"
git switch "$branch"
git merge --ff-only FETCH_HEAD
test "$(git rev-parse HEAD)" = "$expected_sha" || { echo 'COMMIT_MISMATCH' >&2; exit 2; }
test -z "$(git status --porcelain)" || { echo 'DIRTY_CHECKOUT' >&2; exit 2; }
test "$(git rev-parse FETCH_HEAD)" = "$expected_sha" || { echo 'BRANCH_MOVED' >&2; exit 2; }

hash_file() { sha256sum "$1" | cut -d ' ' -f 1; }
container_hash() { docker exec "$1" sha256sum "$2" | cut -d ' ' -f 1; }
engine_hash=$(hash_file sana-lab/engine.ts)
recadastro_hash=$(hash_file sana-lab/recadastro.ts)
network_id=$(docker network inspect "$network" --format '{{.ID}}')

check_container() {
  local name=$1 expected_id=$2 expected_engine=$3 expected_recadastro=$4 ports
  test "$(docker inspect "$name" --format '{{.State.Running}}')" = true
  test "$(docker inspect "$name" --format '{{.Image}}')" = "$expected_id"
  test "$(docker inspect "$name" --format '{{len .NetworkSettings.Networks}}')" = 1
  test "$(docker inspect "$name" --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}')" = "$network_id"
  ports=$(docker inspect "$name" --format '{{json .HostConfig.PortBindings}}')
  [[ $ports == null || $ports == '{}' ]]
  test "$(docker inspect "$name" --format '{{.HostConfig.ReadonlyRootfs}}')" = true
  test "$(container_hash "$name" /app/sana-lab/engine.ts)" = "$expected_engine"
  test "$(container_hash "$name" /app/sana-lab/recadastro.ts)" = "$expected_recadastro"
  # Deno 2.1.4 eval does not accept --allow-net; no credential is involved here.
  docker exec "$name" deno eval \
    'const r = await fetch("http://127.0.0.1:8765/lab/v1/turn", {method:"POST"}); if (r.status !== 401) throw Error("LAB_PROBE_NOT_401");' >/dev/null
}

old_id=$(docker inspect "$container" --format '{{.Image}}')
old_image=$(docker inspect "$container" --format '{{.Config.Image}}')
old_engine=$(container_hash "$container" /app/sana-lab/engine.ts)
old_recadastro=$(container_hash "$container" /app/sana-lab/recadastro.ts)
check_container "$container" "$old_id" "$old_engine" "$old_recadastro" || { echo 'OLD_BRIDGE_UNHEALTHY' >&2; exit 2; }
old_commit=$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)
if [[ ! $old_commit =~ ^[0-9a-f]{40}$ && $old_image =~ ^sana-lab-bridge:([0-9a-f]{7,40})$ ]]; then
  old_commit=$(git rev-parse --verify "${BASH_REMATCH[1]}^{commit}" 2>/dev/null || true)
fi
if [[ $old_commit =~ ^[0-9a-f]{40}$ ]] &&
   [[ $(git show "$old_commit:sana-lab/engine.ts" | sha256sum | cut -d ' ' -f 1) == "$old_engine" ]] &&
   [[ $(git show "$old_commit:sana-lab/recadastro.ts" | sha256sum | cut -d ' ' -f 1) == "$old_recadastro" ]]; then
  :
else
  old_commit=UNKNOWN
fi
state_mount=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')
secret_mount=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')
[[ -n $state_mount && -d $state_mount && -n $secret_mount && -f $secret_mount ]] || { echo 'LAB_MOUNTS_MISSING' >&2; exit 2; }
test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.RW}}{{end}}{{end}}')" = true
test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.RW}}{{end}}{{end}}')" = false
test "$(docker inspect "$container" --format '{{range .Config.Env}}{{if eq . "SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token"}}yes{{end}}{{end}}')" = yes

short_sha=${expected_sha:0:12}
image="sana-lab-bridge:$short_sha"
backup="sana-lab-bridge-before-$short_sha-$(date -u +%Y%m%d%H%M%S)-$$"
if docker container inspect "$backup" >/dev/null 2>&1; then echo 'BACKUP_NAME_COLLISION' >&2; exit 2; fi
stage=BUILD
docker build --label "org.opencontainers.image.revision=$expected_sha" -f sana-lab/Dockerfile -t "$image" .
new_id=$(docker image inspect "$image" --format '{{.Id}}')
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$expected_sha"
# A newer push invalidates this deployment before the existing container is stopped.
test "$(git ls-remote origin "refs/heads/$branch" | cut -f1)" = "$expected_sha" || {
  echo 'REMOTE_BRANCH_MOVED' >&2; exit 2;
}

stopped=0
renamed=0
record() {
  mkdir -p "$record_dir"
  local tmp
  tmp=$(mktemp "$record_dir/active.XXXXXX")
  printf 'timestamp=%s\nstatus=%s\ncommit=%s\nimage=%s\nimage_id=%s\nengine_sha256=%s\nrecadastro_sha256=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" "$5" "$6" >"$tmp"
  mv -f "$tmp" "$record_dir/active.txt"
}
rollback_on_exit() {
  local status=$? rollback_ok=1
  trap - EXIT
  (( status != 0 )) || return 0
  echo "DEPLOY_FAILED_STAGE=$stage EXIT_CODE=$status" >&2
  if (( stopped == 0 )); then exit "$status"; fi
  if (( renamed == 1 )); then
    # Collect only the new image, before stopping/removing it. The helper reads
    # explicitly selected inspect fields and never prints raw Docker logs.
    if [[ $stage != RENAME_OLD ]]; then
      capture_failed_container || echo 'DIAGNOSTIC_CAPTURE_FAILED' >&2
    fi
    docker stop "$container" >/dev/null 2>&1 || true
    docker rm "$container" >/dev/null 2>&1 || true
    docker rename "$backup" "$container" || rollback_ok=0
  fi
  docker start "$container" >/dev/null || rollback_ok=0
  if (( rollback_ok == 1 )) && check_container "$container" "$old_id" "$old_engine" "$old_recadastro"; then
    record ROLLED_BACK "$old_commit" "$old_image" "$old_id" "$old_engine" "$old_recadastro" || rollback_ok=0
  else
    rollback_ok=0
  fi
  if (( rollback_ok == 0 )); then echo 'ROLLBACK_CONFIRMED=NO' >&2; exit 91; fi
  echo "ROLLBACK_CONFIRMED=YES COMMIT=$old_commit IMAGE=$old_image IMAGE_ID=$old_id"
  if [[ $mode == rollback-test && $status == 76 ]]; then exit 0; fi
  exit "$status"
}

capture_failed_container() {
  mkdir -p "$record_dir/diagnostics"
  local target=${1:-$container} failed_stage=${2:-$stage} report tmp
  report="$record_dir/diagnostics/$expected_sha.txt"
  tmp=$(mktemp "$record_dir/diagnostics/.capture.XXXXXX") || return 1
  if python3 sana-lab/diagnose-container.py "$target" "$expected_sha" "$image" "$failed_stage" >"$tmp"; then
    mv -f "$tmp" "$report" || return 1
    cat "$report"
  else
    rm -f "$tmp"
    return 1
  fi
}

# Reproduce the candidate on the VPS's actual private Docker network before
# stopping the working bridge. Only this unique LAB state is writable; the
# existing token mount stays read-only and no host port is published.
short_sha=${expected_sha:0:12}
preflight_id=$(date -u +%Y%m%d%H%M%S)-$$
preflight="sana-lab-preflight-$short_sha-$preflight_id"
mkdir -p "$record_dir"
preflight_root=$(mktemp -d "$record_dir/preflight.XXXXXX")
chmod 0700 "$preflight_root"
preflight_state="$preflight_root/state"
install -d -o 1000 -g 1000 -m 0700 "$preflight_state"
if docker container inspect "$preflight" >/dev/null 2>&1; then
  echo 'PREFLIGHT_CONTAINER_NAME_COLLISION' >&2
  exit 2
fi
preflight_live=0
preflight_cleanup() {
  if (( preflight_live == 1 )); then docker rm -f "$preflight" >/dev/null 2>&1 || true; fi
}
trap preflight_cleanup EXIT
stage=PREFLIGHT_START
docker run -d --name "$preflight" --hostname "$preflight" \
  --network "$network" --read-only --user 1000:1000 --security-opt no-new-privileges \
  --restart no --expose 8765 \
  --mount "type=bind,src=$preflight_state,dst=/lab-state" \
  --mount "type=bind,src=$secret_mount,dst=/run/secrets/sana_lab_token,readonly" \
  -e DENO_DIR=/lab-state/.deno -e SANA_LAB_STATE_DIR=/lab-state -e SANA_LAB_BIND_HOST=0.0.0.0 \
  -e SANA_LAB_PORT=8765 -e SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token \
  "$image" >/dev/null
preflight_live=1
stage=PREFLIGHT_VERIFY
test "$(docker inspect "$preflight" --format '{{.Config.Image}}')" = "$image"
test "$(docker inspect "$preflight" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$expected_sha"
test "$(docker inspect "$preflight" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')" = "$preflight_state"
test "$(docker inspect "$preflight" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')" = "$secret_mount"
test "$(docker inspect "$preflight" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.RW}}{{end}}{{end}}')" = false
test "$(docker inspect "$preflight" --format '{{range .Config.Env}}{{if eq . "DENO_DIR=/lab-state/.deno"}}yes{{end}}{{end}}')" = yes
preflight_ready=0
for attempt in {1..20}; do
  if check_container "$preflight" "$new_id" "$engine_hash" "$recadastro_hash"; then
    preflight_ready=1
    break
  fi
  if (( attempt == 20 )); then break; fi
  sleep 0.5
done
if (( preflight_ready != 1 )); then
  capture_failed_container "$preflight" "$stage" || echo 'DIAGNOSTIC_CAPTURE_FAILED' >&2
  echo 'PREFLIGHT_FAILED_STAGE=VERIFY' >&2
  exit 1
fi
stage=PREFLIGHT_PROBE
if ! docker exec "$preflight" deno run --allow-read=/run/secrets/sana_lab_token --allow-net=127.0.0.1:8765 \
  /app/sana-lab/deploy-probe.ts "$expected_sha" >/dev/null; then
  capture_failed_container "$preflight" "$stage" || echo 'DIAGNOSTIC_CAPTURE_FAILED' >&2
  echo 'PREFLIGHT_FAILED_STAGE=AUTHENTICATED_PROBE' >&2
  exit 1
fi
docker rm "$preflight" >/dev/null
preflight_live=0
trap - EXIT
echo "PREFLIGHT_OK COMMIT=$expected_sha IMAGE=$image NETWORK=$network STATE=ISOLATED AUTH=PASS PUBLIC_PORTS=NO"

trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

stage=STOP_OLD
docker stop "$container" >/dev/null
stopped=1
stage=RENAME_OLD
docker rename "$container" "$backup"
renamed=1
stage=START_NEW
docker run -d --name "$container" --hostname "$container" \
  --network "$network" --network-alias "$container" \
  --read-only --user 1000:1000 --security-opt no-new-privileges \
  --restart unless-stopped --expose 8765 \
  --mount "type=bind,src=$state_mount,dst=/lab-state" \
  --mount "type=bind,src=$secret_mount,dst=/run/secrets/sana_lab_token,readonly" \
  -e DENO_DIR=/lab-state/.deno -e SANA_LAB_STATE_DIR=/lab-state -e SANA_LAB_BIND_HOST=0.0.0.0 \
  -e SANA_LAB_PORT=8765 -e SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token \
  "$image" >/dev/null

stage=VERIFY_NEW
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "$image"
test "$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$expected_sha"
test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')" = "$state_mount"
test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')" = "$secret_mount"
test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.RW}}{{end}}{{end}}')" = false
for attempt in {1..20}; do
  if check_container "$container" "$new_id" "$engine_hash" "$recadastro_hash"; then break; fi
  if (( attempt == 20 )); then echo 'NEW_BRIDGE_PROBE_FAILED' >&2; exit 1; fi
  sleep 0.5
done
docker exec "$container" deno run --allow-read=/run/secrets/sana_lab_token --allow-net=127.0.0.1:8765 \
  /app/sana-lab/deploy-probe.ts "$expected_sha"

if [[ $mode == rollback-test ]]; then
  stage=SYNTHETIC_FAILURE
  echo 'SYNTHETIC_LAB_FAILURE_AFTER_HEALTH_PROBE' >&2
  exit 76
fi
stage=RECORD_ACTIVE
record ACTIVE "$expected_sha" "$image" "$new_id" "$engine_hash" "$recadastro_hash"
trap - EXIT INT TERM
echo "DEPLOY_OK COMMIT=$expected_sha IMAGE=$image IMAGE_ID=$new_id ENGINE_SHA256=$engine_hash RECADASTRO_SHA256=$recadastro_hash BACKUP=$backup PUBLIC_PORTS=NO"
