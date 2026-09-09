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

function normalized(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPLANATION_REQUESTS = [
  "como assim",
  "nao entendi",
  "nao compreendi",
  "pode explicar",
  "me explica",
  "explique",
  "o que quer dizer",
  "quais sao as opcoes",
  "que finalidade",
];

/**
 * Explains the question already in focus without inventing a new fact or
 * abandoning the current goal. These texts clarify vocabulary only; they do
 * not make an administrative decision or promise that a request is eligible.
 */
export function contextualExplanation(state: ConversationState, userText: string): string | null {
  if (!state.pending_question) return null;
  const text = normalized(userText);
  if (!EXPLANATION_REQUESTS.some((request) => text === request || text.startsWith(request + " "))) return null;

  if (state.pending_question.fact_code === "exhumation_purpose") {
    return "Quero saber o que será feito com os restos após a exumação: transportá-los para outro local, colocá-los no ossuário, encaminhá-los para cremação ou realizar outra finalidade. Qual dessas opções corresponde ao que você precisa?";
  }

  return null;
}

/**
 * Gives a useful status when the user returns to an attendance that is already
 * waiting for a human-owned prerequisite. It never resets the case or claims
 * that the required verification has been completed.
 */
export function contextualStatus(state: ConversationState, userText: string): string | null {
  const text = normalized(userText);
  const greeting = /^(oi|ola|bom dia|boa tarde|boa noite)( tudo bem)?$/.test(text);
  const repeatsExhumation = /\b(exumacao|exumar)\b/.test(text);
  const explicitlyNewSubject = /\b(outro falecido|outra pessoa|minha mae tambem|meu pai tambem)\b/.test(text);
  const waitingExhumation = state.goals.some((goal) => goal.goal_code === "GOAL_EXUMACAO" && goal.status === "WAITING");
  const awaitingAuthorization = state.pending_actions.some((action) =>
    action.action_code === "ACTION_COLLECT_EXHUMATION_AUTHORIZATION"
  );
  if (
    !waitingExhumation || !awaitingAuthorization || explicitlyNewSubject ||
    (!greeting && !repeatsExhumation)
  ) return null;

  const prefix = greeting ? "Olá! " : "";
  return prefix +
    "Seu atendimento de exumação já está em andamento e aguarda a verificação da autorização necessária pela equipe responsável. Se quiser acrescentar uma informação ou documento a este atendimento, pode enviar por aqui. Se o pedido for para outro falecido, informe isso na mensagem.";
}

function isBereavementStatement(interpretation: Interpretation | null): boolean {
  if (!interpretation || interpretation.primary_event !== null || interpretation.goal !== null) return false;
  const text = normalized(interpretation.text_normalized);
  return /\b(faleceu|falecimento|morreu|obito)\b/.test(text);
}

export function draftReply(input: {
  outcome: ReplyOutcome;
  question_draft: string | null;
  interpretation: Interpretation | null;
  next_state: ConversationState;
}): string | null {
  if (input.outcome === "HUMAN_ACTIVE" || input.outcome === "INTERPRETATION_UNAVAILABLE") return null;

  if (isBereavementStatement(input.interpretation) && input.next_state.goals.length === 0) {
    return "Sinto muito pela sua perda. Para eu direcionar o atendimento corretamente, conte o que você precisa fazer agora — por exemplo, exumação, ossuário, concessão, recadastro ou uma situação no jazigo.";
  }

  const initialSocial = input.interpretation?.primary_event?.event_kind === "SOCIAL" &&
    input.next_state.goals.length === 0;
  if (initialSocial) {
    return "Olá! Como posso ajudar? Você pode explicar em poucas palavras o que precisa: recadastro, exumação, ossuário, concessão ou alguma situação no jazigo.";
  }
  // Keep the persisted catalog compatible with conversations already in
  // progress while presenting clearer wording at the response boundary.
  let questionDraft = input.question_draft;
  if (questionDraft && input.next_state.pending_question?.fact_code === "exhumation_purpose") {
    questionDraft =
      "A exumação será para transportar os restos para outro local, colocá-los no ossuário, encaminhá-los para cremação ou por outra finalidade?";
  } else if (questionDraft && input.next_state.pending_question?.fact_code === "surviving_spouse_status") {
    questionDraft =
      "O falecido deixou esposo(a) ou companheiro(a) vivo? Responda: sim; não, já faleceu; ou não tinha esposo(a)/companheiro(a).";
  }
  const exhumationPurpose = input.interpretation?.facts.find((fact) => fact.fact_code === "exhumation_purpose");
  if (questionDraft && exhumationPurpose?.value === "OSSUARIO") {
    return `Entendi, os restos serão colocados no ossuário. ${questionDraft}`;
  }
  const spouseStatus = input.interpretation?.facts.find((fact) => fact.fact_code === "surviving_spouse_status");
  if (questionDraft && spouseStatus) return `Entendi. ${questionDraft}`;
  if (
    spouseStatus &&
    input.next_state.pending_actions.some((action) => action.action_code === "ACTION_COLLECT_EXHUMATION_AUTHORIZATION")
  ) {
    return "Entendi. Registrei essa informação. A equipe responsável precisa verificar a autorização necessária antes da continuidade do atendimento.";
  }
  if (questionDraft) return questionDraft;

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

  return null;
}
