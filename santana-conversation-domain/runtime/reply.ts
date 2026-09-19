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

function subjectLabel(state: ConversationState, goal: GoalRecord | null): string | null {
  if (!goal) return null;
  const named = activeFact(state, "deceased_name", goal)?.value;
  if (typeof named === "string" && named.trim()) return named.trim();
  const raw = state.cases.find((item) => item.case_id === goal.case_id)?.subject_ref?.split(":")[0]?.trim();
  if (!raw || /^(?:demand|request|case|message|pai|mae|avo|avó|irmao|irmã|tio|tia)$/i.test(raw)) return null;
  return raw;
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
    return `Você quer tratar de ${next} ou continuar o atendimento de ${active}? Posso manter os dois assuntos separados; diga qual deles quer seguir agora.`;
  }
  if (mentioned && current && mentioned === current.goal_code && interpretation?.facts.length === 0) {
    return `Certo, continuamos no atendimento de ${GOAL_LABELS[current.goal_code] ?? "solicitação"}. ${question}`;
  }
  const text = normalized(userText);
  if (/^(?:nao sei|nao lembro|nao tenho|desconheco|sei la)(?: .*)?$/.test(text)) {
    if (state.pending_question.fact_code === "burial_reference") {
      return "Tudo bem. Informe apenas o que souber: o nome do falecido ou alguma referência do local, como quadra, rua, terreno ou número. Se não souber esses dados, pode me dizer isso e eu sigo pela próxima opção segura.";
    }
    return `Tudo bem. Você pode informar apenas o que souber. ${question} Se não tiver essa informação, pode me dizer isso e eu apresentarei a próxima opção segura.`;
  }
  return `Não consegui relacionar essa mensagem à informação que estávamos reunindo. ${question} Se não souber, pode me dizer isso; se o assunto for outro, diga qual é.`;
}

function documentDeclarationReply(state: ConversationState, interpretation: Interpretation): string | null {
  const fact = interpretation.facts.find((item) => item.fact_code === "document_declaration");
  if (!fact) return null;
  const subject = interpretation.facts.find((item) => item.fact_code === "document_subject_hint")?.value;
  const subjectText = typeof subject === "string" && subject.trim() ? ` sobre ${subject.trim()}` : "";
  switch (fact.value) {
    case "WILL_SEND":
      return `Certo. Registrei que você vai enviar o documento${subjectText}. Quando ele chegar, ainda precisará ser conferido; a intenção de enviar não significa recebimento ou validação.`;
    case "SENT_WRONG":
      return `Entendi que o arquivo${subjectText} enviado estava errado. Não vou tratá-lo como válido; quando puder, envie a versão correta para uma nova conferência.`;
    case "SENT":
      return `Entendi que você já enviou o documento${subjectText}. Registrei essa declaração, mas o arquivo ainda precisa estar disponível para confirmação de recebimento e conferência.`;
    case "WILL_CORRECT":
      return `Certo. Quando você enviar a versão correta${subjectText}, ela será conferida separadamente. O arquivo anterior não será tratado como validado.`;
    default:
      return null;
  }
}

