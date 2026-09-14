import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import type { UnderstandingProvider } from "../../santana-conversation-domain/motor-v2/understanding.ts";
import type { UnderstandingResult } from "../../santana-conversation-domain/motor-v2/types.ts";
import { interpret as deterministicInterpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../../santana-conversation-domain/runtime/interpreter/guard.ts";
import type { LanguageInterpreter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import type { Interpretation, InterpreterInput } from "../../santana-conversation-domain/runtime/interpreter/types.ts";

export type MotorV2Observation = ControlledNvidiaAiObservation;

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

function contextMessage(input: InterpreterInput): { turn_id: string; role: "assistant"; content: string; synthetic: true } {
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
    understanding.subintents.map((subintent) => SUBINTENT_GOALS[subintent]).filter((goal): goal is string => Boolean(goal)),
  );
}

function semanticGoal(understanding: UnderstandingResult): string | null {
  const goals = semanticGoals(understanding);
  return goals.size === 1 ? [...goals][0] ?? null : null;
}

function applyUnderstandingToOfficialInterpretation(
  base: Interpretation,
  understanding: UnderstandingResult,
  input: InterpreterInput,
): Interpretation {
  const mappedGoal = semanticGoal(understanding);
  const mappedGoals = semanticGoals(understanding);
  const hasMultipleSemanticGoals = mappedGoals.size > 1 || understanding.transverse_states.includes("MULTI_INTENT");
  const mediaNeedsReview = understanding.transverse_states.includes("MEDIA_NOT_ANALYZED");
  const lowConfidence = understanding.confidence === "low" || understanding.complexity === "critical";
  const closing = understanding.transverse_states.includes("CONVERSATION_CLOSING") &&
    understanding.risk.level === "none" && input.context.pending_question_fact === null;
  let result = base;

  // V2 can fill a missing semantic route only with a closed goal mapping. It
  // cannot create facts, rules, permissions or an administrative decision.
  if (!result.goal && mappedGoal && !INFORMATIONAL_GOALS.has(mappedGoal)) {
    result = {
      ...result,
      goal: { goal_code: mappedGoal, confidence: "MEDIUM", evidence: input.text },
      primary_event: input.context.has_open_goal
        ? result.primary_event
        : { event_kind: "NEW_GOAL", confidence: "MEDIUM", evidence: input.text },
    };
  }

  // An intent change is a semantic candidate. Only a single closed goal on an
  // already-open conversation can become the official same-case reclassification
  // event; all competing/unclear routes require clarification.
  if (
    understanding.intent_changed && mappedGoal && input.context.has_open_goal &&
    !hasMultipleSemanticGoals &&
    ["COMPLEMENT", "ANSWER", "SOCIAL"].includes(result.primary_event?.event_kind ?? "")
  ) {
    result = {
      ...result,
      goal: { goal_code: mappedGoal, confidence: "MEDIUM", evidence: input.text },
      primary_event: { event_kind: "RECLASSIFICATION", confidence: "MEDIUM", evidence: input.text },
      case_reference: { ...result.case_reference, kind: "CURRENT" },
    };
  }

  if (closing && !result.primary_event && !hasMultipleSemanticGoals) {
    result = {
      ...result,
      primary_event: { event_kind: "SOCIAL", confidence: "HIGH", evidence: input.text },
      overall_confidence: "HIGH",
      needs_clarification: false,
      clarification_reason: null,
    };
  }

  if (hasMultipleSemanticGoals || mediaNeedsReview || lowConfidence) {
    result = {
      ...result,
      needs_clarification: true,
      clarification_reason: mediaNeedsReview
        ? "mídia essencial ainda não analisada"
        : hasMultipleSemanticGoals
        ? "há mais de um assunto sem transição oficial única"
        : "compreensão semântica de baixa confiança",
    };
  }
  return result;
}

/**
 * Bridges the approved V2 understanding boundary into the official reducer.
 * The reducer/store/outbox remain authoritative; V2 can only supply semantic
 * risk and confidence signals, never administrative facts or direct delivery.
 */
export class MotorV2OfficialInterpreter implements LanguageInterpreter {
  constructor(
    private readonly provider: UnderstandingProvider,
  ) {}

  async interpret(input: InterpreterInput): Promise<Interpretation> {
    const messages = [contextMessage(input), { turn_id: input.message_id, role: "user" as const, content: input.text }];
    const understanding = await this.provider.understand(messages) as UnderstandingResult;
    const base = guardInterpretation(deterministicInterpret(input));
    const integrated = applyUnderstandingToOfficialInterpretation(base, understanding, input);
    const p0 = understanding.risk.level === "P0";
    const mediaNeedsReview = understanding.transverse_states.includes("MEDIA_NOT_ANALYZED");
    if (p0) {
      return guardInterpretation({
        ...integrated,
        primary_event: { event_kind: "HUMAN_REQUEST", confidence: "HIGH", evidence: input.text },
        overall_confidence: "HIGH",
        needs_clarification: false,
        clarification_reason: null,
        produced_by: "motor-v2-official-interpreter",
      });
    }
    if (mediaNeedsReview) {
      return guardInterpretation({
        ...integrated,
        needs_clarification: true,
        clarification_reason: "mídia essencial ainda não analisada",
        produced_by: "motor-v2-official-interpreter",
      });
    }
    return guardInterpretation({ ...integrated, produced_by: "motor-v2-official-interpreter" });
  }
}

export function createMotorV2OfficialInterpreter(
  apiKey: string,
  observe?: (event: MotorV2Observation) => void,
): MotorV2OfficialInterpreter {
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey,
    model: CONTROLLED_NVIDIA_MODEL,
    timeoutMs: 60_000,
    maxOutputTokens: 1024,
    failOnFallback: true,
    observe,
  });
  return new MotorV2OfficialInterpreter(provider);
}
