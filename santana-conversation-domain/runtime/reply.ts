/**
 * Safe, deterministic response drafting for the official runtime.
 *
 * This is deliberately separate from transport: a draft is only eligible for
 * the outbox after the corresponding state transition has committed.  It does
 * not claim an appointment, validation, human action or delivery.
 */
import type { ConversationState } from "../engine/engine.ts";
import type { Interpretation } from "./interpreter/types.ts";

export type ReplyOutcome = "PROPOSED" | "CLARIFICATION" | "HUMAN_ACTIVE" | "INTERPRETATION_UNAVAILABLE";

export function draftReply(input: {
  outcome: ReplyOutcome;
  question_draft: string | null;
  interpretation: Interpretation | null;
  next_state: ConversationState;
}): string | null {
  if (input.outcome === "HUMAN_ACTIVE" || input.outcome === "INTERPRETATION_UNAVAILABLE") return null;
  if (input.question_draft) return input.question_draft;

  if (input.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST") {
    return "Entendi. Registrei seu pedido de encaminhamento. A equipe responsável dará continuidade, e as informações já enviadas permanecem no atendimento.";
  }

  const isGraveComplaint = input.interpretation?.primary_event?.event_kind === "COMPLAINT" &&
    input.next_state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS") &&
    // A complete report legitimately resolves the semantic overlay in the
    // same reducer turn.  The acknowledgement must still be drafted; resolved
    // here means "enough was collected", not "a human verified the issue".
    input.next_state.goals.some((goal) => goal.goal_code === "GOAL_RECLAMACAO");

  if (isGraveComplaint) {
    return "Entendi. Registrei a ocorrência relatada sobre o jazigo no atendimento. Se puder, envie uma foto e informe a quadra e o número do jazigo. Se não souber esses dados, descreva qualquer referência que ajude a localizar o local. Quando terminar de enviar as informações, escreva FINALIZAR para encaminhar o atendimento à equipe.";
  }

  const isOpenGraveTriage = input.next_state.goals.some((goal) =>
    goal.goal_code === "GOAL_JAZIGO_SERVICOS" && goal.status === "ACTIVE"
  );
  const suppliedGraveReference = input.interpretation?.facts.some((fact) => fact.fact_code === "grave_reference");
  if (isOpenGraveTriage && suppliedGraveReference) {
    return "Registrei a referência informada do jazigo no atendimento. Você pode continuar explicando a situação ou enviar uma foto. Quando terminar de enviar as informações, escreva FINALIZAR para encaminhar o atendimento à equipe.";
  }

  const initialSocial = input.interpretation?.primary_event?.event_kind === "SOCIAL" &&
    input.next_state.goals.length === 0;
  if (initialSocial) {
    return "Olá! Como posso ajudar? Você pode explicar em poucas palavras o que precisa: recadastro, exumação, ossuário, concessão ou alguma situação no jazigo.";
  }

  return null;
}
