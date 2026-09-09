import { isConversationClose, isConversationReturn, isGreeting } from "./interpreter/conversation_controls.ts";
/**
 * Safe, deterministic response drafting for the official runtime.
 *
 * This is deliberately separate from transport: a draft is only eligible for
 * the outbox after the corresponding state transition has committed.  It does
 * not claim an appointment, validation, human action or delivery.
 */
import { activeFact, contextGoal, type ConversationState, type GoalRecord } from "../engine/engine.ts";
import { questionForFact } from "../engine/catalog.ts";
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
  "por que precisa disso",
  "para que precisa disso",
];

const QUESTION_EXPLANATIONS: Record<string, string> = {
  remains_status:
    "Quero confirmar a situação atual dos restos mortais, porque o atendimento segue caminhos diferentes conforme eles ainda estejam sepultados ou já tenham sido exumados. Qual é a situação hoje?",
  transport_destination:
    "Quero saber para onde os restos mortais deverão ser levados: outro cemitério, jazigo da família, crematório ou ossuário. Qual é o destino pretendido?",
  destination_grave_reference:
    "Preciso de uma referência para a equipe localizar o jazigo de destino. Informe o que souber, como quadra, número, rua ou terreno.",
  transport_date_preference:
    "Quero apenas registrar se existe uma data de preferência para o transporte. Essa informação não confirma agendamento; a equipe ainda precisará analisar a solicitação.",
  exhumation_purpose:
    "Quero saber o que será feito com os restos após a exumação: transportá-los para outro local, colocá-los no ossuário, encaminhá-los para cremação ou realizar outra finalidade. Qual dessas opções corresponde ao que você precisa?",
  surviving_spouse_status:
    "Quero confirmar se a pessoa falecida tinha esposo(a) ou companheiro(a) e se essa pessoa está viva hoje. Essa informação é usada pela equipe para verificar as assinaturas necessárias. Você pode responder: está vivo(a); já faleceu; ou não tinha esposo(a)/companheiro(a). Se não souber, diga que não sabe.",
  burial_reference:
    "Preciso de informações que ajudem a equipe a identificar o sepultamento. Informe o nome do falecido e, se souber, a localização do jazigo ou sepultura.",
  recadastro_status:
    "Quero saber se o recadastro da concessão já foi concluído. Se você não souber, pode responder que não sabe; a confirmação oficial será feita pela equipe.",
  concession_reference:
    "Preciso de uma referência que ajude a equipe a localizar a concessão, como quadra, rua, terreno, número do jazigo ou outro identificador que você possua.",
  recadastro_holder_document:
    "Quero identificar o documento do titular relacionado ao recadastro. Você pode informar qual é o documento ou enviá-lo para análise; o envio não significa que ele já foi validado.",
  concession_purpose:
    "Quero identificar qual processo você precisa: uma concessão nova, transferência para outro responsável ou renovação. Qual dessas situações corresponde ao seu pedido?",
  commercial_item:
    "Quero identificar o item ou serviço comercial: lápide, jazigo, ossuário, cinzas ou zeladoria. Qual deles corresponde ao que você precisa?",
  commercial_stage:
    "Quero saber em que etapa o atendimento está: se você deseja um orçamento ou se já existe um pedido pago ou ainda não pago.",
  commercial_delivery_status:
    "Quero confirmar apenas se o item do pedido já foi instalado ou se a instalação ainda está pendente.",
  complaint_description:
    "Conte o que aconteceu, quando percebeu o problema e qual atendimento, pedido ou local está envolvido. A descrição será registrada para análise da equipe.",
  grave_service_description:
    "Descreva o que precisa no jazigo, na lápide ou na zeladoria. Se souber, informe também a quadra, rua, terreno ou número; você também pode enviar uma foto.",
  ossuary_information_request:
    "Diga qual é a sua dúvida sobre o ossuário, por exemplo sobre o procedimento, documentos, prazo ou valor. Só será apresentada como oficial uma informação já confirmada no sistema.",
  service_hours_request:
    "Diga de qual atendimento você quer saber o horário, como administração, visitação ou outro serviço específico.",
  other_subject_description:
    "Explique brevemente o que você precisa e, se houver, informe o nome do falecido, o jazigo, o pedido ou outro dado que ajude a equipe a localizar o assunto.",
  requester_document:
    "Quero identificar o documento da pessoa que está fazendo a solicitação. Você pode informar qual é o documento ou enviá-lo para análise; ele não será considerado validado automaticamente.",
};

