// Ponte interpretacao -> eventos do reducer. Nao decide dominio: apenas traduz
// a proposta ja sanitizada. Quando ha esclarecimento pendente, nada e enviado
// ao reducer — a conversa pede a informacao em vez de adivinhar.

import type { ConversationEvent, ConversationState } from "../../engine/engine.ts";
import { activeFactsForGoalCase, contextGoal, focusGoal, missingFacts } from "../../engine/engine.ts";
import { goalDef, questionForFact } from "../../engine/catalog.ts";
import type { Interpretation, InterpreterInput } from "./types.ts";

export interface BridgeResult {
  events: ConversationEvent[];
  clarification: { reason: string; options: string[] } | null;
}

export function contextFromState(state: ConversationState, knownHints: string[] = []): InterpreterInput["context"] {
  const goal = contextGoal(state);
  const subjectRef = state.cases.find((item) => item.case_id === goal?.case_id)?.subject_ref;
  // Legacy states may carry a message id instead of a subject hint. Do not
  // feed those ids to the interpreter as if they identified the deceased.
  const subjectHint = subjectRef?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(
    /^(?:meu|minha) (?:pai|mae|avo|irmao|irma|marido|esposa|filho|filha|tio|tia)(?::|$)/,
  )?.[0]
    .replace(/:$/, "");
  return {
    has_open_goal: state.goals.some((g) => ["ACTIVE", "SUSPENDED", "WAITING"].includes(g.status)),
    open_goal_code: goal ? goal.goal_code : null,
    pending_question_fact: state.pending_question ? state.pending_question.fact_code : null,
    known_subject_hints: knownHints.length > 0 ? knownHints : subjectHint ? [subjectHint] : [],
    known_facts: goal
      ? activeFactsForGoalCase(state, goal).map((fact) => ({
        fact_code: fact.fact_code,
        value: fact.value,
        confidence: fact.confidence,
        source: fact.source,
      }))
      : [],
  };
}

export function toConversationEvents(interpretation: Interpretation, state?: ConversationState): BridgeResult {
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
  const currentCaseId = state ? contextGoal(state)?.case_id : null;
  const currentCaseRef = state?.cases.find((item) => item.case_id === currentCaseId)?.subject_ref;
  // A linguistic hint ("minha tia") is not a unique person identifier. A
  // NEW demand must never silently reuse an older case bearing that hint.
  const caseRef = interpretation.case_reference.kind === "NEW"
    ? `${interpretation.case_reference.subject_hint ?? "demand"}:${interpretation.message_id}`
    : currentCaseRef ?? interpretation.case_reference.subject_hint ?? interpretation.message_id;

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
    const complaintCodes = new Set(goalDef("GOAL_RECLAMACAO").required_facts);
    const baseFacts = facts.filter((fact) => !complaintCodes.has(fact.code));
    const complaintFacts = facts.filter((fact) => complaintCodes.has(fact.code));
    // A queixa abre/usa o assunto-base em uma unica transacao.  Isso impede que
    // um base goal seja resolvido entre dois eventos e que a ocorrência fique sem
    // dono quando a primeira mensagem já é uma reclamação.
    events.push({
      kind: "COMPLAINT",
      base_goal_code: interpretation.goal?.goal_code ?? "GOAL_OUTROS_ASSUNTOS",
      case_ref: caseRef,
      base_facts: baseFacts,
      facts: complaintFacts,
    });
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
  if (state.pending_question) return questionForFact(state.pending_question.fact_code).text;
  const goal = focusGoal(state);
  if (
    goal && goalDef(goal.goal_code).completion_mode === "EXPLICIT_HANDOFF" && missingFacts(state, goal).length === 0
  ) {
    return "Você pode continuar explicando a situação ou enviar uma foto e outras referências do jazigo. Quando terminar de enviar as informações, escreva FINALIZAR para encaminhar o atendimento à equipe.";
  }
  const missing = goal ? missingFacts(state, goal)[0] : undefined;
  return missing ? questionForFact(missing.code).text : "Pode me explicar um pouco melhor?";
}
