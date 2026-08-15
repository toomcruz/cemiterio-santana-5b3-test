import { assertEquals } from "../fixtures/assert.ts";
import { runtimeMode } from "../../edge-functions/_shared/security.ts";
import { assertAConfirmarPlan, type DecisionPlan } from "../../contracts/decision-plan.ts";
import { ids } from "../fixtures/ids.ts";
Deno.test("ENABLED fails closed instead of enabling runtime", () => {
  Deno.env.set("SUPPORT_VNEXT_MODE", "ENABLED");
  assertEquals(runtimeMode(), "OFF");
});
Deno.test("A_CONFIRMAR rejects proposal and factual reference", () => {
  const p: DecisionPlan = {
    schema_version: "1.0",
    decision_id: ids.decision,
    correlation_id: ids.decision,
    release_id: ids.release,
    state_version: 1,
    outcome: "A_CONFIRMAR",
    request_plan: {
      mode: "PROPOSE",
      request_policy_id: ids.policy,
      subject_template_id: "TEST_SUBJECT",
      proposal_field_values: {},
      document_ids: [],
      confirmation_required: true,
    },
    actions: ["RESPONDER"],
    response_plan: {
      mode: "DETERMINISTIC",
      allowed_fact_refs: [{ type: "PRICE", id: "forbidden" }],
      asset_ids: [],
      max_questions: 0,
    },
    state_patch: { expected_state_version: 1, operations: [] },
    document_plan: null,
    handoff_plan: null,
    reason_codes: ["TEST"],
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
  assertEquals(assertAConfirmarPlan(p).length > 0, true);
});
