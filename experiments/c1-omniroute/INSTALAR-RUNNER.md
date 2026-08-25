#!/usr/bin/env bash
# Instrucao local (lab) para registrar o GitHub Actions runner no Hermes.
# Nao imprime o token. Nao expoe Omniroute.
set -euo pipefail

cat <<'TXT'
== Self-hosted runner — Hermes / cemiterio-santana-5b3-test ==

Status:
- Binario ja extraido em /opt/actions-runner (v2.336.0)
- Script de registro: /opt/actions-runner/register-hermes.sh
- Ainda NAO registrado (falta token de 1h)

No GitHub (conta com admin no repo):
1) https://github.com/toomcruz/cemiterio-santana-5b3-test/settings/actions/runners/new
2) SO: Linux / x64
3) Copie APENAS o valor de --token (começa com A...)

No servidor Hermes (cole o token so no env, nao no chat se puder evitar):

  cd /opt/actions-runner
  RUNNER_TOKEN='COLE_AQUI' ./register-hermes.sh
  sudo ./svc.sh install
  sudo ./svc.sh start
  sudo ./svc.sh status

Verificacao:
  # deve aparecer online com labels: self-hosted,linux,x64,hermes,omniroute-local
  # (via UI Runners ou API)

Omniroute continua so em loopback:
  LITELLM_PROVIDER_BASE_URL=http://127.0.0.1:20128/v1

Nao faca:
- Funnel/Tailscale publico da Omniroute
- bind novo em 0.0.0.0
- commit do token
TXT
