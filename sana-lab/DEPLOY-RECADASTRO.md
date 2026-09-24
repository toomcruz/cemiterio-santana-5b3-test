# Recadastro LAB — implantação privada pendente

Código canônico: `sana-lab/engine.ts` chama `sana-lab/recadastro.ts`; a bridge `sana-lab/bridge.ts` continua transporte. Catálogo de evidências Recadastro: `santana-conversation-domain/goals.v1.json`, `facts.v1.json` e `docs/official-operations-release.md`; **não são um catálogo oficial homologado de documentos, prazos ou aprovação**. `sana-lab/module-map.v1.json` registra treze famílias e estados individuais.

O workflow `m6y2AD8Vx1QZaJiE` é manual/inativo. O container observado anteriormente `sana-lab-bridge:815f641` não contém esta implementação. A alteração do workflow **não implanta** código novo. Sem Docker/SSH administrativo nesta sessão, o Gate n8n de Recadastro permanece BLOCKED.

## Pré-condições na VPS, sem ler segredo

Usar o checkout privado autorizado desta branch. Confirmar que o container real `sana-lab-bridge` pertence somente à rede `n8n-ntga_default`, não publica portas, monta `/lab-state` e monta o segredo **como arquivo** em `/run/secrets/sana_lab_token`. Executar os comandos em sessão administrativa da VPS, sem `set -x`; eles examinam apenas caminhos de montagem, imagem e status. Se qualquer asserção falhar, **parar antes de substituir**. Não apagar o estado LAB nem copiar o token.

```bash
set -euo pipefail
git fetch origin sana-lab-exumacao-f0-f2
git switch sana-lab-exumacao-f0-f2
git merge --ff-only FETCH_HEAD
test "$(git rev-parse HEAD)" = 'REPLACE_WITH_COMMIT_SHA'
test "$(docker inspect sana-lab-bridge --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}')" = "$(docker network inspect n8n-ntga_default --format '{{.ID}}')"
lab_ports=$(docker inspect sana-lab-bridge --format '{{json .HostConfig.PortBindings}}')
test "$lab_ports" = 'null' || test "$lab_ports" = '{}'
lab_state_mount=$(docker inspect sana-lab-bridge --format '{{range .Mounts}}{{if eq .Destination "/lab-state"}}{{.Source}}{{end}}{{end}}')
lab_secret_mount=$(docker inspect sana-lab-bridge --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/sana_lab_token"}}{{.Source}}{{end}}{{end}}')
test -d "$lab_state_mount"
test -f "$lab_secret_mount"
test "$(docker inspect sana-lab-bridge --format '{{range .Config.Env}}{{if eq . "SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token"}}yes{{end}}{{end}}')" = yes
lab_new_sha=$(git rev-parse --short=12 HEAD)
docker build -f sana-lab/Dockerfile -t "sana-lab-bridge:$lab_new_sha" .
docker stop sana-lab-bridge
docker rename sana-lab-bridge "sana-lab-bridge-before-$lab_new_sha"
docker run -d --name sana-lab-bridge --hostname sana-lab-bridge \
  --network n8n-ntga_default --network-alias sana-lab-bridge \
  --read-only --user 1000:1000 --security-opt no-new-privileges \
  --restart unless-stopped --expose 8765 \
  --mount "type=bind,src=$lab_state_mount,dst=/lab-state" \
  --mount "type=bind,src=$lab_secret_mount,dst=/run/secrets/sana_lab_token,readonly" \
  -e SANA_LAB_STATE_DIR=/lab-state -e SANA_LAB_BIND_HOST=0.0.0.0 \
  -e SANA_LAB_PORT=8765 -e SANA_LAB_TOKEN_FILE=/run/secrets/sana_lab_token \
  "sana-lab-bridge:$lab_new_sha"
lab_new_ports=$(docker inspect sana-lab-bridge --format '{{json .HostConfig.PortBindings}}')
test "$lab_new_ports" = 'null' || test "$lab_new_ports" = '{}'
docker inspect sana-lab-bridge --format 'image={{.Config.Image}} status={{.State.Status}} networks={{range $name,$_ := .NetworkSettings.Networks}}{{$name}}{{end}}'
```

`PortBindings` pode ser `null` ou `{}` sem porta publicada. A porta 8765 permanece **interna**. O script preserva o container anterior parado para reversão; não use `docker rm -v`.

Rollback se o novo container não subir ou o probe falhar (executar sem ler o segredo):

```bash
docker stop sana-lab-bridge || true
docker rm sana-lab-bridge
docker rename "sana-lab-bridge-before-REPLACE_WITH_SHORT_SHA" sana-lab-bridge
docker start sana-lab-bridge
```

Depois da implantação, usar o workflow manual LAB com novo caso/evento sintético; registrar imagem/commit, HTTP status, `evidence.engine_called`, módulo, catálogo, revisions e N8N_EXECUTION_ID. Rodar R01–R14 e A–F novamente **pelo n8n**, incluindo replay e falhas. Somente então avaliar os gates de integração e Recadastro. Não usar fixture fixada como resposta de bridge, não publicar workflow/webhook e não executar Gemini, W-API ou WhatsApp.
