# C1 Omniroute (lab / self-hosted)

Camada minima para a Fase 4 rodar no runner **self-hosted do Hermes**, usando
Omniroute local em `http://127.0.0.1:20128/v1` via LiteLLM do Parlant.

## Regras

- Nao expoe Omniroute publicamente.
- Nao chama `generativelanguage.googleapis.com`.
- Nao toca producao, Supabase, n8n, WhatsApp, W-API ou Vercel.
- Nao imprime chave.

## Env

```bash
LITELLM_PROVIDER_BASE_URL=http://127.0.0.1:20128/v1
LITELLM_PROVIDER_API_KEY=***   # secret PARLANT / chave Omniroute
LITELLM_PROVIDER_MODEL_NAME=openai/claude/claude-sonnet-4-6
```

## Workflow

`.github/workflows/parlant-fase4-c1.yml` (branch lab):

1. `runs-on: self-hosted`
2. Materializa a POC Gemini sem mesclar em main
3. Sobrepoe `omniroute_nlp.py`, `serve_c1_price.py`, `smoke_parlant.py`
4. Preflight curto: `GET /v1/models` + 1 chat com nonce em loopback
5. Smoke C1

## Runner

Binario preparado em `/opt/actions-runner`. Registrar com token de 1h:

```bash
cd /opt/actions-runner
RUNNER_TOKEN='...' ./register-hermes.sh
sudo ./svc.sh install
sudo ./svc.sh start
```
