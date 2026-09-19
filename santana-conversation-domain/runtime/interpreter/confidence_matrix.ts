import type { EventKind } from "../../engine/catalog.ts";
import type { Interpretation } from "./types.ts";

export type ConfidenceField =
  | "overall_confidence"
  | "primary_event.confidence"
  | "goal.confidence"
  | "case_reference.confidence"
  | "ambiguity"
  | "requires_confirmation";

export interface ConfidenceArbitration {
  event: EventKind | null;
  low_fields: ConfidenceField[];
  blocking_fields: ConfidenceField[];
  allowed: boolean;
  force_clarification: boolean;
  rule: string;
  reason: string | null;
  preserved_scope: string[];
}

function lowFields(interpretation: Interpretation): ConfidenceField[] {
  const fields: ConfidenceField[] = [];
  if (interpretation.overall_confidence === "LOW") fields.push("overall_confidence");
  if (interpretation.primary_event?.confidence === "LOW") fields.push("primary_event.confidence");
  if (interpretation.goal?.confidence === "LOW") fields.push("goal.confidence");
  if (interpretation.case_reference.confidence === "LOW") fields.push("case_reference.confidence");
  if (interpretation.ambiguities.some((ambiguity) => ambiguity.blocking)) fields.push("ambiguity");
  if (interpretation.facts.some((fact) => fact.requires_confirmation)) fields.push("requires_confirmation");
  return fields;
}

function block(
  interpretation: Interpretation,
  rule: string,
  reason: string,
  blocking_fields: ConfidenceField[],
  preserved_scope: string[] = [],
): ConfidenceArbitration {
  return {
    event: interpretation.primary_event?.event_kind ?? null,
    low_fields: lowFields(interpretation),
    blocking_fields,
    allowed: false,
    force_clarification: true,
    rule,
    reason,
    preserved_scope,
  };
}

function allow(
  interpretation: Interpretation,
  rule: string,
  preserved_scope: string[] = [],
): ConfidenceArbitration {
  return {
    event: interpretation.primary_event?.event_kind ?? null,
    low_fields: lowFields(interpretation),
    blocking_fields: [],
    allowed: true,
    force_clarification: false,
    rule,
    reason: null,
    preserved_scope,
  };
}

/**
 * Event-scoped confidence policy. LOW is evidence, not authorization: this
 * function only decides whether the current semantic event can reach the
 * official reducer. It never promotes a confidence value.
 */
