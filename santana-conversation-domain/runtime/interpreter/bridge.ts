// Ponte interpretacao -> eventos do reducer. Nao decide dominio: apenas traduz
// a proposta ja sanitizada. Quando ha esclarecimento pendente, nada e enviado
// ao reducer — a conversa pede a informacao em vez de adivinhar.

import type { ConversationEvent, ConversationState } from "../../engine/engine.ts";
import { activeFactsForGoalCase, contextGoal, focusGoal, missingFacts } from "../../engine/engine.ts";
import { goalDef, questionForFact } from "../../engine/catalog.ts";
import { isConversationReturn } from "./conversation_controls.ts";
import type { Interpretation, InterpreterInput } from "./types.ts";

export interface BridgeResult {
  events: ConversationEvent[];
  clarification: { reason: string; options: string[] } | null;
}

export function contextFromState(state: ConversationState, knownHints: string[] = []): InterpreterInput["context"] {
  const goal = contextGoal(state);
  const contextGoalRecord = goal ?? [...state.goals].reverse().find((item) => item.status === "SUSPENDED") ?? null;
  const subjectRef = state.cases.find((item) => item.case_id === contextGoalRecord?.case_id)?.subject_ref;
  const normalizeHint = (value: string): string => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  // Legacy states may carry a message id instead of a subject hint. Do not
  // feed those ids to the interpreter as if they identified the deceased.
  const subjectHint = subjectRef?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(
    /^(?:meu|minha) (?:pai|mae|avo|irmao|irma|marido|esposa|filho|filha|tio|tia)(?::|$)/,
  )?.[0]
    .replace(/:$/, "");
  const caseHints = state.cases.map((item) => item.subject_ref.split(":")[0]?.trim() ?? "")
    .filter((item) => item.length > 1 && !/^(?:demand|request|case|message)$/i.test(item))
    .map(normalizeHint);
  const allKnownHints = [...new Set([
    ...knownHints.map(normalizeHint),
    ...caseHints,
    ...(subjectHint ? [subjectHint] : []),
  ])];
  return {
    has_open_goal: state.goals.some((g) => ["ACTIVE", "SUSPENDED", "WAITING"].includes(g.status)),
    open_goal_code: contextGoalRecord ? contextGoalRecord.goal_code : null,
    pending_question_fact: state.pending_question ? state.pending_question.fact_code : null,
    known_subject_hints: allKnownHints,
    known_facts: (goal
      ? activeFactsForGoalCase(state, goal)
      : state.facts.filter((fact) => fact.status === "ACTIVE" && fact.case_id === null && fact.goal_id === null)
    ).map((fact) => ({
        fact_code: fact.fact_code,
        value: fact.value,
        confidence: fact.confidence,
        source: fact.source,
      })),
    active_case_id: contextGoalRecord?.case_id ?? null,
    active_goal_status: contextGoalRecord?.status ?? null,
    handoff_active: state.handoff !== null,
    parallel_goal_codes: state.goals.filter((item) => item.informational && item.status !== "RESOLVED").map((item) =>
      item.goal_code
    ),
    pending_action_codes: state.pending_actions.map((action) => action.action_code),
  };
}

