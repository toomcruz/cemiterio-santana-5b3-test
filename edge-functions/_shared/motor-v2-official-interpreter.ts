import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import type { UnderstandingResult } from "../../santana-conversation-domain/motor-v2/types.ts";
import {
  enforceDeterministicRisk,
  type UnderstandingProvider,
  understandMessages,
} from "../../santana-conversation-domain/motor-v2/understanding.ts";
import { interpret as deterministicInterpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../../santana-conversation-domain/runtime/interpreter/guard.ts";
import type { LanguageInterpreter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import type { EventKind } from "../../santana-conversation-domain/engine/catalog.ts";
import type { Interpretation, InterpreterInput } from "../../santana-conversation-domain/runtime/interpreter/types.ts";

export type MotorV2Observation = ControlledNvidiaAiObservation;

export interface MotorV2UnderstandingObservation {
  provider: UnderstandingResult;
  merged: UnderstandingResult;
}

function officialConfidence(value: UnderstandingResult["confidence"]): "HIGH" | "MEDIUM" | "LOW" {
  return value.toUpperCase() as "HIGH" | "MEDIUM" | "LOW";
}

const SUBINTENT_GOALS: Readonly<Record<string, string>> = {
  EXUMACAO: "GOAL_EXUMACAO",
  RETIRAR_RESTOS: "GOAL_EXUMACAO",
  DESTINO_OSSUARIO: "GOAL_EXUMACAO",
  DESTINO_RESTOS: "GOAL_EXUMACAO",
  CREMACAO: "GOAL_EXUMACAO",
  CREMACAO_IMEDIATA: "GOAL_EXUMACAO",
  CORPO_SEMI_INTACTO: "GOAL_EXUMACAO",
  REINUMACAO: "GOAL_EXUMACAO",
  TRASLADO: "GOAL_TRANSPORTE",
  SEPULTAMENTO: "GOAL_TRANSPORTE",
  RECADASTRO: "GOAL_RECADASTRO",
  CONCESSAO: "GOAL_CONCESSAO",
  SUCESSAO: "GOAL_CONCESSAO",
  TRANSFERENCIA: "GOAL_CONCESSAO",
  TITULARIDADE: "GOAL_CONCESSAO",
  JAZIGO_GERAL: "GOAL_JAZIGO_SERVICOS",
  LAPIDE_PLACA: "GOAL_JAZIGO_SERVICOS",
  LIMPEZA_ZELADORIA: "GOAL_JAZIGO_SERVICOS",
  MANUTENCAO_JAZIGO: "GOAL_JAZIGO_SERVICOS",
  OBRA_REFORMA: "GOAL_JAZIGO_SERVICOS",
  VISITA_JAZIGO: "GOAL_JAZIGO_SERVICOS",
  PLANO_ZELADORIA: "GOAL_JAZIGO_SERVICOS",
};

const INFORMATIONAL_GOALS = new Set(["GOAL_INFO_OSSUARIO", "GOAL_INFO_HORARIO"]);

function contextMessage(
  input: InterpreterInput,
): { turn_id: string; role: "assistant"; content: string; synthetic: true } {
  return {
    turn_id: `${input.message_id}:official-context`,
    role: "assistant",
    synthetic: true,
    content: JSON.stringify({
      context_kind: "official_structured_context",
      state: input.context.has_open_goal ? "ACTIVE" : "NEW",
      current_goal: input.context.open_goal_code,
      pending_question: input.context.pending_question_fact,
      known_subject_hints: input.context.known_subject_hints,
      known_facts: input.context.known_facts ?? [],
      active_case_id: input.context.active_case_id,
      active_goal_status: input.context.active_goal_status,
      handoff_active: input.context.handoff_active ?? false,
      parallel_goal_codes: input.context.parallel_goal_codes ?? [],
      pending_action_codes: input.context.pending_action_codes ?? [],
    }),
  };
}

function semanticGoals(understanding: UnderstandingResult): Set<string> {
  return new Set(
    understanding.subintents.map((subintent) => SUBINTENT_GOALS[subintent]).filter((goal): goal is string =>
      Boolean(goal)
    ),
  );
}

function semanticGoal(understanding: UnderstandingResult): string | null {
  const goals = semanticGoals(understanding);
  return goals.size === 1 ? [...goals][0] ?? null : null;
}

function semanticGoalCandidates(understanding: UnderstandingResult, evidence: string) {
  return [...semanticGoals(understanding)].map((goal_code) => ({
    goal_code,
    confidence: "MEDIUM" as const,
    evidence,
  }));
}

function mergeCurrentTurnSafetySignals(
  understanding: UnderstandingResult,
  input: InterpreterInput,
): UnderstandingResult {
  const deterministic = understandMessages([{
    turn_id: input.message_id,
    role: "user",
    content: input.text,
  }]);
  const mergedSubintents = [...new Set([...understanding.subintents, ...deterministic.subintents])];
  const mergedJourneys = [
    ...new Set([
      ...understanding.journeys,
      ...deterministic.journeys.filter((journey) => journey !== "DESCONHECIDA_AMBIGUA"),
    ]),
  ];
  const mergedStates = [...new Set([...understanding.transverse_states, ...deterministic.transverse_states])];
  const deterministicEvidence = deterministic.subintents.length > 0 || deterministic.transverse_states.length > 0 ||
      deterministic.risk.level !== "none"
    ? [input.message_id]
    : [];
  const merged: UnderstandingResult = {
    ...understanding,
    journeys: mergedJourneys,
    subintents: mergedSubintents,
    transverse_states: mergedStates,
    intent_changed: understanding.intent_changed || deterministic.intent_changed,
    evidence_turns: [...new Set([...understanding.evidence_turns, ...deterministicEvidence])],
  };
  const mapped = semanticGoal(merged);
  if (
    !merged.intent_changed && input.context.has_open_goal && mapped && input.context.open_goal_code &&
    mapped !== input.context.open_goal_code
  ) {
    merged.intent_changed = true;
    merged.transverse_states = [...new Set([...merged.transverse_states, "INTENT_CHANGED"])];
    merged.evidence_turns = [...new Set([...merged.evidence_turns, input.message_id])];
  }
  return enforceDeterministicRisk([{
    turn_id: input.message_id,
    role: "user",
    content: input.text,
  }], merged);
}

function applyUnderstandingToOfficialInterpretation(
  base: Interpretation,
  understanding: UnderstandingResult,
  input: InterpreterInput,
): Interpretation {
  const mappedGoal = semanticGoal(understanding);
  const mappedGoals = semanticGoals(understanding);
  const hasMultipleSemanticGoals = mappedGoals.size > 1 || understanding.journeys.length > 1 ||
    understanding.transverse_states.includes("MULTI_INTENT");
  const mediaNeedsReview = understanding.transverse_states.includes("MEDIA_NOT_ANALYZED");
  const lowConfidence = understanding.confidence === "low" || understanding.complexity === "critical";
  const currentTurnIsEvidence = understanding.evidence_turns.includes(input.message_id);
  const unmappedSemantic = understanding.subintents.length > 0 && mappedGoals.size === 0;
  const baseKind = base.primary_event?.event_kind ?? null;
  const baseIsHandoff = baseKind === "HUMAN_REQUEST";
  const baseIsCorrection = baseKind === "CORRECTION" || baseKind === "CHANGE_OF_MIND";
  const baseIsAnswerOrComplement = baseKind === "ANSWER" || baseKind === "COMPLEMENT";
  const baseIsNewGoal = baseKind === "NEW_GOAL" || base.case_reference.kind === "NEW";
  let result = base;
  const blockingAmbiguity = result.ambiguities.some((ambiguity) => ambiguity.blocking);
  const clarificationOnlyMissingEvent = result.needs_clarification && !result.primary_event && !blockingAmbiguity;
  const deterministicCurrent = understandMessages([{
    turn_id: input.message_id,
    role: "user",
    content: input.text,
  }]);
  const deterministicGoals = semanticGoals(deterministicCurrent);
  const deterministicGoalCount = deterministicGoals.size;
  const safeDeterministicRoute = Boolean(result.primary_event) &&
    ["NEW_GOAL", "CORRECTION", "CHANGE_OF_MIND", "COMPLEMENT", "ANSWER", "PARALLEL_QUESTION", "SOCIAL"].includes(
      baseKind ?? "",
    ) &&
    (
      baseIsCorrection ||
      baseIsAnswerOrComplement ||
      (baseIsNewGoal && deterministicGoalCount <= 1) ||
      !hasMultipleSemanticGoals
    ) &&
    !mediaNeedsReview && !blockingAmbiguity &&
    understanding.risk.level === "none";
  const safeReclassification = result.primary_event?.event_kind === "RECLASSIFICATION" &&
    mappedGoal !== null && !hasMultipleSemanticGoals && currentTurnIsEvidence &&
    !mediaNeedsReview && !blockingAmbiguity && understanding.risk.level === "none";
  const semanticClaimNeedsEvidence = (
    mappedGoals.size > 0 || understanding.intent_changed || understanding.risk.level !== "none"
  ) && !currentTurnIsEvidence;
  const closing = understanding.transverse_states.includes("CONVERSATION_CLOSING") &&
    understanding.risk.level === "none";

  // V2 can fill a missing semantic route only with a closed goal mapping. It
  // cannot create facts, rules, permissions or an administrative decision.
  if (
    !result.goal && mappedGoal && !INFORMATIONAL_GOALS.has(mappedGoal) && !input.context.has_open_goal &&
    !result.primary_event && !closing && currentTurnIsEvidence && understanding.confidence !== "low" &&
    understanding.risk.level === "none" && !blockingAmbiguity
  ) {
    result = {
      ...result,
      goal: { goal_code: mappedGoal, confidence: "MEDIUM", evidence: input.text },
      primary_event: input.context.has_open_goal
        ? result.primary_event
        : { event_kind: "NEW_GOAL", confidence: "MEDIUM", evidence: input.text },
      overall_confidence: "MEDIUM",
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  // An intent change is a semantic candidate. Only a single closed goal on an
  // already-open conversation can become the official same-case reclassification
  // event; all competing/unclear routes require clarification.
  if (
    understanding.intent_changed && mappedGoal && input.context.has_open_goal &&
    !hasMultipleSemanticGoals &&
    currentTurnIsEvidence &&
    !baseIsCorrection &&
    !baseIsAnswerOrComplement &&
    !baseIsNewGoal &&
    !["HUMAN_REQUEST", "COMPLAINT"].includes(result.primary_event?.event_kind ?? "") &&
    (!result.needs_clarification || clarificationOnlyMissingEvent)
  ) {
    result = {
      ...result,
      goal: { goal_code: mappedGoal, confidence: "MEDIUM", evidence: input.text },
      primary_event: { event_kind: "RECLASSIFICATION", confidence: "MEDIUM", evidence: input.text },
      case_reference: { ...result.case_reference, kind: "CURRENT" },
      overall_confidence: "MEDIUM",
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  if (closing && !hasMultipleSemanticGoals && !baseIsCorrection && !baseIsHandoff) {
    result = {
      ...result,
      primary_event: { event_kind: "SOCIAL", confidence: "HIGH", evidence: input.text },
      goal: null,
      secondary_goals: [],
      overall_confidence: "HIGH",
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  // A bounded multi-intent turn can preserve a primary goal and queue the
  // other closed goals as parallel topics in the same case.  Unsupported or
  // ambiguous shapes still fail closed rather than inventing a new case.
  const parallelGoals = semanticGoalCandidates(understanding, input.text)
    .filter((candidate) => candidate.goal_code !== result.goal?.goal_code);
  // LOW global confidence limits advancement, not preservation. Preserve a
  // parallel goal at LOW only when the closed V2 mapping agrees with the
  // deterministic interpretation of this same turn; no fuzzy or fallback
  // goal matching is allowed.
  const preservableParallelGoals = lowConfidence
    ? parallelGoals.filter((candidate) => deterministicGoals.has(candidate.goal_code))
    : parallelGoals;
  const canMaterializeParallel = hasMultipleSemanticGoals &&
    result.primary_event?.event_kind === "NEW_GOAL" &&
    result.goal !== null &&
    preservableParallelGoals.length > 0 &&
    currentTurnIsEvidence &&
    !mediaNeedsReview &&
    !unmappedSemantic &&
    !blockingAmbiguity &&
    understanding.risk.level === "none";
  if (canMaterializeParallel) {
    result = {
      ...result,
      secondary_goals: preservableParallelGoals,
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  if (
    (!canMaterializeParallel && hasMultipleSemanticGoals && !safeDeterministicRoute && !safeReclassification) ||
    mediaNeedsReview ||
    (lowConfidence && !canMaterializeParallel && !safeDeterministicRoute && !safeReclassification) ||
    (unmappedSemantic && !safeDeterministicRoute) ||
    (semanticClaimNeedsEvidence && !safeDeterministicRoute && !safeReclassification)
  ) {
    result = {
      ...result,
      needs_clarification: true,
      clarification_reason: mediaNeedsReview
        ? "mídia essencial ainda não analisada"
        : hasMultipleSemanticGoals
        ? "há mais de um assunto sem transição oficial única"
        : unmappedSemantic
        ? "subintenção sem mapeamento oficial seguro"
        : semanticClaimNeedsEvidence
        ? "evidência do turno atual ausente"
        : "compreensão semântica de baixa confiança",
    };
  }

  // Priority is explicit: P0 and a direct human request suppress automatic
  // clarification/questions. The reducer will build the handoff model.
  if (understanding.risk.level === "P0" || baseIsHandoff) {
    result = { ...result, needs_clarification: false, clarification_reason: null };
  }
  return result;
}

function mappingFor(understanding: UnderstandingResult, interpretation: Interpretation) {
  const selected = interpretation.primary_event?.event_kind ?? null;
  const suppressed: EventKind[] = [];
  if (understanding.intent_changed && selected !== "RECLASSIFICATION") suppressed.push("RECLASSIFICATION");
  if (understanding.risk.level === "P0" && selected !== "HUMAN_REQUEST") suppressed.push("HUMAN_REQUEST");
  if (understanding.transverse_states.includes("CONVERSATION_CLOSING") && selected !== "SOCIAL") {
    suppressed.push("SOCIAL");
  }
  return {
    journeys: understanding.journeys,
    subintents: understanding.subintents,
    transverse_states: understanding.transverse_states,
    intent_changed: understanding.intent_changed,
    complexity: understanding.complexity,
    risk_level: understanding.risk.level,
    confidence: understanding.confidence,
    evidence_turn_ids: understanding.evidence_turns,
    selected_event: selected,
    suppressed_events: suppressed,
    reason: interpretation.needs_clarification
      ? interpretation.clarification_reason ?? "blocked_by_official_guard"
      : "closed_mapping_applied",
  };
}

/**
 * Bridges the approved V2 understanding boundary into the official reducer.
 * The reducer/store/outbox remain authoritative; V2 supplies only closed
 * semantic hints and risk signals, never administrative facts or direct delivery.
 */
export class MotorV2OfficialInterpreter implements LanguageInterpreter {
  constructor(
    private readonly provider: UnderstandingProvider,
    private readonly observeUnderstanding?: (event: MotorV2UnderstandingObservation) => void,
  ) {}

  async interpret(input: InterpreterInput): Promise<Interpretation> {
    const messages = [contextMessage(input), { turn_id: input.message_id, role: "user" as const, content: input.text }];
    const providerUnderstanding = await this.provider.understand(messages) as UnderstandingResult;
    const understanding = mergeCurrentTurnSafetySignals(providerUnderstanding, input);
    this.observeUnderstanding?.({ provider: providerUnderstanding, merged: understanding });
    const base = guardInterpretation(deterministicInterpret(input));
    const integrated = applyUnderstandingToOfficialInterpretation(base, understanding, input);
    const p0 = understanding.risk.level === "P0";
    const mediaNeedsReview = understanding.transverse_states.includes("MEDIA_NOT_ANALYZED");
    if (p0) {
      const p0Confidence = officialConfidence(understanding.confidence);
      const result = guardInterpretation({
        ...integrated,
        // Preserve the provider's confidence; P0 priority is an event rule,
        // not a promotion of LOW to HIGH.
        primary_event: {
          event_kind: "HUMAN_REQUEST",
          confidence: p0Confidence,
          evidence: input.text,
        },
        overall_confidence: p0Confidence,
        needs_clarification: false,
        clarification_reason: null,
        produced_by: "motor-v2-official-interpreter",
      });
      return { ...result, official_mapping: mappingFor(understanding, result) };
    }
    if (mediaNeedsReview) {
      const result = guardInterpretation({
        ...integrated,
        needs_clarification: true,
        clarification_reason: "mídia essencial ainda não analisada",
        produced_by: "motor-v2-official-interpreter",
      });
      return { ...result, official_mapping: mappingFor(understanding, result) };
    }
    const result = guardInterpretation({ ...integrated, produced_by: "motor-v2-official-interpreter" });
    return { ...result, official_mapping: mappingFor(understanding, result) };
  }
}

export function createMotorV2OfficialInterpreter(
  apiKey: string,
  observe?: (event: MotorV2Observation) => void,
  observeUnderstanding?: (event: MotorV2UnderstandingObservation) => void,
): MotorV2OfficialInterpreter {
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey,
    model: CONTROLLED_NVIDIA_MODEL,
    timeoutMs: 60_000,
    maxOutputTokens: 1024,
    failOnFallback: true,
    observe,
  });
  return new MotorV2OfficialInterpreter(provider, observeUnderstanding);
}