export function arbitrateConfidence(interpretation: Interpretation): ConfidenceArbitration {
  const event = interpretation.primary_event?.event_kind ?? null;
  const low = lowFields(interpretation);
  const p0 = interpretation.official_mapping?.risk_level === "P0";
  const media = interpretation.official_mapping?.transverse_states.includes("MEDIA_NOT_ANALYZED") === true;
  const blockingAmbiguity = interpretation.ambiguities.some((ambiguity) => ambiguity.blocking);
  const requiresConfirmation = interpretation.facts.some((fact) => fact.requires_confirmation);
  const goalLow = interpretation.goal?.confidence === "LOW";
  const eventLow = interpretation.primary_event?.confidence === "LOW";
  const caseLow = interpretation.case_reference.confidence === "LOW";
  const caseAmbiguous = interpretation.case_reference.kind === "AMBIGUOUS";

  // P0 is a safety escalation. Secondary LOW fields cannot cancel it.
  if (p0) {
    return event === "HUMAN_REQUEST"
      ? allow(interpretation, "P0_HUMAN_REQUEST_PRIORITY", ["risk", "handoff"])
      : block(interpretation, "P0_REQUIRES_HUMAN_REQUEST", "P0 sem HUMAN_REQUEST oficial", ["ambiguity"]);
  }
  if (media) return block(interpretation, "MEDIA_NOT_ANALYZED", "mídia essencial não analisada", ["ambiguity"]);
  const explicitReclassification = event === "RECLASSIFICATION" &&
    interpretation.official_mapping?.intent_changed === true;
  const multipleSubjects = interpretation.facts.some((fact) => fact.fact_code === "multiple_subjects_declaration");
  if (blockingAmbiguity && !explicitReclassification && !multipleSubjects) {
    return block(interpretation, "BLOCKING_AMBIGUITY", "ambiguidade bloqueadora", ["ambiguity"]);
  }
  if (multipleSubjects && event === "COMPLEMENT") {
    return allow(interpretation, "MULTIPLE_SUBJECTS_DECLARATION", ["conversation_scope", "case_isolation"]);
  }
  if (requiresConfirmation) {
    return block(interpretation, "FACT_REQUIRES_CONFIRMATION", "fato exige confirmação", ["requires_confirmation"]);
  }
  if (!event) return block(interpretation, "NO_EVENT", "nenhum evento oficial identificado", ["overall_confidence"]);

  switch (event) {
    case "RECLASSIFICATION":
      if (interpretation.official_mapping?.intent_changed !== true) {
        return block(interpretation, "RECLASSIFICATION_SIGNAL_MISSING", "intent_changed não foi validado", [
          "ambiguity",
        ]);
      }
      if (!interpretation.goal || goalLow) {
        return block(interpretation, "RECLASSIFICATION_GOAL_LOW", "goal necessário para reclassificar está LOW", [
          "goal.confidence",
        ]);
      }
      if (eventLow) {
        return block(interpretation, "RECLASSIFICATION_EVENT_LOW", "evento de reclassificação está LOW", [
          "primary_event.confidence",
        ]);
      }
      if (caseAmbiguous) {
        return block(
          interpretation,
          "RECLASSIFICATION_CASE_AMBIGUOUS",
          "case necessário para reclassificar é ambíguo",
          ["case_reference.confidence"],
        );
      }
      // A reclassificação é same-case; a referência do case atual não é uma
      // dependência do novo assunto quando o goal e a evidência estão claros.
      return allow(interpretation, "RECLASSIFICATION_GOAL_SUFFICIENT", ["intent_changed", "goal"]);

    case "NEW_GOAL":
      if (!interpretation.goal || goalLow) {
        return block(interpretation, "NEW_GOAL_GOAL_LOW", "goal necessário para novo case está LOW", [
          "goal.confidence",
        ]);
      }
      if (caseAmbiguous || caseLow) {
        return block(
          interpretation,
          "NEW_GOAL_CASE_REFERENCE_LOW",
          "identidade do novo case não está suficientemente identificada",
          ["case_reference.confidence"],
        );
      }
      if (eventLow) {
        return block(interpretation, "NEW_GOAL_EVENT_LOW", "evento de novo goal está LOW", [
          "primary_event.confidence",
        ]);
      }
      if ((interpretation.secondary_goals ?? []).some((goal) => goal.confidence === "LOW")) {
        return block(
          interpretation,
          "MULTI_INTENT_PARTIAL_CLARIFICATION",
          "um assunto paralelo está LOW; preservar o claro exige esclarecimento estrutural",
          ["goal.confidence"],
          ["primary_goal"],
        );
      }
      return allow(interpretation, "NEW_GOAL_DEPENDENCIES_SUFFICIENT", ["goal", "case_reference"]);

    case "CORRECTION":
    case "CHANGE_OF_MIND":
      if (goalLow || caseAmbiguous || (caseLow && interpretation.case_reference.kind !== "CURRENT")) {
        return block(interpretation, "CORRECTION_SCOPE_UNCERTAIN", "goal/case da correção não está identificado", [
          ...(goalLow ? ["goal.confidence" as const] : []),
          ...(caseLow || caseAmbiguous ? ["case_reference.confidence" as const] : []),
        ]);
      }
      if (eventLow) {
        return block(interpretation, "CORRECTION_EVENT_LOW", "evento de correção está LOW", [
          "primary_event.confidence",
        ]);
      }
      return allow(interpretation, "CORRECTION_FACT_SCOPE_SUFFICIENT", ["correction", "current_case"]);

    case "SOCIAL":
      return allow(interpretation, "SOCIAL_CLOSING_VALIDATED", ["closing"]);

    case "HUMAN_REQUEST":
      if (eventLow) {
        return block(interpretation, "HUMAN_REQUEST_EVENT_LOW", "handoff comum está LOW", ["primary_event.confidence"]);
      }
      return allow(interpretation, "HUMAN_REQUEST_HANDOFF", ["handoff"]);

    case "COMPLEMENT":
    case "ANSWER":
      if (caseAmbiguous) {
        return block(interpretation, "COMPLEMENT_CASE_AMBIGUOUS", "complemento não identifica o case", [
          "case_reference.confidence",
        ]);
      }
      if (eventLow) {
        return block(interpretation, "COMPLEMENT_EVENT_LOW", "complemento está LOW", ["primary_event.confidence"]);
      }
      return allow(interpretation, "COMPLEMENT_PRESERVE_CONTEXT", ["current_case", "known_facts", "pending_question"]);

    case "PARALLEL_QUESTION":
      if (goalLow || eventLow) {
        return block(interpretation, "PARALLEL_GOAL_LOW", "assunto paralelo está LOW", ["goal.confidence"]);
      }
      return allow(interpretation, "PARALLEL_INTENT_VALIDATED", ["primary_goal", "parallel_goal"]);

    case "COMPLAINT":
      if (goalLow || eventLow || caseAmbiguous) {
        return block(interpretation, "COMPLAINT_SCOPE_UNCERTAIN", "reclamação sem escopo suficiente", [
          "primary_event.confidence",
        ]);
      }
      return allow(interpretation, "COMPLAINT_SCOPE_SUFFICIENT", ["complaint", "current_case"]);

    case "UNCERTAIN":
      return block(interpretation, "UNCERTAIN_EVENT", "evento explicitamente incerto", ["primary_event.confidence"]);

    default:
      return low.includes("overall_confidence")
        ? block(interpretation, "OVERALL_LOW_RELEVANT", "LOW é relevante para o evento não mapeado", [
          "overall_confidence",
        ])
        : allow(interpretation, "EVENT_FIELDS_SUFFICIENT");
  }
}