function contextualDirectReply(
  state: ConversationState,
  interpretation: Interpretation | null,
  question: string | null,
): string | null {
  if (!interpretation) return null;
  const text = normalized(interpretation.text_normalized);
  const eventKind = interpretation.primary_event?.event_kind;
  if (eventKind === "RECLASSIFICATION" && interpretation.facts.some((fact) => fact.fact_code === "commercial_item")) {
    // Let transitionReply describe the applied topic change. A stale location
    // fact must not win the response boundary during reclassification.
    return null;
  }
  if (/\b(?:nao quero|não quero) abrir\s+(?:pedido|solicitacao|atendimento)\b/.test(text)) {
    return "Tudo bem. Não vou abrir uma solicitação. Se você quer apenas uma informação, diga qual é a sua dúvida e eu respondo dentro do que puder confirmar.";
  }
  const documentReply = documentDeclarationReply(state, interpretation);
  if (documentReply) return documentReply;
  const privacyActive = state.facts.some((fact) => fact.status === "ACTIVE" && fact.fact_code === "privacy_boundary");
  if (privacyActive && /\b(?:data|prazo|insisto|s[oó] me diga|s[oó] quero|s[oó] falar)\b/.test(text)) {
    const privacyJustDeclared = interpretation.facts.some((fact) => fact.fact_code === "privacy_boundary");
    if (privacyJustDeclared) {
      return "Não posso informar dados de outra pessoa ou atendimento. Posso ajudar somente com um atendimento seu.";
    }
    if (/\b(?:insisto|insistindo|vou insistir)\b/.test(text)) {
      return "Entendo que você insiste, mas não posso abrir exceção: dados de outro atendimento continuam protegidos. Posso ajudar somente com um atendimento seu.";
    }
    if (/\b(?:s[oó] me diga|data|prazo)\b/.test(text)) {
      return "Não posso informar essa data ou prazo porque pertence a outra pessoa ou atendimento. Posso orientar como consultar um atendimento seu.";
    }
    return "Entendo que você quer uma resposta objetiva, mas continuo sem poder informar dados de outra pessoa ou atendimento. Posso ajudar a consultar apenas um atendimento que seja seu.";
  }
  if (/\b(?:outra pessoa|outro atendimento|outra conversa|prazo da outra pessoa|data da outra pessoa|atendimento de outra pessoa|outra familia|outra família)\b/.test(text)) {
    return "Não posso informar dados de outro atendimento ou de outra pessoa. Posso ajudar com o seu próprio atendimento se você me passar o assunto ou a referência que possui.";
  }
  const protocolFact = interpretation.facts.some((fact) => fact.fact_code === "protocol_request") ||
    state.facts.some((fact) => fact.status === "ACTIVE" && fact.fact_code === "protocol_request");
  if (protocolFact) {
    return "Ainda não tenho um número de protocolo confirmado para informar. Se você já tem uma referência do atendimento, diga qual é; não vou inventar um número.";
  }
  if (/\b(?:duas horas|duas hora|garanta|garantir esse prazo|prazo)\b/.test(text) &&
    /\b(?:disseram|me falaram|sai|sair|confirmar|confirme|garanta|garantir)\b/.test(text)) {
    return "Eu não consigo confirmar esse prazo sem uma consulta autorizada. Posso registrar a dúvida e orientar que a equipe responsável confirme o andamento.";
  }
  if ((/\b(?:administracao|administração|aprovar|alteracao|alteração|assumo a responsabilidade)\b/.test(text) &&
    /\b(?:sem|mesmo assim|nao precisa|não precisa|responsabilidade|aprovar|alterar)\b/.test(text)) ||
    (contextGoal(state)?.goal_code === "GOAL_EXUMACAO" && /\baprovar\b/.test(text))) {
    return "Não posso aprovar ou alterar isso por conta própria. Essa decisão precisa ser verificada pela Administração; posso registrar o pedido para análise, sem prometer aprovação.";
  }
  if (/\b(?:assumo a responsabilidade|nao precisa encaminhar|não precisa encaminhar)\b/.test(text)) {
    return "Mesmo sem encaminhamento, a Administração continua necessária para essa decisão. Não posso contornar esse requisito por aqui.";
  }
  const otherCemeteryFact = state.facts.some((fact) =>
    fact.status === "ACTIVE" && fact.fact_code === "transport_destination" && fact.value === "OUTRO_CEMITERIO"
  );
  if (otherCemeteryFact || /\b(?:outro cemiterio|outro cemitério)\b/.test(text)) {
    if (/\b(?:urgente|urgencia|urgência|agora)\b/.test(text)) {
      return "Entendo que é urgente. Ainda assim, não consigo executar esse assunto por aqui nem prometer prazo; procure a administração do outro cemitério para verificar a urgência diretamente.";
    }
    if (/\b(?:conseguem fazer|fazer por mim|voc[eê]s fazem|resolver por mim)\b/.test(text)) {
      return "Não consigo executar um serviço de outro cemitério. Posso orientar sobre o Santana; para esse caso, fale com a administração responsável pelo outro local.";
    }
    return "Esse assunto é de outro cemitério, e eu não consigo executar o serviço por aqui. Posso orientar apenas sobre o Cemitério Santana; para o outro local, procure a administração responsável.";
  }
  if (/\b(?:tres|3)\s+(?:jazigos|falecidos|pessoas|casos)\b/.test(text)) {
    return "Entendi que há mais de um caso. Vamos tratar um por vez para manter as informações separadas. Qual pessoa ou jazigo você quer abordar primeiro?";
  }
  const hasGraveServiceGoal = state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS");
  if ((eventKind === "COMPLAINT" && !hasGraveServiceGoal) || /\b(?:ninguem resolve|estou esperando|aguardando retorno|sem retorno|esta demorando|isso esta demorando)\b/.test(text)) {
    return "Entendo a frustração e o tempo de espera. Para eu localizar o atendimento, qual pedido, assunto ou referência você já informou? Se preferir, posso registrar o pedido para a equipe verificar o andamento.";
  }
  if (eventKind === "CORRECTION" && /\b(?:nao e essa|nao e aquele|nao e aquela|estava errada|estava errado)\b/.test(text) &&
    !interpretation.facts.some((fact) => ["grave_reference", "concession_reference", "burial_reference"].includes(fact.fact_code))) {
    return "Certo, desconsiderei a referência anterior. Qual é a quadra, rua, terreno ou número correto?";
  }
  if (eventKind === "UNCERTAIN" && /\b(?:nao sei dizer|nao sei|nao lembro|nao tenho certeza)\b/.test(text)) {
    if (!contextGoal(state)) {
      return "Tudo bem. Posso ajudar a localizar um jazigo, acompanhar um atendimento, orientar sobre um documento ou chamar uma pessoa da equipe. Qual dessas opções se aproxima do que você precisa?";
    }
    if (question) {
      return `Tudo bem. Você pode informar apenas o que souber. ${question} Se não tiver essa informação, pode me dizer isso e eu apresentarei a próxima opção segura.`;
    }
    return "Tudo bem. Você pode me dizer ao menos se precisa localizar um jazigo, acompanhar um atendimento, enviar um documento ou falar com uma pessoa da equipe? Se preferir, também posso registrar o pedido de atendimento humano, sem afirmar que ele já foi encaminhado.";
  }
  const subject = interpretation.case_reference.subject_hint?.trim();
  const nameOnly = subject && !isGreeting(text) && /^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}$/u.test(subject) &&
    !/\b(?:jazigo|falecido|falecida|documento|pedido|assunto)\b/.test(text);
  if (nameOnly && !contextGoal(state)) {
    return `Entendi que você está falando de ${subject}. O que você precisa resolver sobre essa pessoa ou o jazigo?`;
  }
  if (interpretation.facts.some((fact) => fact.fact_code === "transport_destination" && fact.value === "JAZIGO_FAMILIA")) {
    return "Entendi que o assunto é o jazigo da família. Você quer localizá-lo, tratar de um serviço ou tirar uma dúvida?";
  }
  const locationRequested = interpretation.facts.some((fact) => fact.fact_code === "grave_location_intent") ||
    state.facts.some((fact) => fact.status === "ACTIVE" && fact.fact_code === "grave_location_intent");
  const currentGoal = contextGoal(state);
  const commercialActive = currentGoal?.goal_code === "GOAL_COMERCIAL" || state.current_topic === "COMERCIAL";
  if (locationRequested && !commercialActive) {
    const reference = state.facts.find((fact) => fact.status === "ACTIVE" && fact.fact_code === "grave_reference")?.value;
    const knownSubject = subjectLabel(state, currentGoal);
    const currentReference = interpretation.facts.find((fact) => fact.fact_code === "grave_reference")?.value;
    const repeatedReference = reference && currentReference &&
      normalized(String(reference)) === normalized(String(currentReference));
    if (reference && /\b(?:e esse mesmo|confirmo|isso mesmo|essa referencia)\b/.test(text)) {
      return `Certo, mantive a referência ${reference} para${knownSubject ? ` ${knownSubject}` : " o jazigo"}. A confirmação oficial ainda depende de consulta autorizada.`;
    }
    if (repeatedReference) {
      return `A referência ${reference} já está registrada${knownSubject ? ` para ${knownSubject}` : " no atendimento"}. Não preciso pedir o nome novamente; a confirmação oficial ainda depende de consulta autorizada.`;
    }
    if (reference) {
      return knownSubject
        ? `Certo, registrei a referência ${reference} para orientar a localização de ${knownSubject}. A localização oficial ainda depende de consulta autorizada; se tiver outra referência do local, pode informá-la.`
        : `Certo, registrei a referência ${reference} para orientar a localização do jazigo. Isso ainda não confirma a localização oficial; se tiver outro identificador, pode informá-lo.`;
    }
    if (knownSubject) return `Entendi que você quer localizar ${knownSubject}. Qual referência você tem, como quadra, setor, rua ou número?`;
    return "Entendi que você quer localizar o jazigo, não abrir um pedido de manutenção. Qual é o nome completo da pessoa sepultada ou a referência que você tem, como quadra, setor, rua ou número?";
  }
  const namedSubject = interpretation.facts.find((fact) => fact.fact_code === "deceased_name");
  if (namedSubject && eventKind !== "NEW_GOAL" && eventKind !== "RECLASSIFICATION" &&
    eventKind !== "CORRECTION" && eventKind !== "CHANGE_OF_MIND" && currentGoal && !locationRequested) {
    return `Certo, vou manter este atendimento separado para ${namedSubject.value}. ${question ?? "O que você precisa resolver agora?"}`;
  }
  if (interpretation.facts.some((fact) => fact.fact_code === "commercial_item" && fact.value === "LAPIDE") &&
    question && !/\b(?:documento|arquivo)\b/i.test(question)) {
    return "Certo, vamos falar da placa ou lápide. Você quer orientação, orçamento ou já existe um pedido?";
  }
  if (eventKind === "HUMAN_REQUEST" && !state.handoff) {
    return "Entendi que você quer falar com uma pessoa. Ainda não tenho um encaminhamento confirmado neste atendimento; posso registrar o pedido quando houver um atendimento aberto.";
  }
  if (/^(?:obrigado|obrigada|valeu|agradeco|agradeço)$/.test(text) && !contextGoal(state)) {
    return "De nada. Se precisar de outra informação, pode me dizer qual é a sua dúvida.";
  }
  if (question && interpretation.facts.length > 0 &&
    (eventKind === "CORRECTION" || /\b(?:corrigindo|correta|correto|errada|errado)\b/.test(text))) {
    return `Certo, atualizei a informação indicada. ${question}`;
  }
  return null;
}

