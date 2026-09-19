import { applyEvent, type ConversationState } from "../engine/engine.ts";
import { questionForFact } from "../engine/catalog.ts";
import type { LanguageInterpreter } from "./adapter/adapter.ts";
import { parseStrictInterpretation } from "./adapter/schema.ts";
import { clarificationQuestion, contextFromState, toConversationEvents } from "./interpreter/bridge.ts";
import { guardInterpretation } from "./interpreter/guard.ts";
import type { Interpretation } from "./interpreter/types.ts";
import { contextualExplanation, contextualStatus, draftReply } from "./reply.ts";
import { isConversationRestart } from "./interpreter/conversation_controls.ts";
import { arbitrateConfidence } from "./interpreter/confidence_matrix.ts";

export interface TurnInput {
  message_id: string;
  text: string;
  state: ConversationState;
  automation_mode: "BOT_ACTIVE" | "HUMAN_ACTIVE";
}

export interface TurnPlan {
  outcome: "PROPOSED" | "CLARIFICATION" | "HUMAN_ACTIVE" | "INTERPRETATION_UNAVAILABLE";
  expected_seq: number;
  next_state: ConversationState;
  interpretation: Interpretation | null;
  /** A draft only: persistence/outbox must commit before it can be sent. */
  question_draft: string | null;
  /** Human-facing draft; never send it before persistence/outbox commit. */
  reply_draft: string | null;
  route: TurnRoute;
}

export type TurnRoute = {
  route_attempted: "MOTOR_V2" | "CURRENT_DETERMINISTIC";
  provider_result: "VALID" | "REJECTED" | "NOT_ATTEMPTED";
  failover_route: "CURRENT_DETERMINISTIC" | null;
  reason: string | null;
  ai_output_used: boolean;
};

export interface TurnExecutionOptions {
  fallbackInterpreter?: LanguageInterpreter;
  route_attempted?: TurnRoute["route_attempted"];
  onFailover?: (route: TurnRoute) => void;
}

function failureReason(error: unknown): string {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const category = typeof value.rejectionCategory === "string" ? value.rejectionCategory : "";
  if (category === "canonical_enum_invalid") return "CANONICAL_ENUM_INVALID";
  if (category.startsWith("canonical_")) return "CANONICAL_OUTPUT_REJECTED";
  if (value.rejectionCode === "PROVIDER_TIMEOUT") return "PROVIDER_TIMEOUT";
  if (typeof value.rejectionCode === "string" && value.rejectionCode.startsWith("PROVIDER_HTTP_")) {
    return "PROVIDER_HTTP_ERROR";
  }
  if (value.rejectionCode === "STRUCTURED_OUTPUT_REJECTED") return "STRUCTURED_OUTPUT_REJECTED";
  return "PROVIDER_ERROR";
}

/**
 * Official per-turn orchestration. No transport, database, or parallel rules.
 * The interpreter runs on active turns too; only the canonical reducer advances state.
 * The caller must atomically deduplicate, check version/mode, persist and enqueue.
 * A plan is not proof of storage, request creation, or delivery.
 */