export function toConversationEvents(interpretation: Interpretation, state?: ConversationState): BridgeResult {
  const priorityHandoff = interpretation.primary_event?.event_kind === "HUMAN_REQUEST";
  const priorityLifecycle = interpretation.primary_event?.event_kind === "SOCIAL" &&
    (interpretation.official_mapping?.transverse_states.includes("CONVERSATION_CLOSING") === true ||
      interpretation.official_mapping?.transverse_states.includes("CONVERSATION_PAUSED") === true ||
      interpretation.official_mapping?.transverse_states.includes("CONVERSATION_RESUMED") === true);
  if ((interpretation.needs_clarification && !priorityHandoff && !priorityLifecycle) || !interpretation.primary_event) {
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
  const p0Handoff = kind === "HUMAN_REQUEST" && interpretation.official_mapping?.risk_level === "P0";
  const closeConversation = kind === "SOCIAL" &&
    interpretation.official_mapping?.transverse_states.includes("CONVERSATION_CLOSING") === true;
  const pauseConversation = kind === "SOCIAL" &&
    interpretation.official_mapping?.transverse_states.includes("CONVERSATION_PAUSED") === true;
  const currentCaseId = state ? contextGoal(state)?.case_id : null;
  const normalizeHint = (value: string): string => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const requestedHint = interpretation.case_reference.subject_hint ? normalizeHint(interpretation.case_reference.subject_hint) : null;
  const focusCandidates = state?.goals.filter((candidate) => ["ACTIVE", "WAITING", "SUSPENDED"].includes(candidate.status)) ?? [];
  const returnRequest = kind === "SOCIAL" && !!state && isConversationReturn(interpretation.text_normalized);
  const pausedCaseReturn = returnRequest && state?.event_log.at(-1)?.note === "PAUSE_CASE";
  const focusTarget = kind === "SOCIAL" && state && isConversationReturn(interpretation.text_normalized)
    ? (pausedCaseReturn
      ? null
      : requestedHint
      ? focusCandidates.find((candidate) => {
        if (candidate.case_id === currentCaseId) return false;
        const ref = state.cases.find((item) => item.case_id === candidate.case_id)?.subject_ref ?? "";
        return normalizeHint(ref).includes(requestedHint);
      })
      : null) ?? focusCandidates.sort((a, b) => b.stack_index - a.stack_index)
        .find((candidate) => candidate.case_id !== currentCaseId)
    : null;
  const resumeConversation = kind === "SOCIAL" && !!state && pausedCaseReturn &&
    ["CLOSE", "PAUSE_CASE"].includes(state.event_log.at(-1)?.note ?? "") &&
    isConversationReturn(interpretation.text_normalized);
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
    for (const secondary of interpretation.secondary_goals ?? []) {
      events.push({ kind: "PARALLEL_QUESTION", goal_code: secondary.goal_code, facts: [] });
    }
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

  if (kind === "RECLASSIFICATION") {
    if (!interpretation.goal) {
      return { events: [], clarification: { reason: "reclassificacao sem topico", options: [] } };
    }
    events.push({ kind: "RECLASSIFICATION", goal_code: interpretation.goal.goal_code, facts });
    return { events, clarification: null };
  }

  events.push({
    kind,
    facts,
    ...((closeConversation || pauseConversation || resumeConversation || focusTarget)
      ? { note: closeConversation ? "CLOSE" : pauseConversation ? "PAUSE_CASE" : resumeConversation ? "RESUME_CASE" : "FOCUS_CASE" }
      : {}),
    ...(focusTarget ? { focus_case_id: focusTarget.goal_id } : {}),
    ...(p0Handoff ? { handoff_priority: "P0" as const } : {}),
    ...(closeConversation || pauseConversation ? { close_conversation: true } : {}),
  });
  return { events, clarification: null };
}

/** Pergunta a fazer quando a interpretacao nao autoriza avancar. */
export function clarificationQuestion(state: ConversationState, result: BridgeResult): string | null {
  if (!result.clarification) return null;
  if (result.clarification.options.length > 0) {
    const labels: Record<string, string> = {
      JAZIGO_FAMILIA: "o jazigo da família",
      OUTRO_CEMITERIO: "outro cemitério",
      COMPRA_DE_JAZIGO: "a compra de um jazigo",
    };
    const options = result.clarification.options.map((option) => labels[option] ?? option.toLocaleLowerCase("pt-BR"));
    return `Para eu direcionar corretamente, você se refere a ${options.join(" ou ")}?`;
  }
  if (state.pending_question) return questionForFact(state.pending_question.fact_code).text;
  const goal = focusGoal(state);
  if (
    goal && goalDef(goal.goal_code).completion_mode === "EXPLICIT_HANDOFF" && missingFacts(state, goal).length === 0
  ) {
    return "Você pode continuar explicando a situação ou enviar uma foto e outras referências do jazigo. Quando terminar, me avise e eu registro o pedido de encaminhamento à equipe.";
  }
  const missing = goal ? missingFacts(state, goal)[0] : undefined;
  return missing ? questionForFact(missing.code).text : "O que você precisa resolver hoje? Pode me contar com suas palavras.";
}
