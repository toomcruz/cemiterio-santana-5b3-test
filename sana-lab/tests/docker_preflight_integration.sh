#!/usr/bin/env bash
# Real Docker integration: full isolated candidate preflight and verified cleanup.
set -Eeuo pipefail
umask 077
commit=${1:?usage: docker_preflight_integration.sh FULL_COMMIT_SHA}
image=${2:?usage: docker_preflight_integration.sh FULL_COMMIT_SHA IMAGE}
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo INVALID_COMMIT_SHA >&2; exit 2; }
short_sha=${commit:0:12}
run_id=${GITHUB_RUN_ID:-local}
attempt=${GITHUB_RUN_ATTEMPT:-1}
network="sana-lab-preflight-ci-$run_id-$attempt"
container="sana-lab-preflight-$short_sha-$(date -u +%Y%m%d%H%M%S)-$$"
root="${RUNNER_TEMP:-/tmp}/sana-lab-docker-preflight-$run_id-$attempt"
state="$root/state"
token_file="$root/token"
stage=SETUP
cleanup_done=0

diagnose() {
  local where=$1
  if docker container inspect "$container" >/dev/null 2>&1; then
    python3 sana-lab/diagnose-container.py "$container" "$commit" "$image" "$where" || echo DIAGNOSTIC_CAPTURE_FAILED
  else
    printf 'DIAGNOSTIC_SHA=%s\nFAILED_IMAGE=%s\nDEPLOY_FAILED_STAGE=%s\nCONTAINER_STATUS=NOT_CREATED\n' "$commit" "$image" "$where"
    printf 'STARTUP_LOG_TAIL_SANITIZED_BEGIN\nLOGS_UNAVAILABLE_CONTAINER_NOT_CREATED\nSTARTUP_LOG_TAIL_SANITIZED_END\n'
  fi
}

cleanup() {
  local status=$? cleanup_error=0
  trap - EXIT
  if docker container inspect "$container" >/dev/null 2>&1; then
    if docker rm -f "$container" >/dev/null 2>&1; then
      echo PREFLIGHT_CONTAINER_CLEANUP=PASS
    else
      diagnose PREFLIGHT_CLEANUP
      echo PREFLIGHT_CLEANUP_FAILED=CONTAINER_REMOVE >&2
      cleanup_error=1
    fi
  fi
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    if docker network inspect "$network" >/dev/null 2>&1; then
      if docker network rm "$network" >/dev/null 2>&1; then
        echo PREFLIGHT_NETWORK_CLEANUP=PASS
      else
        echo PREFLIGHT_CLEANUP_FAILED=NETWORK_REMOVE >&2
        cleanup_error=1
      fi
    fi
    if [[ -d $root && ! -L $root && $root == "${RUNNER_TEMP:-/tmp}"/sana-lab-docker-preflight-* ]]; then
      if sudo python3 - "$root" "${RUNNER_TEMP:-/tmp}" <<'PY'
import os, shutil, sys
root=os.path.realpath(sys.argv[1])
base=os.path.realpath(sys.argv[2])
if os.path.islink(sys.argv[1]) or os.path.dirname(root) != base or not os.path.basename(root).startswith("sana-lab-docker-preflight-"):
    raise SystemExit("STATE_PATH_GUARD")
shutil.rmtree(root)
PY
      then
        test ! -e "$root" && echo PREFLIGHT_STATE_CLEANUP=PASS
      else
        echo PREFLIGHT_CLEANUP_FAILED=STATE_REMOVE >&2
        cleanup_error=1
      fi
    fi
  else
    echo PREFLIGHT_STATE_PRESERVED_FOR_DIAGNOSTIC=YES >&2
  fi
  if docker container inspect "$container" >/dev/null 2>&1 ||
     docker network inspect "$network" >/dev/null 2>&1 || [[ -e $root ]]; then
    cleanup_error=1
  fi
  if (( cleanup_error == 0 )); then
    cleanup_done=1
    echo PREFLIGHT_CLEANUP=PASS
  fi
  if (( status == 0 && cleanup_error != 0 )); then status=1; fi
  exit "$status"
}
trap cleanup EXIT

