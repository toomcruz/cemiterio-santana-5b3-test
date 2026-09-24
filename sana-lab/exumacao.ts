import { consultar } from "../santana-authority-gateway/gateway.ts";
import goals from "../santana-conversation-domain/goals.v1.json" with { type: "json" };
import questions from "../santana-conversation-domain/questions.v1.json" with { type: "json" };
import type { CaseState, Fact, Input, Result } from "./contracts.ts";
import { MODULES } from "./modules.ts";

type Outcome = {
  action: Result["action"];
  response: string;
  sources: string[];
  authority: Result["authority"];
  operation?: Result["operation"];
  exception?: Result["exception"];
};
const fact = (value: string): Fact => ({ value, origin: "CITIZEN" });
const sourceIds: string[] = [...MODULES.EXUMACAO.sources];
sourceIds.push(
  "toomcruz/atendimento-cemiterio-santana:docs/regras-operacionais-n8n.md@3a912f4fa17df7bc5d22966e6dea418e0e9d1c6b",
);
const citizenFactKeys = new Set([
  "reference",
  "deceased_name",
  "exhumation_purpose",
  "surviving_spouse_status",
  "burial_reference",
  "requester_document",
  "destination",
  "exhumation_schedule_date_preference",
  "exhumation_schedule_time_preference",
  "exhumation_schedule_preference",
  "exhumation_schedule_request",
]);
const goal = goals.goals.find((x) => x.goal_code === "GOAL_EXUMACAO");
if (!goal || goal.required_facts[0] !== "exhumation_purpose" || goal.required_facts[1] !== "surviving_spouse_status") {
  throw Error("EXUMACAO_SOURCE_DRIFT");
}
const questionFor = (code: string) =>
  questions.questions.find((x) => x.fact_code === code)?.text ??
    (() => {
      throw Error(`EXUMACAO_QUESTION_MISSING_${code}`);
    })();
const customQuestion = (code: string): string => ({
  deceased_name: "De quem é a exumação pretendida?",
  surviving_spouse_status:
    "O falecido tinha cônjuge ou companheiro sobrevivente? Se sim, essa pessoa está viva; se não havia, pode dizer isso também.",
  burial_reference: "Qual é o local do sepultamento?",
  requester_document: "Qual o seu documento de identificação?",
  exhumation_schedule_preference:
    "Há alguma data ou horário de preferência? O pedido dependerá de confirmação da equipe.",
  exhumation_schedule_date_preference: "Qual dia ou data você gostaria de solicitar?",
  exhumation_schedule_time_preference: "Qual horário você gostaria de solicitar: 8h30, 9h ou 9h30?",
}[code] ?? questionFor(code));
const humanException = (reason: string, evidence: string): Result["exception"] => ({
  kind: "DECISAO_ADMINISTRATIVA",
  reason,
  evidence,
  next_owner: "Equipe do cemitério (simulação; nenhuma tarefa real criada)",
});

function record(state: CaseState, input: Input, key: string, value: string) {
  const previous = state.facts[key]?.value;
  if (previous === value) return;
  state.facts[key] = fact(value);
  state.history.push({
    inbound_message_id: input.inbound_message_id,
    field: key,
    previous,
    current: value,
    origin: "CITIZEN",
  });
}

function ask(state: CaseState, factCode: string, text?: string) {
  const prompt = text ?? questionFor(factCode);
  state.pending_question_fact = factCode;
  if (!state.questions.includes(prompt)) state.questions.push(prompt);
  state.phase = "WAITING_CITIZEN";
  return prompt;
}

function nextQuestion(state: CaseState): { factCode: string; text: string } | undefined {
  if (state.pending_question_fact && !state.facts[state.pending_question_fact]) {
    return { factCode: state.pending_question_fact, text: customQuestion(state.pending_question_fact) };
  }
  for (const code of goal!.required_facts) {
    if (code === "required_authorization_signatory" || code === "exhumation_authorization") continue;
    if (code === "exhumation_purpose" && !state.facts.exhumation_purpose) {
      return { factCode: code, text: questionFor(code) };
    }
    if (code === "surviving_spouse_status" && !state.facts.surviving_spouse_status) {
      return {
        factCode: code,
        text:
          "O falecido tinha cônjuge ou companheiro sobrevivente? Se sim, essa pessoa está viva; se não havia, pode dizer isso também.",
      };
    }
    if (code === "burial_reference" && !state.facts.burial_reference) {
      return state.facts.deceased_name
        ? { factCode: code, text: "Qual é o local do sepultamento?" }
        : { factCode: code, text: questionFor(code) };
    }
    if (code === "requester_document" && !state.facts.requester_document) {
      return { factCode: code, text: questionFor(code) };
    }
  }
  if (state.operation_ids.length && !state.facts.exhumation_schedule_preference) {
    return {
      factCode: "exhumation_schedule_preference",
      text: customQuestion("exhumation_schedule_preference"),
    };
  }
  return undefined;
}

