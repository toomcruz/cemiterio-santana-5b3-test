# Supervised text send — exact proposed scope

Candidate only. No production deployment, permission enablement or real send was performed.

## Existing PROD Supabase project

Apply `coordinator.sql`: three private-to-the-Data-API tables (`sana_mcp_send_permissions`, `sana_mcp_send_operations`, `sana_mcp_send_events`) with RLS and no anon/authenticated access; a service-only coordinator RPC; a private session-existence helper with a service-only boolean wrapper; and three narrowly acting triggers on conversation mode, manual message and outbox writes. The triggers take effect only while a supervised claim is dispatching or unknown for that same conversation. No live permissions are seeded. No existing function is replaced.

Existing Edge `sana-panel-preview-login`, baseline version 36 / SHA-256 `0bf68b92003ce88a8fd1b95ec4e9a5f28638c0b84739981ab67b229cfcf83e6f`: add `edge-operations.ts` under the deployed name `mcp-official-operations.ts`, and use `production-edge-index.ts`. This adds one import and one finite-action mount behind the existing caller guard. Preserve the original other 46 files. Abort on baseline drift.

## Existing official Panel Vercel project

Baseline source commit `370cd4c161496a73d2638e9b0a947f55fdf10a6e`; current alias was observed at deployment `dpl_DrcfETfD3LjF1R1fwFugozu6MUzx`. Do not use the different default-branch source.

| Candidate | Existing project target |
|---|---|
| `production-sana-control-route.ts` | `app/api/runtime/sana-control/route.ts` |
| `official-adapter.mjs` | `lib/sana/official-adapter.mjs`; change only its import `../official-channel-manual.ts` to `./manual-whatsapp.ts` |
| `vercel-binding.ts` | `lib/sana/vercel-binding.ts` |
| `edge-operations.mjs` | `lib/sana/edge-operations.mjs` |
| `panel-authorization-page.tsx` | `app/mcp-authorize/page.tsx` |

The existing `lib/sana/manual-whatsapp.ts` is reused unchanged. W-API credentials remain there. The new route requires `SANTANA_SUPERVISED_SEND_READY=verified`; absence blocks it. Build on the existing source and validate before switching the alias. A full Next.js build and browser authorization handoff have not yet been exercised; passing the component and database checks does not replace those deployment checks.

## Existing HOMOLOG connection

Apply `homolog/session-check.sql` only to the existing HOMOLOG project. Patch its existing `send-intents.ts` and `send-intents-core.mjs` from the candidate `homolog/` directory. Keep other Edge files unchanged. This checks session revocation and returns a proof only to the verified owner.

Use `homolog/revisar-envio.html` in the existing consent deployment. The final authorization opens the official Panel, requires that user's PROD session, and hands the HMG session over via an exact-origin / exact-window / nonce-bound `postMessage`. Tokens stay out of URLs and chat. The final production consent explicitly authorizes one text attempt; the earlier blocked review is not reused as live consent.

Patch the existing MCP server from `mcp-server.py` and add `official_send_provider.py`. The new `enviar_envio_preparado` is hidden unless `SANTANA_SUPERVISED_SEND_VERIFIED=true`, and is never offered to OpenBot. The old direct W-API send gate remains false. Enable catalog exposure only after the deployment protections and protected interface have been verified. Live dispatch additionally needs the one-conversation permission and a fresh operator authorization.

## Qualification and boundaries

10 Node + 2 Python tests passed locally and on the existing VPS runner: https://github.com/toomcruz/cemiterio-santana-5b3-test/actions/runs/39153406433 . They include the complete HMG proof / PROD operator / coordinator / official-emitter chain with simulated identities and transport, duplicate concurrent calls and ambiguous responses. No provider request leaves these tests.

`qualify-coordinator.sql` passed on PostgreSQL HOMOLOG using temporary synthetic tables and the existing control/manual function definitions, with complete rollback. It checked disabled permissions, current operator session, prior in-flight delivery, column/JSON consistency, manual/outbox barriers, bot reactivation denial, duplicate prevention, unknown outcomes and atomic audit. This is not a live deployment or a two-connection load test.

Read-only inspection of the active n8n V3 conversation/recovery and V2 canary paths found the existing relay requiring `/delivery/authorize`. No workflows were executed or altered. At inspection there were no PENDING/CLAIMED/UNKNOWN outbox rows or dispatching/unknown manual rows for the individually authorized test conversation.

Initial rollout is TEXT ONLY, restricted to the existing subject/client/PROD operator and conversation ending 5497. No image/PDF dispatch, new account, plugin, service, tunnel, webhook, n8n or Boss Bridge change. Production permission enablement, protected personal final consent and the specific chat authorization for the actual test remain separate from installation approval. Any ambiguous result stays blocked without automatic retry.

Before a live test: install only after explicit deployment approval; pass build and protected-interface checks; create a fresh preparation/review if needed; show the full target/text; obtain specific live-test authorization. Never reactivate Sana automatically after the trial.
