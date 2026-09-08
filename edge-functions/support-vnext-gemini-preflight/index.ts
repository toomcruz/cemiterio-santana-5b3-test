import { ControlledLlmAdapter, type AdapterObservation } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../../santana-conversation-domain/runtime/adapter/network.ts";
import { GeminiProvider } from "../../santana-conversation-domain/integrations/gemini.ts";
import { initState } from "../../santana-conversation-domain/engine/engine.ts";
import { planTurn } from "../../santana-conversation-domain/runtime/turn.ts";

const cors = { "content-type": "application/json; charset=utf-8" };

/**
 * Laboratory-only full-path preflight. It exercises the official interpreter but
 * creates no database rows, sends no WhatsApp message and accepts no user text.
 * JWT verification is provided by the platform.
 */
Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return Response.json({ outcome: "missing_gemini_key" }, { status: 503, headers: cors });
  let observation: AdapterObservation | null = null;
  const adapter = new ControlledLlmAdapter({
    enabled: true,
    timeoutMs: 12_000,
    provider: new GeminiProvider("gemini-flash-lite-latest", key),
    network: fetchBoundary,
    observe: (event) => observation = event,
  });
  const plan = await planTurn({
    message_id: "vnext-preflight-0002",
    text: "Meu jazigo está violado",
    state: initState("vnext-preflight"),
    automation_mode: "BOT_ACTIVE",
  }, adapter);
  return Response.json({
    outcome: plan.outcome,
    adapter_outcome: observation?.outcome ?? "missing_observation",
    event: plan.interpretation?.primary_event?.event_kind ?? null,
    goal: plan.interpretation?.goal?.goal_code ?? null,
    state_changed: plan.next_state.seq > 0,
  }, { headers: cors });
});