/**
 * Explains the question already in focus without inventing a new fact or
 * abandoning the current goal. These texts clarify vocabulary only; they do
 * not make an administrative decision or promise that a request is eligible.
 */
export function contextualExplanation(state: ConversationState, userText: string): string | null {
  if (!state.pending_question) return null;
  const text = normalized(userText);
  if (
    !EXPLANATION_REQUESTS.some((request) =>
      text === request ||
      ["melhor", "essa pergunta", "a pergunta", "isso"].some((suffix) => text === `${request} ${suffix}`)
    )
  ) return null;

  return QUESTION_EXPLANATIONS[state.pending_question.fact_code] ?? null;
}

/**
 * Gives a useful status when the user returns to an attendance that is already
 * waiting for a human-owned prerequisite. It never resets the case or claims
 * that the required verification has been completed.
 */
export function contextualStatus(
  state: ConversationState,
  userText: string,
  interpretation: Interpretation | null = null,
): string | null {
  const text = normalized(userText);
  const greeting = isGreeting(userText);
  const returning = isConversationReturn(userText);
  const repeatsExhumation = /^(?:quero|gostaria de|preciso)(?: realizar| fazer)? (?:a )?exumacao$/.test(text);
  const asksStatus =
    /^(?:como esta|qual (?:e )?o (?:status|andamento) d[oa]) (?:meu |minha |o |a )?(?:atendimento|pedido|exumacao)$/
      .test(text);
  const goal = contextGoal(state);
  if (
    !interpretation || !goal || goal.status !== "WAITING" ||
    (!greeting && !returning && !asksStatus && !(repeatsExhumation && goal.goal_code === "GOAL_EXUMACAO")) ||
    interpretation.case_reference.kind !== "CURRENT" || interpretation.facts.length > 0 ||
    interpretation.ambiguities.some((item) => item.blocking) ||
    (interpretation.primary_event !== null && interpretation.primary_event.event_kind !== "SOCIAL" &&
      !(repeatsExhumation && interpretation.goal?.goal_code === goal.goal_code &&
        ["NEW_GOAL", "COMPLEMENT", "ANSWER"].includes(interpretation.primary_event.event_kind)))
  ) return null;
  const prefix = greeting ? `${greetingPrefix(userText)} ` : "";
  const question = state.pending_question?.goal_id === goal.goal_id
    ? ` Enquanto isso: ${questionForFact(state.pending_question.fact_code).text}`
    : "";
  if (greeting) {
    return `${prefix}Seu atendimento de ${GOAL_LABELS[goal.goal_code] ?? "solicitação"} continua ativo e aguarda ${
      waitingRequirement(state, goal)
    }.${question}`;
  }
  return prefix + waitingReply(state, goal) + question;
}

const GOAL_LABELS: Record<string, string> = {
  GOAL_TRANSPORTE: "transporte",
  GOAL_EXUMACAO: "exumação",
  GOAL_RECADASTRO: "recadastro",
  GOAL_CONCESSAO: "concessão",
  GOAL_COMERCIAL: "atendimento comercial",
  GOAL_JAZIGO_SERVICOS: "serviços no jazigo",
  GOAL_RECLAMACAO: "reclamação",
  GOAL_INFO_OSSUARIO: "informações sobre ossuário",
  GOAL_INFO_HORARIO: "informações sobre horário de atendimento",
  GOAL_OUTROS_ASSUNTOS: "outro assunto",
};

function waitingRequirement(state: ConversationState, goal: GoalRecord): string {
  const actions = state.pending_actions.filter((item) => item.goal_id === goal.goal_id);
  const unknownSpouse = activeFact(state, "surviving_spouse_status", goal)?.value === "DESCONHECIDO";
  return actions.some((item) => item.action_code === "ACTION_COLLECT_EXHUMATION_AUTHORIZATION")
    ? unknownSpouse
      ? "a conferência da informação sobre esposo(a)/companheiro(a) e da autorização necessária pela equipe responsável"
      : "a verificação da autorização necessária pela equipe responsável"
    : actions.some((item) => item.action_code === "ACTION_CHECK_DESTINATION_GRAVE")
    ? "a verificação da situação do jazigo de destino pela equipe responsável"
    : "a análise da equipe responsável";
}

function waitingReply(state: ConversationState, goal: GoalRecord): string {
  const requirement = waitingRequirement(state, goal);
  return `Seu atendimento de ${
    GOAL_LABELS[goal.goal_code] ?? "solicitação"
  } já está em andamento e aguarda ${requirement}. Você pode acrescentar informações, enviar documentos ou pedir uma correção por aqui. Se for um pedido para outra pessoa ou outro jazigo, informe isso na mensagem.`;
}

