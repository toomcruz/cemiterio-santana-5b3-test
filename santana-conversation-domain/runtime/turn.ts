import { applyEvent, type ConversationState } from "../engine/engine.ts";
import { questionForFact } from "../engine/catalog.ts";
import type { LanguageInterpreter } from "./adapter/adapter.ts";
import { parseStrictInterpretation } from "./adapter/schema.ts";
import { clarificationQuestion, contextFromState, toConversationEvents } from "./interpreter/bridge.ts";
import { guardInterpretation } from "./interpreter/guard.ts";
import type { Interpretation } from "./interpreter/types.ts";
import { draftReply } from "./reply.ts";

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
}

/**
 * Official per-turn orchestration. No transport, database, or parallel rules.
 * The interpreter runs on active turns too; only the canonical reducer advances state.
 * The caller must atomically deduplicate, check version/mode, persist and enqueue.
 * A plan is not proof of storage, request creation, or delivery.
 */
export async function planTurn(input: TurnInput, interpreter: LanguageInterpreter): Promise<TurnPlan> {
  if (!input.message_id.trim()) throw new Error("message_id required");
  const previous = structuredClone(input.state);
  const unchanged = (outcome: TurnPlan["outcome"]): TurnPlan => ({
    outcome,
    expected_seq: previous.seq,
    next_state: structuredClone(previous),
    interpretation: null,
    question_draft: null,
    reply_draft: null,
  });
  if (input.automation_mode !== "BOT_ACTIVE") return unchanged("HUMAN_ACTIVE");
  const request = {
    message_id: input.message_id,
    text: input.text,
    context: contextFromState(previous),
  };
  let interpretation: Interpretation;
  try {
    // Revalidate even injected providers: TypeScript types are not a trust boundary.
    const candidate = await interpreter.interpret(request);
    interpretation = guardInterpretation(parseStrictInterpretation(JSON.stringify(candidate), request));
  } catch {
    return unchanged("INTERPRETATION_UNAVAILABLE");
  }
  if (
    interpretation.overall_confidence === "LOW" ||
    interpretation.primary_event?.confidence === "LOW" ||
    interpretation.goal?.confidence === "LOW" ||
    interpretation.case_reference.confidence === "LOW" ||
    interpretation.case_reference.kind === "AMBIGUOUS" ||
    (interpretation.primary_event?.event_kind === "UNCERTAIN" && interpretation.facts.length === 0) ||
    interpretation.ambiguities.some((ambiguity) => ambiguity.blocking) ||
    interpretation.facts.some((fact) => fact.requires_confirmation)
  ) interpretation = { ...interpretation, needs_clarification: true };
  const bridge = toConversationEvents(interpretation);
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
      }),
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
      }),
    };
  } catch {
    // No partial transition escapes if an event cannot be applied.
    return unchanged("INTERPRETATION_UNAVAILABLE");
  }
}