function isBereavementStatement(interpretation: Interpretation | null): boolean {
  if (!interpretation || interpretation.primary_event !== null || interpretation.goal !== null) return false;
  const text = normalized(interpretation.text_normalized);
  return /\b(faleceu|falecimento|morreu|obito)\b/.test(text);
}

function newlyOpenedGoals(next: ConversationState, previous: ConversationState | undefined): GoalRecord[] {
  const previousIds = new Set((previous?.goals ?? []).map((goal) => goal.goal_id));
  return next.goals.filter((goal) =>
    !previousIds.has(goal.goal_id) &&
    ["ACTIVE", "SUSPENDED", "WAITING"].includes(goal.status)
  );
}

function mediaNeedsReview(interpretation: Interpretation | null): boolean {
  return interpretation?.official_mapping?.transverse_states.includes("MEDIA_NOT_ANALYZED") === true;
}

function transitionReply(
  interpretation: Interpretation | null,
  next: ConversationState,
  previous: ConversationState | undefined,
  question: string | null,
): string | null {
  const eventKind = interpretation?.primary_event?.event_kind;
  const followup = question?.replace(/^Entendi\.\s*/i, "") ?? null;
  const previousGoal = previous ? contextGoal(previous) : null;
  const nextGoal = contextGoal(next);
  const latestNote = next.event_log.at(-1)?.note ?? null;

  if (latestNote === "FOCUS_CASE" && nextGoal) {
    const hintedReference = interpretation?.case_reference.subject_hint?.trim();
    const caseReference = next.cases.find((item) => item.case_id === nextGoal.case_id)?.subject_ref?.split(":")[0]?.trim();
    const reference = hintedReference && !/^(?:meu|minha)\b/i.test(hintedReference)
      ? hintedReference
      : caseReference;
    const normalizedText = normalized(interpretation?.text_normalized ?? "");
    const kinship = /\b(?:meu pai|minha mae|meu avo|minha avo|meu irmao|minha irma|meu tio|minha tia)\b/.test(normalizedText);
    const kinshipLabel = /\bmeu pai\b/.test(normalizedText)
      ? "seu pai"
      : /\bminha mae\b/.test(normalizedText)
      ? "sua mãe"
      : /\b(?:meu avo|minha avo)\b/.test(normalizedText)
      ? "seu avô/sua avó"
      : /\b(?:meu irmao|minha irma)\b/.test(normalizedText)
      ? "seu irmão/sua irmã"
      : null;
    const citizenLabel = reference && kinship && kinshipLabel
      ? `${kinshipLabel}, ${reference}`
      : reference;
    const label = citizenLabel && !/^(?:demand|request|case|message)$/i.test(citizenLabel)
      ? citizenLabel
      : GOAL_LABELS[nextGoal.goal_code] ?? "atendimento";
    return `Certo, voltamos ao atendimento de ${label}. ${followup ?? "Podemos continuar de onde paramos; o que você precisa resolver agora?"}`;
  }

  if (nextGoal && interpretation?.case_reference.subject_hint && isConversationReturn(interpretation.text_normalized)) {
    const hinted = interpretation.case_reference.subject_hint;
    const namedFact = interpretation.facts.find((fact) => fact.fact_code === "deceased_name")?.value;
    const caseReference = next.cases.find((item) => item.case_id === nextGoal.case_id)?.subject_ref?.split(":")[0]?.trim();
    const normalizedText = normalized(interpretation.text_normalized);
    const kinshipLabel = /\bmeu pai\b/.test(normalizedText)
      ? "seu pai"
      : /\bminha mae\b/.test(normalizedText)
      ? "sua mãe"
      : /\b(?:meu avo|minha avo)\b/.test(normalizedText)
      ? "seu avô/sua avó"
      : null;
    const namedReference = typeof namedFact === "string" && namedFact.trim() ? namedFact.trim() : caseReference;
    const label = kinshipLabel && namedReference
      ? `${kinshipLabel}, ${namedReference}`
      : (!/^(?:meu|minha)\b/i.test(hinted) ? hinted : namedReference) ?? "atendimento";
    return `Certo, voltamos ao atendimento de ${label}. ${followup ?? "O que você precisa resolver agora?"}`;
  }

  if (eventKind === "RECLASSIFICATION" && previousGoal && nextGoal && previousGoal.goal_code !== nextGoal.goal_code) {
    const from = previousGoal.goal_code === "GOAL_JAZIGO_SERVICOS"
      ? "jazigo"
      : previousGoal.goal_code === "GOAL_COMERCIAL"
      ? "placa ou lápide"
      : GOAL_LABELS[previousGoal.goal_code] ?? "atendimento anterior";
    const to = GOAL_LABELS[nextGoal.goal_code] ?? "novo assunto";
    const commercialItem = next.facts.find((fact) => fact.status === "ACTIVE" && fact.fact_code === "commercial_item") ??
      interpretation?.facts.find((fact) => fact.fact_code === "commercial_item");
    const naturalTo = commercialItem?.value === "LAPIDE" ? "a placa ou lápide" : to;
    const nextQuestion = commercialItem?.value === "LAPIDE"
      ? "Você quer orientação, orçamento ou já existe um pedido?"
      : followup ?? "O que você precisa resolver sobre esse assunto?";
    if (previousGoal.goal_code === "GOAL_COMERCIAL" && nextGoal.goal_code === "GOAL_JAZIGO_SERVICOS") {
      return `Certo, voltamos ao assunto do jazigo. O assunto da placa ou lápide ficou preservado. ${nextQuestion}`;
    }
    return naturalTo === "a placa ou lápide"
      ? `Certo, vamos falar da placa ou lápide agora. O assunto anterior de ${from} ficou preservado. ${nextQuestion}`
      : `Certo, agora vamos tratar de ${naturalTo}. O atendimento de ${from} foi preservado. ${nextQuestion}`;
  }

  // CORRECTION/CHANGE_OF_MIND records facts in the current goal. A provider
  // goal or subintent is not an applied goal transition; only the reducer's
  // previous/next context may justify announcing a change of subject.
  if (eventKind === "NEW_GOAL") {
    const opened = newlyOpenedGoals(next, previous);
    const primaryCode = interpretation?.goal?.goal_code ?? nextGoal?.goal_code ?? null;
    const secondaryCodes = (interpretation?.secondary_goals ?? [])
      .map((goal) => goal.goal_code)
      .filter((code) => code !== primaryCode && opened.some((goal) => goal.goal_code === code));
    if (secondaryCodes.length > 0) {
      const primary = GOAL_LABELS[primaryCode ?? ""] ?? "assunto principal";
      const secondary = secondaryCodes.map((code) => GOAL_LABELS[code] ?? "outro assunto").join(" e ");
      return `Entendi: vamos tratar de ${primary} e também manter ${secondary} como outro assunto deste atendimento.${
        followup ? ` Primeiro, ${followup}` : ""
      }`;
    }

    if (previous && previous.cases.length > 0 && next.cases.length > previous.cases.length) {
      const label = GOAL_LABELS[nextGoal?.goal_code ?? primaryCode ?? ""] ?? "solicitação";
      const subject = interpretation?.case_reference.subject_hint;
      return `Entendi: este pedido é para ${subject ? `${subject}` : "outro falecido"}. Mantive o atendimento anterior separado e iniciei este atendimento de ${label}.${
        followup ? ` ${followup}` : ""
      }`;
    }
  }

  return null;
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

  const preDirect = contextualDirectReply(input.next_state, input.interpretation, input.question_draft);
  if (preDirect) return preDirect;

  const eventKind = input.interpretation?.primary_event?.event_kind;
  const transverseStates = input.interpretation?.official_mapping?.transverse_states ?? [];
  const initialSocial = eventKind === "SOCIAL" &&
    !contextGoal(input.next_state) && transverseStates.length === 0;
  if (initialSocial) {
    return "Olá! Como posso ajudar? Você pode explicar em poucas palavras o que precisa: recadastro, exumação, ossuário, concessão ou alguma situação no jazigo.";
  }
  const closing = eventKind === "SOCIAL" &&
    transverseStates.includes("CONVERSATION_CLOSING");
  if (closing) {
    return "Certo. Encerramos este atendimento sem criar uma nova pendência. As informações já registradas permanecem no histórico.";
  }
  if (eventKind === "SOCIAL" && transverseStates.includes("CONVERSATION_PAUSED")) {
    return "Tudo bem. Pausamos este atendimento por enquanto. Quando você voltar, continuamos daqui sem misturar este caso com outro.";
  }
  if (eventKind === "SOCIAL" && transverseStates.includes("CONVERSATION_RESUMED")) {
    const resumed = contextGoal(input.next_state);
    const resumedCase = resumed
      ? input.next_state.cases.find((item) => item.case_id === resumed.case_id)?.subject_ref?.split(":")[0]?.trim()
      : null;
    const label = resumedCase && !/^(?:demand|request|case|message)$/i.test(resumedCase)
      ? resumedCase
      : resumed ? GOAL_LABELS[resumed.goal_code] ?? "solicitação" : "solicitação";
    const followup = input.question_draft?.replace(/^Entendi\.\s*/i, "") ?? "o que você gostaria de fazer agora?";
    return `Retomamos o atendimento de ${label}. Podemos continuar de onde paramos; ${followup}`;
  }
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
  if (eventKind === "HUMAN_REQUEST" && input.next_state.handoff) {
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
  } else if (
    questionDraft &&
    input.next_state.pending_question?.fact_code === "grave_service_description" &&
    input.next_state.facts.some((fact) => fact.fact_code === "grave_reference" && fact.status === "ACTIVE")
  ) {
    // A concrete reference already supplied is evidence, not a reason to ask
    // for the same location again. Keep the next question focused on the
    // missing occurrence description.
    questionDraft = "Pode descrever o que aconteceu com o jazigo, a lápide ou a zeladoria?";
  }
  if (mediaNeedsReview(input.interpretation)) {
    return "Recebi a referência à mídia, mas o conteúdo da imagem ainda não foi analisado. Por isso não posso confirmar o que aparece nela. Você pode descrever o conteúdo ou aguardar a análise da equipe.";
  }
  const transition = transitionReply(
    input.interpretation,
    input.next_state,
    input.previous_state,
    questionDraft,
  );
  if (transition) return transition;
  const direct = contextualDirectReply(input.next_state, input.interpretation, questionDraft);
  if (direct) return direct;
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
    return `Entendi. ${questionDraft.replace(/^Entendi\.\s*/i, "")}`;
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
    return "Entendi. Registrei a ocorrência relatada sobre o jazigo no atendimento. Se puder, envie uma foto e informe a quadra e o número do jazigo. Se não souber esses dados, descreva qualquer referência que ajude a localizar o local. Quando terminar, me avise e eu registro o pedido de encaminhamento à equipe.";
  }

  const isOpenGraveTriage = input.next_state.goals.some((goal) =>
    goal.goal_code === "GOAL_JAZIGO_SERVICOS" && goal.status === "ACTIVE"
  );
  const suppliedGraveReference = input.interpretation?.facts.some((fact) => fact.fact_code === "grave_reference");
  if (isOpenGraveTriage && suppliedGraveReference) {
    return "Registrei a referência informada do jazigo no atendimento. Você pode continuar explicando a situação ou enviar uma foto. Quando terminar, me avise e eu registro o pedido de encaminhamento à equipe.";
  }
  if (isOpenGraveTriage && input.outcome === "PROPOSED") {
    return "Registrei as informações sobre o jazigo. Você pode continuar explicando o serviço que precisa ou enviar uma foto e a referência do local. Quando terminar, me avise e eu registro o pedido de encaminhamento à equipe.";
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
  if (input.interpretation?.facts.length) {
    return "Registrei essa informação no atendimento. Qual é o próximo detalhe que você precisa resolver?";
  }
  return input.interpretation
    ? "Quero entender melhor para ajudar. Qual é o assunto principal que você quer tratar?"
    : null;
}