function completionReply(goal: GoalRecord): string {
  const label = GOAL_LABELS[goal.goal_code] ?? "atendimento";
  if (goal.informational || goal.goal_code.startsWith("GOAL_INFO_")) {
    return `Sua dúvida sobre ${
      label.replace(/^informações sobre /, "")
    } foi registrada. Ainda não há uma resposta oficial confirmada para essa consulta neste atendimento. Você pode pedir o encaminhamento à equipe para verificá-la.`;
  }
  if (goal.goal_code === "GOAL_RECLAMACAO") {
    return "Registrei o relato da reclamação. Isso ainda depende de análise da equipe e não confirma que a situação foi resolvida. Se terminou de enviar as informações, peça para falar com a equipe.";
  }
  if (goal.goal_code === "GOAL_OUTROS_ASSUNTOS") {
    return "Registrei a descrição do que você precisa. Se terminou de enviar as informações, peça para falar com a equipe. A solução do assunto ainda depende dessa análise.";
  }
  return `As informações desta etapa de ${label} foram registradas. Isso ainda não confirma aprovação, agendamento ou execução do serviço. Se terminou de enviar as informações, peça para falar com a equipe.`;
}

function greetingPrefix(text: string): string {
  const value = normalized(text);
  if (value.startsWith("bom dia")) return "Bom dia!";
  if (value.startsWith("boa tarde")) return "Boa tarde!";
  if (value.startsWith("boa noite")) return "Boa noite!";
  return "Olá!";
}

