#!/usr/bin/env bash
# Run only in the private VPS checkout. Never prints or reads the LAB token.
set -euo pipefail

expected_sha=${1:?Usage: bash sana-lab/deploy-functional-gate.sh EXPECTED_40_CHARACTER_COMMIT}
[[ $expected_sha =~ ^[0-9a-f]{40}$ ]] || { echo 'INVALID_COMMIT_SHA' >&2; exit 2; }
branch=sana-lab-exumacao-f0-f2
network=n8n-ntga_default
container=sana-lab-bridge

git fetch origin "$branch"
git switch "$branch"
git merge --ff-only FETCH_HEAD
test "$(git rev-parse HEAD)" = "$expected_sha" || { echo 'COMMIT_MISMATCH' >&2; exit 2; }
test -z "$(git status --porcelain)" || { echo 'DIRTY_CHECKOUT' >&2; exit 2; }

network_id=$(docker network inspect "$network" --format '{{.ID}}')
test "$(docker inspect "$container" --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}')" = "$network_id" || {
  echo 'BRIDGE_NETWORK_MISMATCH' >&2; exit 2;
}
old_ports=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')
[[ $old_ports = null || $old_ports = '{}' ]] || { echo 'BRIDGE_HAS_PUBLIC_PORT' >&2; exit 2; }

state_mount=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')
secret_mount=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')
[[ -n $state_mount && -d $state_mount && -n $secret_mount && -f $secret_mount ]] || {
  echo 'LAB_MOUNTS_MISSING' >&2; exit 2;
}
test "$(docker inspect "$container" --format '{{range .Config.Env}}{{if eq . "SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token"}}yes{{end}}{{end}}')" = yes || {
  echo 'LAB_SECRET_FILE_ENV_MISMATCH' >&2; exit 2;
}

short_sha=${expected_sha:0:12}
image="sana-lab-bridge:$short_sha"
backup="sana-lab-bridge-before-$short_sha"
if docker container inspect "$backup" >/dev/null 2>&1; then echo 'BACKUP_NAME_ALREADY_EXISTS' >&2; exit 2; fi
docker build -f sana-lab/Dockerfile -t "$image" .

stopped=0
renamed=0
rollback_on_error() {
  local status=$?
  if (( status != 0 && renamed == 1 )); then
    echo 'DEPLOY_FAILED_ROLLING_BACK_LAB' >&2
    docker stop "$container" >/dev/null 2>&1 || true
    docker rm "$container" >/dev/null 2>&1 || true
    docker rename "$backup" "$container"
    docker start "$container" >/dev/null
  elif (( status != 0 && stopped == 1 )); then
    docker start "$container" >/dev/null
  fi
}
trap rollback_on_error EXIT
docker stop "$container" >/dev/null
stopped=1
docker rename "$container" "$backup"
renamed=1
docker run -d --name "$container" --hostname "$container" \
  --network "$network" --network-alias "$container" \
  --read-only --user 1000:1000 --security-opt no-new-privileges \
  --restart unless-stopped --expose 8765 \
  --mount "type=bind,src=$state_mount,dst=/lab-state" \
  --mount "type=bind,src=$secret_mount,dst=/run/secrets/sana_lab_token,readonly" \
  -e SANA_LAB_STATE_DIR=/lab-state -e SANA_LAB_BIND_HOST=0.0.0.0 \
  -e SANA_LAB_PORT=8765 -e SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token \
  "$image" >/dev/null
new_ports=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')
[[ $new_ports = null || $new_ports = '{}' ]] || { echo 'NEW_BRIDGE_HAS_PUBLIC_PORT' >&2; exit 2; }
test "$(docker inspect "$container" --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}')" = "$network_id" || {
  echo 'NEW_BRIDGE_NETWORK_MISMATCH' >&2; exit 2;
}
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "$image" || { echo 'NEW_IMAGE_MISMATCH' >&2; exit 2; }
# A non-authenticated, in-container probe checks that the process responds without exposing the secret.
docker exec "$container" deno eval --allow-net=127.0.0.1:8765 \
  'const r = await fetch("http://127.0.0.1:8765/lab/v1/turn", { method: "POST" }); if (r.status !== 401) throw Error("UNEXPECTED_STATUS_" + r.status); console.log("LAB_PRIVATE_HTTP_401_OK");'
trap - EXIT
echo "LAB_IMAGE=$image LAB_NETWORK=$network PUBLIC_PORTS=NO BACKUP=$backup"
echo 'Deploy técnico concluído. Gate funcional depende de execuções n8n autenticadas com novos eventos.'
