// Ponte interpretacao -> eventos do reducer. Nao decide dominio: apenas traduz
// a proposta ja sanitizada. Quando ha esclarecimento pendente, nada e enviado
// ao reducer — a conversa pede a informacao em vez de adivinhar.

import type { ConversationEvent, ConversationState } from "../../engine/engine.ts";
import { focusGoal, missingFacts } from "../../engine/engine.ts";
import type { Interpretation, InterpreterInput } from "./types.ts";

export interface BridgeResult {
  events: ConversationEvent[];
  clarification: { reason: string; options: string[] } | null;
}

export function contextFromState(state: ConversationState, knownHints: string[] = []): InterpreterInput["context"] {
  const goal = focusGoal(state);
  return {
    has_open_goal: state.goals.some((g) => ["ACTIVE", "SUSPENDED", "WAITING"].includes(g.status)),
    open_goal_code: goal ? goal.goal_code : null,
    pending_question_fact: state.pending_question ? state.pending_question.fact_code : null,
    known_subject_hints: knownHints,
  };
}

export function toConversationEvents(interpretation: Interpretation): BridgeResult {
  if (interpretation.needs_clarification || !interpretation.primary_event) {
    return {
      events: [],
      clarification: {
        reason: interpretation.clarification_reason ?? "interpretacao insuficiente",
        options: interpretation.ambiguities.flatMap((a) => a.options),
      },
    };
  }

  const events: ConversationEvent[] = [];
  const facts = interpretation.facts.map((f) => ({
    code: f.fact_code,
    value: f.value,
    source: f.source,
  }));

  const kind = interpretation.primary_event.event_kind;
  const caseRef = interpretation.case_reference.subject_hint ?? interpretation.message_id;

  if (kind === "NEW_GOAL") {
    if (!interpretation.goal) {
      return { events: [], clarification: { reason: "objetivo nao identificado", options: [] } };
    }
    events.push({ kind: "NEW_GOAL", goal_code: interpretation.goal.goal_code, case_ref: caseRef });
    if (facts.length > 0) events.push({ kind: "COMPLEMENT", facts });
    return { events, clarification: null };
  }

  if (kind === "PARALLEL_QUESTION") {
    if (!interpretation.goal) {
      return { events: [], clarification: { reason: "duvida paralela sem topico", options: [] } };
    }
    events.push({ kind: "PARALLEL_QUESTION", goal_code: interpretation.goal.goal_code, facts });
    return { events, clarification: null };
  }

  if (kind === "COMPLAINT") {
    for (const secondary of interpretation.secondary_events) {
      if (secondary.event_kind === "NEW_GOAL" && interpretation.goal) {
        events.push({ kind: "NEW_GOAL", goal_code: interpretation.goal.goal_code, case_ref: caseRef });
      }
    }
    if (facts.length > 0) events.push({ kind: "COMPLEMENT", facts });
    events.push({ kind: "COMPLAINT" });
    return { events, clarification: null };
  }

  events.push({ kind, facts });
  return { events, clarification: null };
}

/** Pergunta a fazer quando a interpretacao nao autoriza avancar. */
export function clarificationQuestion(state: ConversationState, result: BridgeResult): string | null {
  if (!result.clarification) return null;
  if (result.clarification.options.length > 0) {
    return `Preciso confirmar: ${result.clarification.options.join(" ou ")}?`;
  }
  const goal = focusGoal(state);
  const missing = goal ? missingFacts(state, goal)[0] : undefined;
  return missing ? `Pode confirmar ${missing.code}?` : "Pode me explicar um pouco melhor?";
}
