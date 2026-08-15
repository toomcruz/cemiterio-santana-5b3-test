import type { ClassifierOutput } from "../../contracts/classifier.ts";
import type { DecisionInput, DecisionPlan } from "../../contracts/decision-plan.ts";
import { assertEquals } from "../fixtures/assert.ts";
import { decide } from "../../edge-functions/support-decision-engine/index.ts";
import { ids } from "../fixtures/ids.ts";
import { stateFixture } from "../fixtures/state.ts";

type RuntimeRule = {
  decision_rule_id: string;
  rule_code: string;
  priority: number;
  stop_processing: boolean;
  when_expression: Record<string, unknown>;
  then_plan: Partial<DecisionPlan>;
};

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

function permittedPlan(templateValue: string): DecisionPlan {
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
      template_variables: { message: templateValue },
      allowed_fact_refs: [],
      asset_ids: [],
      max_questions: 0,
    },
    state_patch: { expected_state_version: input.state.state_version, operations: [] },
    request_plan: null,
    document_plan: null,
    handoff_plan: null,
    reason_codes: ["UNIT_TEST"],
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

function rule(ruleCode: string, plan: DecisionPlan, priority = 100): RuntimeRule {
  return {
    decision_rule_id: crypto.randomUUID(),
    rule_code: ruleCode,
    priority,
    stop_processing: false,
    when_expression: {},
    then_plan: plan,
  };
}

function restWithRules(rules: RuntimeRule[]): Parameters<typeof decide>[1] {
  const rest = {
    rpc: <T>(name: string): Promise<T> => {
      if (name === "get_runtime_decision_rules") return Promise.resolve(rules as unknown as T);
      if (name === "store_shadow_decision") return Promise.resolve(undefined as T);
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  return rest as unknown as Parameters<typeof decide>[1];
}

Deno.test("no published rule gives A_CONFIRMAR", async () => {
  const plan = await decide(input, restWithRules([]));
  assertEquals(plan.outcome, "A_CONFIRMAR");
  assertEquals(plan.reason_codes, ["NO_MATCHING_PUBLISHED_RULE"]);
});

Deno.test("valid same-priority conflicting rules fail closed deterministically", async () => {
  const first = rule("RULE_A", permittedPlan("first"));
  const second = rule("RULE_B", permittedPlan("second"));

  const forward = await decide(input, restWithRules([first, second]));
  const reverse = await decide(input, restWithRules([second, first]));

  assertEquals(forward.outcome, "A_CONFIRMAR");
  assertEquals(forward.reason_codes, ["RULE_CONFLICT_OR_INVALID_PLAN"]);
  assertEquals(reverse.outcome, forward.outcome);
  assertEquals(reverse.reason_codes, forward.reason_codes);
});

Deno.test("higher-priority runtime rule governs regardless of transport order", async () => {
  const lower = rule("RULE_LOW", permittedPlan("lower"), 10);
  const higher = rule("RULE_HIGH", permittedPlan("higher"), 20);

  const plan = await decide(input, restWithRules([lower, higher]));

  assertEquals(plan.outcome, "PERMITTED");
  assertEquals(plan.response_plan?.template_variables?.message, "higher");
});
