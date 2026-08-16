import { assertEquals } from "../fixtures/assert.ts";
import { HttpProblem } from "../../edge-functions/_shared/http.ts";
import { SupabaseRest } from "../../edge-functions/_shared/rest.ts";
import { decide } from "../../edge-functions/support-decision-engine/index.ts";
import { render } from "../../edge-functions/support-renderer/index.ts";
import { ids } from "../fixtures/ids.ts";
import { stateFixture } from "../fixtures/state.ts";

/**
 * Prepared for 5B.3 only. It stays skipped unless P10_INTEGRATION=1 is set,
 * because it needs the isolated database fixture IDs and the service-role
 * endpoint. Execute there with Deno 2.1.4 using:
 * P10_INTEGRATION=1 deno test --allow-env --allow-net tests/integration/p10_a_confirmar_integration_test.ts
 */
async function expectAConfirmarReject(
  label: string,
  operation: () => Promise<unknown>,
  expected: "A_CONFIRMAR_NO_FACTS" | "DECISION_CANNOT_PROPOSE",
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof HttpProblem)) throw new Error(`${label} failed with a non-domain error`);
    // get_renderer_decision_context refuses an A_CONFIRMAR decision in the database
    // ("Decision cannot render facts"), so the guard usually fires before the renderer
    // reaches its own A_CONFIRMAR_NO_FACTS branch. Both are the same fail-closed
    // outcome — no factual rendering — so accept either, and nothing else.
    if (
      expected === "A_CONFIRMAR_NO_FACTS" &&
      error.code !== expected &&
      (error.code !== "SUPABASE_REST_ERROR" ||
        !error.message.toLowerCase().includes("decision cannot render facts"))
    ) {
      throw new Error(`${label} rejected with ${error.code}, expected ${expected}`);
    }
    if (
      expected === "DECISION_CANNOT_PROPOSE" &&
      (error.code !== "SUPABASE_REST_ERROR" || !error.message.toLowerCase().includes("decision cannot propose"))
    ) {
      throw new Error(`${label} rejected without the expected A_CONFIRMAR proposal guard`);
    }
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

Deno.test({
  name: "P10 integration: database rules -> engine -> renderer/proposal",
  ignore: Deno.env.get("P10_INTEGRATION") !== "1",
}, async () => {
  const rest = new SupabaseRest();
  const releaseId = Deno.env.get("P10_RELEASE_ID") ?? ids.release;
  const sessionId = Deno.env.get("P10_SESSION_ID") ?? ids.session;
  const topicId = Deno.env.get("P10_TOPIC_ID") ?? ids.topic;
  const rules = await rest.rpc<unknown[]>("get_runtime_decision_rules", {
    p_release_id: releaseId,
    p_intent_code: "UNMATCHED_INTENT",
    p_service_code: "UNMATCHED_SERVICE",
    p_location_type: null,
  });
  const plan = await decide({
    correlation_id: ids.decision,
    release_id: releaseId,
    state: stateFixture(),
    classification: {
      schema_version: "1.0",
      correlation_id: ids.decision,
      release_id: releaseId,
      classification_status: "OK",
      message_role: "CONTINUATION",
      intent_candidates: [],
      service_candidates: [],
      location_candidate: null,
      complaint_signal: false,
      human_need_signal: false,
      topic_transition_candidate: "KEEP_ACTIVE",
      continuation_of_topic_id: topicId,
      document_signal: "NONE",
      ambiguity_codes: [],
      evidence: [],
    },
    technical_context: {
      now: new Date().toISOString(),
      provider_window_open: true,
      channel: "WHATSAPP",
      human_active: false,
      duplicate: false,
    },
  }, {
    rpc: (name: string) =>
      name === "get_runtime_decision_rules" ? rules : (() => {
        throw new Error(`unexpected RPC ${name}`);
      })(),
  } as never);
  assertEquals(plan.outcome, "A_CONFIRMAR");
  await rest.rpc("store_shadow_decision", { p_plan: plan, p_session_id: sessionId, p_topic_id: topicId });
  const decisionId = plan.decision_id;
  await expectAConfirmarReject(
    "renderer",
    () => render({ decision_id: decisionId, technical: { channel: "WHATSAPP" } }, rest),
    "A_CONFIRMAR_NO_FACTS",
  );
  await expectAConfirmarReject(
    "proposal",
    () => rest.rpc("propose_request_transaction", { p_decision_id: decisionId, p_actor: "P10" }),
    "DECISION_CANNOT_PROPOSE",
  );
  const base = Deno.env.get("SUPABASE_URL")! + "/rest/v1/";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "accept-profile": "support_vnext_shadow" };
  const requests = await fetch(`${base}service_requests?session_id=eq.${sessionId}&select=id,protocol`, { headers })
    .then((r) => r.json());
  assertEquals(requests.length, 0);
  assertEquals(requests.filter((r: { protocol?: unknown }) => r.protocol != null).length, 0);
});
