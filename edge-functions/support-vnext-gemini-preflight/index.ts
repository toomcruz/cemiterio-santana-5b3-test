import { ControlledLlmAdapter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../../santana-conversation-domain/runtime/adapter/network.ts";
import { GeminiProvider } from "../../santana-conversation-domain/integrations/gemini.ts";
import { initState } from "../../santana-conversation-domain/engine/engine.ts";
import { planTurn } from "../../santana-conversation-domain/runtime/turn.ts";

const cors = { "content-type": "application/json; charset=utf-8" };

/**
 * Laboratory-only proof that the configured Gemini secret works with the official
 * interpreter contract. JWT verification is provided by the platform.
 * It creates no database rows, sends no WhatsApp message and accepts no user text.
 */
Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return Response.json({ outcome: "missing_gemini_key" }, { status: 503, headers: cors });
  const adapter = new ControlledLlmAdapter({
    enabled: true,
    timeoutMs: 8_000,
    // Validated by the existing credential-discovery benchmark (PR #11).
    provider: new GeminiProvider("gemini-flash-lite-latest", key),
    network: fetchBoundary,
  });
  const plan = await planTurn({
    message_id: "vnext-preflight-0001",
    text: "Quero fazer o translado do meu pai, ele ainda está sepultado.",
    state: initState("vnext-preflight"),
    automation_mode: "BOT_ACTIVE",
  }, adapter);
  return Response.json({
    outcome: plan.outcome,
    event: plan.interpretation?.primary_event?.event_kind ?? null,
    goal: plan.interpretation?.goal?.goal_code ?? null,
    fact_codes: plan.interpretation?.facts.map((fact) => fact.fact_code) ?? [],
    state_changed: plan.next_state.seq > 0,
  }, { headers: cors });
});
