import { assert, assertEquals } from "../fixtures/assert.ts";
import { A_CONFIRMAR_RESTRICTIONS, assertAConfirmarPlan, type DecisionPlan } from "../../contracts/decision-plan.ts";
import { ids } from "../fixtures/ids.ts";

Deno.test("A_CONFIRMAR blocks facts, administrative proposals, and legacy fallback", () => {
  const plan: DecisionPlan = {
    schema_version: "1.0",
    decision_id: ids.decision,
    correlation_id: ids.decision,
    release_id: ids.release,
    state_version: 1,
    outcome: "A_CONFIRMAR",
    actions: ["FAZER_PERGUNTA"],
    response_plan: {
      mode: "DETERMINISTIC",
      allowed_fact_refs: [{ type: "PRICE", id: "old-price" }],
      asset_ids: [],
      max_questions: 1,
    },
    state_patch: { expected_state_version: 1, operations: [] },
    request_plan: null,
    document_plan: null,
    handoff_plan: null,
    reason_codes: ["NO_RULE"],
    validation_requirements: {
      session_must_be_active: true,
      human_must_be_inactive: true,
      confirmation_nonce_required: false,
      required_document_ids: [],
      provider_delivery_required: true,
    },
    a_confirmar_restrictions: A_CONFIRMAR_RESTRICTIONS,
    expires_at: "2026-08-14T12:01:00.000Z",
  };
  assertEquals(assertAConfirmarPlan(plan), ["A_CONFIRMAR_CANNOT_RESOLVE_FACT"]);
  assert(A_CONFIRMAR_RESTRICTIONS.includes("NO_LEGACY_FALLBACK"));
});