export async function planTurn(
  input: TurnInput,
  interpreter: LanguageInterpreter,
  options: TurnExecutionOptions = {},
): Promise<TurnPlan> {
  if (!input.message_id.trim()) throw new Error("message_id required");
  const previous = structuredClone(input.state);
  const defaultRoute: TurnRoute = {
    route_attempted: options.route_attempted ?? "CURRENT_DETERMINISTIC",
    provider_result: options.route_attempted === "MOTOR_V2" ? "NOT_ATTEMPTED" : "NOT_ATTEMPTED",
    failover_route: null,
    reason: null,
    ai_output_used: false,
  };
  const unchanged = (outcome: TurnPlan["outcome"], route = defaultRoute): TurnPlan => ({
    outcome,
    expected_seq: previous.seq,
    next_state: structuredClone(previous),
    interpretation: null,
    question_draft: null,
    reply_draft: null,
    route,
  });
  if (input.automation_mode !== "BOT_ACTIVE") return unchanged("HUMAN_ACTIVE");
  if (
    input.state.goals.some((goal) => ["ACTIVE", "SUSPENDED", "WAITING"].includes(goal.status)) &&
    isConversationRestart(input.text)
  ) {
    const current = contextFromState(previous).open_goal_code?.replace(/^GOAL_/, "").toLowerCase() ?? "atual";
    const reply =
      `Tudo bem. O atendimento de ${current} e o protocolo atual serão preservados. Você quer tratar de outro assunto ou continuar neste atendimento? Diga qual assunto deseja seguir, e eu mantenho os casos separados.`;
    return {
      ...unchanged("CLARIFICATION"),
      question_draft: reply,
      reply_draft: reply,
    };
  }
  const explanation = contextualExplanation(previous, input.text);
  if (explanation) {
    return {
      ...unchanged("CLARIFICATION"),
      question_draft: explanation,
      reply_draft: explanation,
    };
  }
  const request = {
    message_id: input.message_id,
    text: input.text,
    context: contextFromState(previous),
  };
  let interpretation: Interpretation;
  let route = defaultRoute;
  try {
    // Revalidate even injected providers: TypeScript types are not a trust boundary.
    const candidate = await interpreter.interpret(request);
    interpretation = guardInterpretation(parseStrictInterpretation(JSON.stringify(candidate), request));
    route = {
      ...defaultRoute,
      provider_result: options.route_attempted === "MOTOR_V2" ? "VALID" : "NOT_ATTEMPTED",
      ai_output_used: options.route_attempted === "MOTOR_V2",
    };
  } catch (error) {
    route = {
      ...defaultRoute,
      provider_result: options.route_attempted === "MOTOR_V2" ? "REJECTED" : "NOT_ATTEMPTED",
      failover_route: options.fallbackInterpreter ? "CURRENT_DETERMINISTIC" : null,
      reason: options.route_attempted === "MOTOR_V2" ? failureReason(error) : null,
    };
    if (options.fallbackInterpreter) {
      options.onFailover?.(route);
      try {
        const fallback = await options.fallbackInterpreter.interpret(request);
        interpretation = guardInterpretation(parseStrictInterpretation(JSON.stringify(fallback), request));
      } catch {
        return unchanged("INTERPRETATION_UNAVAILABLE", route);
      }
    } else {
      return unchanged("INTERPRETATION_UNAVAILABLE", route);
    }
  }
  // Status is a response to a narrowly identified return/status utterance,
  // never a keyword shortcut that swallows corrections, questions or handoff.
  const status = contextualStatus(previous, input.text, interpretation);
  if (status) {
    // The reducer also repairs a missing question in an older waiting state.
    // Preserve all collected facts and decisions; only this return turn and
    // its next question are recorded, without creating another demand.
    try {
      const next = applyEvent(previous, { kind: "SOCIAL", note: "CONTEXTUAL_STATUS" });
      return {
        outcome: "PROPOSED",
        expected_seq: previous.seq,
        next_state: next,
        interpretation: {
          ...interpretation,
          primary_event: { event_kind: "SOCIAL", confidence: "HIGH", evidence: input.text },
        },
        question_draft: next.pending_question ? questionForFact(next.pending_question.fact_code).text : null,
        reply_draft: contextualStatus(next, input.text, interpretation) ?? status,
        route,
      };
    } catch {
      return unchanged("INTERPRETATION_UNAVAILABLE", route);
    }
  }
  const confidenceDecision = arbitrateConfidence(interpretation);
  interpretation = confidenceDecision.force_clarification
    ? {
      ...interpretation,
      needs_clarification: true,
      clarification_reason: confidenceDecision.reason,
    }
    : {
      ...interpretation,
      needs_clarification: false,
      clarification_reason: null,
    };
  const bridge = toConversationEvents(interpretation, previous);
  if (bridge.clarification) {
    const questionDraft = clarificationQuestion(previous, bridge);
    return {
      ...unchanged("CLARIFICATION"),
      interpretation,
      question_draft: questionDraft,
      reply_draft: draftReply({
        outcome: "CLARIFICATION",
        question_draft: questionDraft,
        interpretation,
        next_state: previous,
        previous_state: previous,
      }),
      route,
    };
  }
  try {
    const next = bridge.events.reduce(applyEvent, previous);
    const questionDraft = next.pending_question ? questionForFact(next.pending_question.fact_code).text : null;
    return {
      outcome: "PROPOSED",
      expected_seq: previous.seq,
      next_state: next,
      interpretation,
      question_draft: questionDraft,
      reply_draft: draftReply({
        outcome: "PROPOSED",
        question_draft: questionDraft,
        interpretation,
        next_state: next,
        previous_state: previous,
      }),
      route,
    };
  } catch {
    // No partial transition escapes if an event cannot be applied.
    return unchanged("INTERPRETATION_UNAVAILABLE", route);
  }
}
