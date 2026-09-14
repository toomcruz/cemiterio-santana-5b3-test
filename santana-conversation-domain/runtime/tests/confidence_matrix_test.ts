import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { arbitrateConfidence } from "../interpreter/confidence_matrix.ts";
import type { Interpretation } from "../interpreter/types.ts";

function interpretation(
  event: NonNullable<Interpretation["primary_event"]>["event_kind"],
  options: Partial<Interpretation> = {},
): Interpretation {
  const base: Interpretation = {
    schema_version: "santana-interpretation/v1",
    message_id: "confidence-test",
    text_normalized: "synthetic",
    primary_event: event ? { event_kind: event, confidence: "MEDIUM", evidence: "synthetic" } : null,
    secondary_events: [],
    goal: { goal_code: "GOAL_EXUMACAO", confidence: "MEDIUM", evidence: "synthetic" },
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "HIGH" },
    facts: [],
    ambiguities: [],
    overall_confidence: "LOW",
    needs_clarification: true,
    clarification_reason: "confianca baixa na interpretacao",
    refusals: [],
    produced_by: "confidence-matrix-test",
    official_mapping: {
      journeys: ["RESTOS_MORTAIS"],
      subintents: ["EXUMACAO"],
      transverse_states: [],
      intent_changed: event === "RECLASSIFICATION",
      complexity: "low",
      risk_level: "none",
      confidence: "low",
      evidence_turn_ids: ["confidence-test"],
      selected_event: event,
      suppressed_events: [],
      reason: "test",
    },
  };
  return { ...base, ...options };
}

Deno.test("A: reclassification ignores irrelevant LOW case_reference on current case", () => {
  const decision = arbitrateConfidence(interpretation("RECLASSIFICATION", {
    goal: { goal_code: "GOAL_RECADASTRO", confidence: "MEDIUM", evidence: "synthetic" },
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.allowed, true);
  assertEquals(decision.rule, "RECLASSIFICATION_GOAL_SUFFICIENT");
  assert(decision.low_fields.includes("case_reference.confidence"));
});

Deno.test("B: LOW goal blocks reclassification", () => {
  const decision = arbitrateConfidence(interpretation("RECLASSIFICATION", {
    goal: { goal_code: "GOAL_RECADASTRO", confidence: "LOW", evidence: "synthetic" },
  }));
  assertEquals(decision.force_clarification, true);
  assertEquals(decision.rule, "RECLASSIFICATION_GOAL_LOW");
});

Deno.test("C: clear multi-intent preserves both goals", () => {
  const decision = arbitrateConfidence(interpretation("NEW_GOAL", {
    secondary_goals: [{ goal_code: "GOAL_RECADASTRO", confidence: "MEDIUM", evidence: "synthetic" }],
  }));
  assertEquals(decision.allowed, true);
  assert(decision.preserved_scope.includes("goal"));
});

Deno.test("D: partial multi-intent keeps the clear primary scope and blocks only uncertain expansion", () => {
  const decision = arbitrateConfidence(interpretation("NEW_GOAL", {
    secondary_goals: [{ goal_code: "GOAL_RECADASTRO", confidence: "LOW", evidence: "synthetic" }],
  }));
  assertEquals(decision.force_clarification, true);
  assertEquals(decision.rule, "MULTI_INTENT_PARTIAL_CLARIFICATION");
  assert(decision.preserved_scope.includes("primary_goal"));
});

Deno.test("E: LOW case_reference blocks NEW_GOAL", () => {
  const decision = arbitrateConfidence(interpretation("NEW_GOAL", {
    case_reference: { kind: "NEW", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.rule, "NEW_GOAL_CASE_REFERENCE_LOW");
});

Deno.test("F: correction is allowed when the current scope is clear", () => {
  const decision = arbitrateConfidence(interpretation("CORRECTION", {
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.allowed, true);
  assertEquals(decision.rule, "CORRECTION_FACT_SCOPE_SUFFICIENT");
});

Deno.test("G: correction with LOW goal becomes specific clarification", () => {
  const decision = arbitrateConfidence(interpretation("CORRECTION", {
    goal: { goal_code: "GOAL_EXUMACAO", confidence: "LOW", evidence: "synthetic" },
  }));
  assertEquals(decision.rule, "CORRECTION_SCOPE_UNCERTAIN");
});

Deno.test("H: P0 HUMAN_REQUEST wins over LOW overall confidence", () => {
  const decision = arbitrateConfidence(interpretation("HUMAN_REQUEST", {
    overall_confidence: "LOW",
    official_mapping: {
      ...interpretation("HUMAN_REQUEST").official_mapping!,
      risk_level: "P0",
      selected_event: "HUMAN_REQUEST",
    },
  }));
  assertEquals(decision.allowed, true);
  assertEquals(decision.rule, "P0_HUMAN_REQUEST_PRIORITY");
});

Deno.test("I: social closing ignores irrelevant LOW case metadata", () => {
  const decision = arbitrateConfidence(interpretation("SOCIAL", {
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.allowed, true);
  assertEquals(decision.rule, "SOCIAL_CLOSING_VALIDATED");
});

Deno.test("J: complement preserves identified context when new metadata is LOW", () => {
  const decision = arbitrateConfidence(interpretation("COMPLEMENT", {
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.allowed, true);
  assert(decision.preserved_scope.includes("current_case"));
});

Deno.test("K: a fact requiring confirmation blocks automatic progression", () => {
  const decision = arbitrateConfidence(interpretation("COMPLEMENT", {
    facts: [{
      fact_code: "burial_reference",
      value: "synthetic",
      source: "USER_EXPLICIT",
      confidence: "LOW",
      evidence: "synthetic",
      requires_confirmation: true,
    }],
  }));
  assertEquals(decision.force_clarification, true);
  assertEquals(decision.rule, "FACT_REQUIRES_CONFIRMATION");
});

Deno.test("L: common HUMAN_REQUEST is not cancelled by irrelevant LOW metadata", () => {
  const decision = arbitrateConfidence(interpretation("HUMAN_REQUEST", {
    case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "LOW" },
  }));
  assertEquals(decision.allowed, true);
  assertEquals(decision.rule, "HUMAN_REQUEST_HANDOFF");
});

Deno.test("negative: reclassification without intent_changed fails closed", () => {
  const decision = arbitrateConfidence(interpretation("RECLASSIFICATION", {
    official_mapping: { ...interpretation("RECLASSIFICATION").official_mapping!, intent_changed: false },
  }));
  assertEquals(decision.force_clarification, true);
  assertEquals(decision.rule, "RECLASSIFICATION_SIGNAL_MISSING");
});

Deno.test("negative: real ambiguity is never erased by LOW arbitration", () => {
  const decision = arbitrateConfidence(interpretation("COMPLEMENT", {
    ambiguities: [{ code: "AMB", description: "synthetic", options: ["a", "b"], blocking: true }],
  }));
  assertEquals(decision.force_clarification, true);
  assert(decision.low_fields.includes("ambiguity"));
});
