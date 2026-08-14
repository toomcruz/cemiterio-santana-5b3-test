import { assertEquals } from "../fixtures/assert.ts";
import { decide } from "../../edge-functions/support-decision-engine/index.ts";
import { render } from "../../edge-functions/support-renderer/index.ts";
import type { DecisionInput, DecisionPlan } from "../../contracts/decision-plan.ts";
import type { ClassifierOutput } from "../../contracts/classifier.ts";
import { ids } from "../fixtures/ids.ts";
import { stateFixture } from "../fixtures/state.ts";

const classification: ClassifierOutput = {
  schema_version: "1.0",
  correlation_id: ids.decision,
  release_id: ids.release,
  classification_status: "OK",
  message_role: "CONTINUATION",
  intent_candidates: [],
  service_candidates: [],
  location_candidate: null,
  complaint_signal: false,
  human_need_signal: false,
  topic_transition_candidate: "KEEP_ACTIVE",
  continuation_of_topic_id: ids.topic,
  document_signal: "NONE",
  ambiguity_codes: [],
  evidence: [],
};

const input: DecisionInput = {
  correlation_id: ids.decision,
  release_id: ids.release,
  state: stateFixture(),
  classification,
  technical_context: {
    now: "2026-08-14T12:00:00.000Z",
    provider_window_open: true,
    channel: "WHATSAPP",
    human_active: false,
    duplicate: false,
  },
};

function validPlan(message: string): DecisionPlan {
  return {
    schema_version: "1.0",
    decision_id: ids.decision,
    correlation_id: ids.decision,
    release_id: ids.release,
    state_version: input.state.state_version,
    outcome: "PERMITTED",
    actions: ["RESPONDER"],
    response_plan: {
      mode: "DETERMINISTIC",
      template_variables: { message },
      allowed_fact_refs: [],
      asset_ids: [],
      max_questions: 0,
    },
    state_patch: { expected_state_version: input.state.state_version, operations: [] },
    request_plan: null,
    document_plan: null,
    handoff_plan: null,
    reason_codes: ["P10_TEST"],
    validation_requirements: {
      session_must_be_active: true,
      human_must_be_inactive: true,
      confirmation_nonce_required: false,
      required_document_ids: [],
      provider_delivery_required: false,
    },
    a_confirmar_restrictions: [],
    expires_at: "2026-08-14T12:05:00.000Z",
  };
}

function restWithRules(rules: Array<Record<string, unknown>>): Parameters<typeof decide>[1] {
  return {
    rpc: async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
      if (name === "get_runtime_decision_rules") return rules as T;
      if (name === "store_shadow_decision") return undefined as T;
      throw new Error(`Unexpected RPC ${name} ${JSON.stringify(args)}`);
    },
  } as unknown as Parameters<typeof decide>[1];
}

Deno.test("P10 decision engine produces A_CONFIRMAR from a real empty resolver result", async () => {
  const plan = await decide(input, restWithRules([]));
  assertEquals(plan.outcome, "A_CONFIRMAR");
  assertEquals(plan.reason_codes, ["NO_MATCHING_PUBLISHED_RULE"]);
  assertEquals(plan.response_plan, null);
  assertEquals(plan.request_plan, null);
  assertEquals(plan.document_plan, null);
  assertEquals(plan.handoff_plan, null);
  assertEquals(plan.actions.includes("CRIAR_SOLICITACAO"), false);
});

Deno.test("P10 conflict reaches A_CONFIRMAR through production decision engine", async () => {
  const first = { decision_rule_id: "00000000-0000-4000-8000-000000000001", rule_code: "P10_A", priority: 10, stop_processing: false, when_expression: {}, then_plan: validPlan("a") };
  const second = { decision_rule_id: "00000000-0000-4000-8000-000000000002", rule_code: "P10_B", priority: 10, stop_processing: false, when_expression: {}, then_plan: validPlan("b") };
  const forward = await decide(input, restWithRules([first, second]));
  const reverse = await decide(input, restWithRules([second, first]));
  assertEquals(forward.outcome, "A_CONFIRMAR");
  assertEquals(forward.reason_codes, ["RULE_CONFLICT_OR_INVALID_PLAN"]);
  assertEquals(reverse.outcome, forward.outcome);
  assertEquals(reverse.reason_codes, forward.reason_codes);
});

Deno.test("P10 renderer rejects the real A_CONFIRMAR context", async () => {
  let rejected = false;
  try {
    await render({ decision_id: ids.decision, technical: { channel: "WHATSAPP" } }, {
      rpc: async <T>(): Promise<T> => ({ outcome: "A_CONFIRMAR" } as T),
    } as never);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