function parsePurpose(message: string): string | undefined {
  if (
    /(?:colocar|guardar|destino|destinar|levar)[^.!?]{0,40}ossuario|para ossuario/.test(message) ||
    (/ossuario/.test(message) && /^(?:ossuario|no ossuario)$/.test(message))
  ) return "OSSUARIO";
  if (/(?:cremacao|cremar|cinzas)/.test(message)) return "CREMACAO";
  if (/(?:outro cemiterio|traslad|levar para outro)/.test(message)) return "TRANSPORTE";
  if (/(?:outra finalidade|outro motivo)/.test(message)) return "OUTRA";
  return undefined;
}

/** Exumation progression is driven by GOAL_EXUMACAO/questions.v1, with authoritative gaps left unresolved. */
export async function exumacao(input: Input, state: CaseState, message: string, today: string): Promise<Outcome> {
  const authority: Result["authority"] = [];
  const correction = /(?:corrig|na verdade|retific|me enganei|quis dizer)/.test(message);
  const ref = input.interpretation.reference?.trim();

  // A contextual name fills the optional deceased name only; it does not imply burial location or authority.
  if (ref && (correction || !state.facts.reference)) {
    record(state, input, "reference", ref);
    if (!state.facts.deceased_name || correction) record(state, input, "deceased_name", ref);
  }
  for (const [key, value] of Object.entries(input.case_facts ?? {})) {
    if (!citizenFactKeys.has(key) || typeof value?.value !== "string" || value.origin !== "CITIZEN") {
      throw Error("INVALID_EXUMACAO_FACT");
    }
    const allowedValues: Record<string, string[]> = {
      exhumation_purpose: ["TRANSPORTE", "OSSUARIO", "CREMACAO", "OUTRA"],
      surviving_spouse_status: ["VIVO", "FALECIDO", "INEXISTENTE", "DESCONHECIDO"],
      destination: ["OSSUARIO", "OUTRO_CEMITERIO"],
    };
    if (allowedValues[key] && !allowedValues[key].includes(value.value)) throw Error("INVALID_EXUMACAO_FACT");
    const previous = state.facts[key]?.value;
    state.facts[key] = value;
    if (previous !== value.value && value.origin === "CITIZEN") {
      state.history.push({
        inbound_message_id: input.inbound_message_id,
        field: key,
        previous,
        current: value.value,
        origin: "CITIZEN",
      });
    }
  }

  const purpose = parsePurpose(message);
  if (purpose && (!state.facts.exhumation_purpose || correction || state.facts.exhumation_purpose.value !== purpose)) {
    record(state, input, "exhumation_purpose", purpose);
  }
  const ossuaryDestination = /(?:colocar|guardar|destino|destinar|levar)[^.!?]{0,40}ossuario|para ossuario/.test(
    message,
  );
  const destination = ossuaryDestination
    ? "OSSUARIO"
    : /(?:outro cemiterio|traslad|levar para outro)/.test(message)
    ? "OUTRO_CEMITERIO"
    : undefined;
  if (destination) {
    if (!state.facts.destination || correction || state.facts.destination.value !== destination) {
      record(state, input, "destination", destination);
    }
    authority.push({
      topic: "DESTINATION",
      status: "CONFIRMED",
      reason: "Destino declarado pelo munícipe; viabilidade não confirmada",
    });
    if (destination === "OUTRO_CEMITERIO") {
      authority.push({
        topic: "TRANSLADO_REGRAS",
        status: "UNKNOWN",
        reason: "Regras e documentos de traslado externo não determinados pelas fontes disponíveis",
      });
    }
  }

  // Resolve only the active yes/no prompt; short answers never become a new case or a new fact family.
  const spouseMention = /(?:conjuge|companheir|viuv|espos[oa]|marido|mulher)/.test(message);
  const spouseAnswer = /^(?:sim|e sim|isso|correto|esta vivo|est[aá] viva)[.! ]*$/.test(message) ||
      /^(?:sim|e sim)[, ]+.*\b(?:vivo|viva)\b/.test(message)
    ? "VIVO"
    : /(?:faleceu|morreu|falecido|falecida)/.test(message)
    ? "FALECIDO"
    : /(?:nao havia|nunca teve|nao tinha)/.test(message)
    ? "INEXISTENTE"
    : /(?:nao sei|nao sabe|desconheco)/.test(message)
    ? "DESCONHECIDO"
    : undefined;
  const volunteeredSpouseAnswer = spouseAnswer ??
    (spouseMention && /\b(?:vivo|viva)\b/.test(message)
      ? "VIVO"
      : spouseMention && /\b(?:faleceu|morreu|falecido|falecida|viuvo|viuva)\b/.test(message)
      ? "FALECIDO"
      : undefined);
  const ambiguousSpouseNo = state.pending_question_fact === "surviving_spouse_status" &&
    /^(?:nao|não|e nao|e não)[.! ]*$/.test(message);
  if (volunteeredSpouseAnswer && (state.pending_question_fact === "surviving_spouse_status" || spouseMention)) {
    record(state, input, "surviving_spouse_status", volunteeredSpouseAnswer);
  }
  const spouseStatus = state.facts.surviving_spouse_status?.value;
  if (["VIVO", "FALECIDO", "INEXISTENTE"].includes(spouseStatus ?? "")) {
    const derived = spouseStatus === "VIVO" ? "CONJUGE_E_RESPONSAVEL_JAZIGO" : "RESPONSAVEL_JAZIGO";
    state.facts.required_authorization_signatory = {
      value: derived,
      origin: "SYSTEM",
      evidence: "santana-conversation-domain/relations.v1.json: REL_EXUMACAO_SIGNATORY_*",
    };
  } else if (spouseStatus === "DESCONHECIDO") {
    delete state.facts.required_authorization_signatory;
  }
  if (state.pending_question_fact === "surviving_spouse_status" && volunteeredSpouseAnswer) {
    state.pending_question_fact = undefined;
  }

  if (state.pending_question_fact === "exhumation_purpose" && purpose) state.pending_question_fact = undefined;
  if (state.pending_question_fact === "deceased_name" && ref) state.pending_question_fact = undefined;
  if (state.pending_question_fact === "burial_reference" && input.interpretation.reference && !correction) {
    record(state, input, "burial_reference", input.interpretation.reference);
    state.pending_question_fact = undefined;
  } else if (
    state.pending_question_fact === "burial_reference" && !correction && message.length > 3 &&
    !/(?:na verdade|corrig|retific)/.test(message)
  ) {
    record(state, input, "burial_reference", input.current_message.trim());
    state.pending_question_fact = undefined;
  }
  if (state.pending_question_fact === "requester_document") {
    if (input.case_facts?.requester_document) state.pending_question_fact = undefined;
    else if (input.interpretation.reference) {
      record(state, input, "requester_document", input.interpretation.reference);
      state.pending_question_fact = undefined;
    } else if (/^(?:sim|e sim|isso|correto)[.! ]*$/.test(message)) {
      const received = Object.keys(state.documents).filter((id) => state.documents[id] === "RECEIVED_UNVERIFIED").at(
        -1,
      );
      if (received) {
        record(state, input, "requester_document", `DECLARADO:${received}`);
        state.pending_question_fact = undefined;
      }
    }
  }
  if (
    ["exhumation_schedule_preference", "exhumation_schedule_date_preference", "exhumation_schedule_time_preference"]
      .includes(state.pending_question_fact ?? "") &&
    message.length > 2 &&
    !/(?:quanto|preco|valor|custa|horario de atendimento|mudar de assunto|outra coisa|aproveitando)/.test(message)
  ) {
    const time = [...message.matchAll(/\b(\d{1,2})(?:(?::|h)(\d{2})?|h)\b/g)].map((x) => `${x[1]}:${x[2] ?? "00"}`);
    const inlineHour = message.match(/\bas\s+(\d{1,2})\b/);
    if (!time.length && inlineHour) time.push(`${inlineHour[1]}:00`);
    const invalidTime = time.some((x) => !["8:30", "9:00", "9:30"].includes(x));
    const dateOrDay =
      /(?:segunda|terca|quarta|quinta|sexta|sabado|domingo|\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b|\bhoje\b|\bamanha\b)/
        .test(message);
    const noPreference = /(?:sem preferencia|qualquer dia|qualquer horario)/.test(message);
    const weekend = /(?:sabado|domingo|feriado)/.test(message);
    if (noPreference && state.pending_question_fact === "exhumation_schedule_preference") {
      record(state, input, "exhumation_schedule_preference", "SEM_PREFERENCIA");
      state.pending_question_fact = undefined;
    } else if (noPreference && state.pending_question_fact === "exhumation_schedule_time_preference") {
      record(state, input, "exhumation_schedule_time_preference", "SEM_PREFERENCIA");
      const date = state.facts.exhumation_schedule_date_preference?.value;
      if (date) record(state, input, "exhumation_schedule_preference", `${date}; sem horário preferido`);
      state.pending_question_fact = date ? undefined : "exhumation_schedule_date_preference";
      if (!date) {
        return {
          action: "ASK",
          response: ask(state, "exhumation_schedule_date_preference"),
          sources: sourceIds,
          authority: [{
            topic: "AGENDAMENTO",
            status: "CONDITIONAL",
            reason: "Data de preferência ainda não informada; confirmação depende da equipe",
          }],
        };
      }
    } else if (noPreference && state.pending_question_fact === "exhumation_schedule_date_preference") {
      return {
        action: "ASK",
        response: ask(state, "exhumation_schedule_date_preference"),
        sources: sourceIds,
        authority: [{
          topic: "AGENDAMENTO",
          status: "CONDITIONAL",
          reason: "Data pretendida precisa ser informada ou a preferência recusada explicitamente",
        }],
      };
    } else if (invalidTime || weekend) {
      record(state, input, "exhumation_schedule_request", input.current_message.trim());
      const response =
        "As exumações são realizadas de segunda a sexta-feira, às 8h30, 9h ou 9h30. Qual dessas opções você deseja solicitar? A equipe ainda precisa confirmar o agendamento.";
      if (!state.questions.includes(response)) state.questions.push(response);
      return {
        action: "ASK",
        response,
        sources: sourceIds,
        authority: [{
          topic: "AGENDAMENTO",
          status: "CONDITIONAL",
          reason: "Preferência registrada; confirmação depende da equipe",
        }],
      };
    } else {
      const date = dateOrDay ? input.current_message.trim() : state.facts.exhumation_schedule_date_preference?.value;
      const timeValue = time.length ? time[0] : state.facts.exhumation_schedule_time_preference?.value;
      if (date) record(state, input, "exhumation_schedule_date_preference", date);
      if (timeValue) record(state, input, "exhumation_schedule_time_preference", timeValue);
      if (!date) {
        state.pending_question_fact = "exhumation_schedule_date_preference";
        const response = ask(state, "exhumation_schedule_date_preference");
        return {
          action: "ASK",
          response,
          sources: sourceIds,
          authority: [{
            topic: "AGENDAMENTO",
            status: "CONDITIONAL",
            reason: "Data de preferência ainda não informada; confirmação depende da equipe",
          }],
        };
      }
      if (!timeValue) {
        state.pending_question_fact = "exhumation_schedule_time_preference";
        const response = ask(state, "exhumation_schedule_time_preference");
        return {
          action: "ASK",
          response,
          sources: sourceIds,
          authority: [{
            topic: "AGENDAMENTO",
            status: "CONDITIONAL",
            reason: "Horário de preferência ainda não informado; confirmação depende da equipe",
          }],
        };
      }
      record(state, input, "exhumation_schedule_preference", `${date}; ${timeValue}`);
      state.pending_question_fact = undefined;
    }
  }

  if (correction && ref) {
    state.pending_question_fact = undefined;
  }

  if (ambiguousSpouseNo) {
    return {
      action: "ASK",
      response: ask(
        state,
        "surviving_spouse_status",
        "Para registrar corretamente, essa pessoa faleceu ou não havia cônjuge/companheiro sobrevivente?",
      ),
      sources: sourceIds,
      authority: [{
        topic: "SURVIVING_SPOUSE",
        status: "CONDITIONAL",
        reason:
          "A resposta 'não' não distingue falecimento de inexistência; a regra de assinatura depende dessa confirmação",
      }],
    };
  }

  if (/\b(?:disputa|briga|conflito)\b|\bsem\s+autorizacao\b/.test(message)) {
    authority.push({
      topic: "AUTORIZACAO",
      status: "HUMAN_DECISION_REQUIRED",
      reason: "Conflito declarado sobre autorização exige verificação administrativa",
    });
    state.phase = "WAITING_TEAM";
    return {
      action: "EXCEPTION",
      response:
        "Entendi que há um conflito sobre a autorização. Isso precisa de análise administrativa; não confirmei autorização nem abri encaminhamento real.",
      sources: sourceIds,
      authority,
      exception: humanException("Conflito declarado de autorização", input.current_message),
    };
  }

  if (/(?:preco|valor|custa|taxa|quanto fica)/.test(message)) {
    const price = await consultar("PRECO", { servico: "EXUMACAO" }, today);
    if (price.status !== "NEEDS_CONTEXT") throw Error(`UNEXPECTED_PRICE_STATUS_${price.status}`);
    const response =
      "O valor depende da modalidade tarifária. As fontes disponíveis ainda não confirmam qual modalidade corresponde ao seu caso; não vou escolher uma tarifa pela finalidade ou pelo destino dos restos. " +
      (state.pending_question_fact
        ? `Sobre a exumação, ainda falta: ${customQuestion(state.pending_question_fact)} `
        : "") +
      "Se quiser, podemos continuar por essa informação.";
    if (!state.questions.includes(response)) state.questions.push(response);
    return {
      action: "ASK",
      response,
      sources: [...sourceIds, price.release_id, ...(price.source_id ? [price.source_id] : [])],
      authority: [
        ...authority,
        {
          topic: "PRECO",
          status: "CONDITIONAL",
          reason: "Modalidade tarifária e vigência aguardam mapeamento/confirmação humana",
        },
      ],
    };
  }

  if (input.document_references?.length || /(?:document|foto|anexo|arquivo)/.test(message)) {
    for (const refId of input.document_references ?? []) state.documents[refId] = "RECEIVED_UNVERIFIED";
    authority.push({
      topic: "DOCUMENTOS",
      status: "UNKNOWN",
      reason: "Referência recebida sem leitura ou validação; documentos aplicáveis dependem do destino e signatário",
    });
    const next = nextQuestion(state);
    state.phase = "WAITING_CITIZEN";
    const hasReceived = Object.keys(state.documents).length > 0;
    const followup = next?.factCode === "requester_document" && hasReceived
      ? "Recebi a referência do arquivo, mas não confirmei tipo ou conteúdo. Ele corresponde ao documento de identificação do solicitante?"
      : next
      ? ask(state, next.factCode, next.text)
      : "Os documentos aplicáveis e a autorização ainda dependem de conferência.";
    if (next?.factCode === "requester_document" && hasReceived) state.pending_question_fact = "requester_document";
    const response =
      "Registrei somente a referência do arquivo. Ela permanece não verificada e não comprova autorização. " + followup;
    if (!state.questions.includes(followup)) state.questions.push(followup);
    return { action: "ASK", response, sources: sourceIds, authority };
  }

  if (
    input.interpretation.objective === "ACOMPANHAMENTO" ||
    /(?:acompanhar|andamento|como esta|situacao do pedido)/.test(message)
  ) {
    authority.push({
      topic: "EXUMACAO",
      status: "UNKNOWN",
      reason: "Não há consulta a sistema administrativo oficial",
    });
    const next = nextQuestion(state);
    return {
      action: "ANSWER",
      response: state.operation_ids.length
        ? `O caso continua pendente; há ${
          state.operation_ids.length === 1 ? "um rascunho" : "registros simulados"
        } nesta simulação. Isso não confirma autorização, agendamento ou execução. ${
          next ? ask(state, next.factCode, next.text) : "A conferência administrativa ainda está pendente."
        }`
        : "Ainda não há registro neste caso. Se quiser, posso continuar com as informações necessárias para identificar a solicitação.",
      sources: sourceIds,
      authority,
    };
  }

  if (
    /(?:mudar de assunto|outra coisa|aproveitando|horario de visita|horario de atendimento)/.test(message) &&
    state.pending_question_fact
  ) {
    state.phase = "WAITING_CITIZEN";
    return {
      action: "ANSWER",
      response: `Posso retomar a exumação depois. A pergunta pendente continua sendo: ${
        customQuestion(state.pending_question_fact)
      }`,
      sources: sourceIds,
      authority,
    };
  }

  if (/(?:terminar atendimento|encerrar conversa|obrigad|finalizar)/.test(message)) {
    if (state.operation_ids.length || state.pending_question_fact || Object.keys(state.facts).length) {
      state.phase = "WAITING_CITIZEN";
      authority.push({
        topic: "CONCLUSAO",
        status: "UNKNOWN",
        reason: "Autorização, documentos e operação real ainda não foram verificados",
      });
      return {
        action: "ANSWER",
        response:
          "Posso encerrar esta conversa, mas a solicitação de exumação permanece pendente de informações e verificações. Não foi concluída nem agendada.",
        sources: sourceIds,
        authority,
      };
    }
    state.phase = "RESOLVED_GRACE";
    return {
      action: "ANSWER",
      response: "Encerrei esta orientação informativa. Nenhum serviço foi solicitado ou executado.",
      sources: sourceIds,
      authority,
    };
  }

  if (input.interpretation.objective === "INFORMACAO" && !state.pending_question_fact && !state.operation_ids.length) {
    return {
      action: "ANSWER",
      response:
        "A exumação requer agendamento prévio. Posso ajudar a identificar o caso e explicar quais pontos ainda precisam de confirmação; o pedido de data não significa que exista agendamento.",
      sources: sourceIds,
      authority: [{
        topic: "PROCEDIMENTO_ADMINISTRATIVO",
        status: "CONFIRMED",
        reason: "Agendamento prévio conforme docs/regras-operacionais-n8n.md no repositório oficial",
      }],
    };
  }

  if (input.interpretation.objective === "INICIAR_SERVICO" && !state.facts.reference && !state.facts.deceased_name) {
    return {
      action: "ASK",
      response: ask(state, "deceased_name", "De quem é a exumação pretendida?"),
      sources: sourceIds,
      authority,
    };
  }

  if (state.pending_question_fact === "surviving_spouse_status" && !state.facts.surviving_spouse_status) {
    return {
      action: "ASK",
      response: ask(
        state,
        "surviving_spouse_status",
        "O falecido tinha cônjuge ou companheiro sobrevivente? Se sim, essa pessoa está viva; se não havia, pode dizer isso também.",
      ),
      sources: sourceIds,
      authority,
    };
  }

  // Create at most one simulated draft, then keep advancing to the next unmet, citizen-answerable fact.
  let operation: Result["operation"];
  if (
    input.interpretation.objective === "INICIAR_SERVICO" && (state.facts.reference || state.facts.deceased_name) &&
    !state.operation_ids.length
  ) {
    const id = `LAB-EXU-${input.case_id}-${input.inbound_message_id}`;
    state.operation_ids.push(id);
    operation = { id, kind: "REGISTER_DRAFT_REQUEST", simulated: true, confirmed_by_readback: false };
  }
  const next = nextQuestion(state);
  if (next) {
    const response = (operation
      ? "Anotei a referência para este caso. "
      : correction
      ? "Atualizei a informação declarada neste mesmo caso. "
      : "") + ask(state, next.factCode, next.text);
    authority.push({
      topic: "EXUMATION_AUTHORIZATION",
      status: "UNKNOWN",
      reason: "Autorização requer documento/evidência autorizada e não foi confirmada por declaração",
    });
    return {
      action: operation ? "SIMULATED_OPERATION" : "ASK",
      response,
      sources: sourceIds,
      authority,
      ...(operation && { operation }),
    };
  }

  if (!state.facts.surviving_spouse_status) {
    return { action: "ASK", response: ask(state, "surviving_spouse_status"), sources: sourceIds, authority };
  }
  authority.push({
    topic: "EXUMATION_AUTHORIZATION",
    status: "HUMAN_DECISION_REQUIRED",
    reason: "As assinaturas e documentos aplicáveis exigem conferência autorizada; este LAB não valida autorização",
  });
  state.phase = "WAITING_TEAM";
  return {
    action: "EXCEPTION",
    response:
      "As informações declaradas foram preservadas. Para avançar, a autorização e os documentos aplicáveis precisam de conferência administrativa; nada foi aprovado, agendado ou executado.",
    sources: sourceIds,
    authority,
    exception: humanException(
      "Verificação administrativa de autorização/documentos obrigatórios",
      input.current_message,
    ),
  };
}