function pendingQuestionRepair(
  state: ConversationState,
  interpretation: Interpretation | null,
  userText: string,
  question: string,
): string | null {
  if (!state.pending_question) return null;
  const current = contextGoal(state);
  const mentioned = interpretation?.goal?.goal_code;
  if (mentioned && current && mentioned !== current.goal_code) {
    const next = GOAL_LABELS[mentioned] ?? "outro assunto";
    const active = GOAL_LABELS[current.goal_code] ?? "atendimento atual";
    return `Você quer abrir um novo atendimento de ${next} ou continuar o atendimento de ${active}? Para abrir outro sem apagar o atual, escreva: NOVO ATENDIMENTO DE ${next.toUpperCase()}.`;
  }
  if (mentioned && current && mentioned === current.goal_code && interpretation?.facts.length === 0) {
    return `Certo, continuamos no atendimento de ${GOAL_LABELS[current.goal_code] ?? "solicitação"}. ${question}`;
  }
  const text = normalized(userText);
  if (/^(?:nao sei|nao lembro|nao tenho|desconheco|sei la)(?: .*)?$/.test(text)) {
    if (state.pending_question.fact_code === "burial_reference") {
      return "Tudo bem. Informe apenas o que souber: o nome do falecido ou alguma referência do local, como quadra, rua, terreno ou número. Se não souber nenhum desses dados, escreva NÃO TENHO ESSA INFORMAÇÃO.";
    }
    return `Tudo bem. Você pode informar apenas o que souber. ${question} Se não tiver essa informação, diga isso claramente e eu apresentarei a próxima opção segura.`;
  }
  return `Não consegui relacionar essa mensagem à informação que estávamos reunindo. ${question} Se não souber, responda NÃO SEI; se quiser outro assunto, escreva NOVO ATENDIMENTO DE e o assunto.`;
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
  previous_state?: ConversationState;
}): string | null {
  if (input.outcome === "HUMAN_ACTIVE" || input.outcome === "INTERPRETATION_UNAVAILABLE") return null;

  if (isBereavementStatement(input.interpretation) && !contextGoal(input.next_state)) {
    return "Sinto muito pela sua perda. Para eu direcionar o atendimento corretamente, conte o que você precisa fazer agora — por exemplo, exumação, ossuário, concessão, recadastro ou uma situação no jazigo.";
  }

  const initialSocial = input.interpretation?.primary_event?.event_kind === "SOCIAL" &&
    !contextGoal(input.next_state);
  if (initialSocial) {
    return "Olá! Como posso ajudar? Você pode explicar em poucas palavras o que precisa: recadastro, exumação, ossuário, concessão ou alguma situação no jazigo.";
  }
  const eventKind = input.interpretation?.primary_event?.event_kind;
  if (eventKind === "SOCIAL" && input.question_draft && contextGoal(input.next_state)) {
    return `${greetingPrefix(input.interpretation?.text_normalized ?? "")} Continuamos no atendimento de ${
      GOAL_LABELS[contextGoal(input.next_state)!.goal_code] ?? "solicitação"
    }. ${input.question_draft}`;
  }
  if (input.outcome === "CLARIFICATION" && input.question_draft) {
    const repair = pendingQuestionRepair(
      input.next_state,
      input.interpretation,
      input.interpretation?.text_normalized ?? "",
      input.question_draft,
    );
    if (repair) return repair;
  }
  if (eventKind === "HUMAN_REQUEST" && input.outcome === "PROPOSED" && input.next_state.handoff) {
    if (isConversationClose(input.interpretation?.text_normalized ?? "")) {
      return "As respostas automáticas ficam pausadas por aqui. As informações e o protocolo permanecem registrados para a equipe. Isso não cancela a solicitação de serviço.";
    }
    const cancellation = /\b(cancelar|cancele|cancela|cancelamento|desistir|desisto)\b/.test(
      normalized(input.interpretation?.text_normalized ?? ""),
    );
    if (cancellation) {
      return "Registrei seu pedido de cancelamento para análise da equipe. O cancelamento do serviço ainda precisa ser confirmado pela Administração; as informações já enviadas permanecem no atendimento.";
    }
    return "Entendi. Registrei seu pedido de encaminhamento à equipe. As informações já enviadas permanecem no atendimento.";
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
    return `Entendi, você quer colocar os restos no ossuário. ${questionDraft}`;
  }
  const spouseStatus = input.interpretation?.facts.find((fact) => fact.fact_code === "surviving_spouse_status");
  if (questionDraft && spouseStatus) {
    const authorizationPending = input.next_state.pending_actions.some((action) =>
      action.action_code === "ACTION_COLLECT_EXHUMATION_AUTHORIZATION"
    );
    return authorizationPending
      ? `Entendi. A autorização ainda depende de análise da equipe. Enquanto isso, podemos reunir os dados: ${questionDraft}`
      : `Entendi. ${questionDraft}`;
  }
  if (
    spouseStatus &&
    input.next_state.pending_actions.some((action) => action.action_code === "ACTION_COLLECT_EXHUMATION_AUTHORIZATION")
  ) {
    return "Entendi. Registrei essa informação. A equipe responsável precisa verificar a autorização necessária antes da continuidade do atendimento.";
  }
  const waitingGoal = contextGoal(input.next_state);
  if (
    questionDraft && input.outcome === "PROPOSED" && input.interpretation?.facts.length &&
    (eventKind === "CORRECTION" || eventKind === "CHANGE_OF_MIND")
  ) {
    return `Registrei a correção informada. ${questionDraft}`;
  }
  if (questionDraft && input.outcome === "PROPOSED" && input.interpretation?.facts.length) {
    return `Entendi. ${questionDraft}`;
  }
  if (
    questionDraft &&
    !(input.outcome === "CLARIFICATION" && waitingGoal?.status === "WAITING" && !input.next_state.pending_question)
  ) {
    return questionDraft;
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
  if (isOpenGraveTriage && input.outcome === "PROPOSED") {
    return "Registrei as informações sobre o jazigo. Você pode continuar explicando o serviço que precisa ou enviar uma foto e a referência do local. Quando terminar, escreva FINALIZAR para pedir o encaminhamento à equipe.";
  }
  const goal = contextGoal(input.next_state);
  if (goal?.status === "WAITING") {
    const correction = eventKind === "CORRECTION" || eventKind === "CHANGE_OF_MIND";
    if (correction && input.outcome === "PROPOSED" && input.interpretation?.facts.length) {
      return `Registrei a correção informada. ${waitingReply(input.next_state, goal)}`;
    }
    if (input.outcome === "PROPOSED" && input.interpretation?.facts.length) {
      return `Registrei a informação neste atendimento. ${waitingReply(input.next_state, goal)}`;
    }
    // Unknown utterances need a useful next step without pretending that their
    // requested change or question was understood and handled.
    if (input.outcome === "CLARIFICATION") {
      return `Este atendimento de ${
        GOAL_LABELS[goal.goal_code] ?? "solicitação"
      } aguarda análise da equipe. Você quer acrescentar uma informação, corrigir algum dado, tirar uma dúvida ou falar com a equipe? Diga qual dessas ações deseja e o detalhe do pedido.`;
    }
    return waitingReply(input.next_state, goal);
  }
  const completed = [...input.next_state.goals].reverse().find((item) =>
    item.status === "RESOLVED" &&
    (!input.previous_state ||
      input.previous_state.goals.find((old) => old.goal_id === item.goal_id)?.status !== "RESOLVED")
  );
  if (completed) return completionReply(completed);
  return null;
}