mkdir -m 0700 "$root"
sudo install -d -o 1000 -g 1000 -m 0700 "$state"
printf 'synthetic-ci-only-token-0123456789-abcdef\n' > "$token_file"
chmod 0400 "$token_file"
sudo chown 1000:1000 "$token_file"
docker network create --internal "$network" >/dev/null
stage=PREFLIGHT_START
if ! docker run -d --name "$container" --hostname "$container" \
  --network "$network" --read-only --user 1000:1000 --security-opt no-new-privileges \
  --restart no --expose 8765 \
  --mount "type=bind,src=$state,dst=/lab-state" \
  --mount "type=bind,src=$token_file,dst=/run/secrets/sana_lab_token,readonly" \
  -e DENO_DIR=/lab-state/.deno -e SANA_LAB_STATE_DIR=/lab-state -e SANA_LAB_BIND_HOST=0.0.0.0 \
  -e SANA_LAB_PORT=8765 -e SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token \
  "$image" >/dev/null 2>&1; then
  diagnose "$stage"
  echo PREFLIGHT_FAILED_STAGE=START >&2
  exit 1
fi
stage=PREFLIGHT_VERIFY
verify_container() {
  test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "$image" || return 1
  test "$(docker inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$commit" || return 1
  test "$(docker inspect "$container" --format '{{.Config.User}}')" = "1000:1000" || return 1
  test "$(docker inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" = true || return 1
  test "$(docker inspect "$container" --format '{{len .NetworkSettings.Networks}}')" = 1 || return 1
  test "$(docker inspect "$container" --format '{{range $name, $v := .NetworkSettings.Networks}}{{$name}}{{end}}')" = "$network" || return 1
  local ports
  ports=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}') || return 1
  [[ $ports == null || $ports == '{}' ]] || return 1
  test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')" = "$state" || return 1
  test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.RW}}{{end}}{{end}}')" = true || return 1
  test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')" = "$token_file" || return 1
  test "$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.RW}}{{end}}{{end}}')" = false || return 1
  test "$(docker inspect "$container" --format '{{range .Config.Env}}{{if eq . "DENO_DIR=/lab-state/.deno"}}yes{{end}}{{end}}')" = yes || return 1
  local source expected actual
  for source in sana-lab/engine.ts sana-lab/recadastro.ts; do
    expected=$(sha256sum "$source" | cut -d ' ' -f 1) || return 1
    actual=$(docker exec "$container" sha256sum "/app/$source" | cut -d ' ' -f 1) || return 1
    test "$actual" = "$expected" || return 1
  done
}
if ! verify_container; then
  diagnose "$stage"
  echo PREFLIGHT_FAILED_STAGE=VERIFY >&2
  exit 1
fi
stage=PREFLIGHT_UNAUTHENTICATED_PROBE
ready=0
for attempt_no in {1..20}; do
  if docker exec "$container" deno eval \
    'const r=await fetch("http://127.0.0.1:8765/lab/v1/turn",{method:"POST"}); if(r.status!==401)throw Error("UNEXPECTED_HTTP_"+r.status)' >/dev/null 2>&1; then
    ready=1
    break
  fi
  if (( attempt_no < 20 )); then sleep 0.5; fi
done
if (( ready != 1 )); then
  diagnose "$stage"
  echo PREFLIGHT_FAILED_STAGE=UNAUTHENTICATED_PROBE >&2
  exit 1
fi
stage=PREFLIGHT_AUTHENTICATED_PROBE
if ! docker exec "$container" deno run --allow-read=/run/secrets/sana_lab_token --allow-net=127.0.0.1:8765 \
  /app/sana-lab/deploy-probe.ts "$commit"; then
  diagnose "$stage"
  echo PREFLIGHT_FAILED_STAGE=AUTHENTICATED_PROBE >&2
  exit 1
fi
echo "PREFLIGHT_DOCKER_REAL=PASS COMMIT=$commit IMAGE=$image NETWORK=INTERNAL PUBLIC_PORTS=NO"
