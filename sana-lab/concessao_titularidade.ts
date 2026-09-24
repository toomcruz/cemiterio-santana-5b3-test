import type { CaseState, Fact, Input, Result } from "./contracts.ts";
import { MODULES } from "./modules.ts";
import goals from "../santana-conversation-domain/goals.v1.json" with { type: "json" };
import facts from "../santana-conversation-domain/facts.v1.json" with { type: "json" };
import questions from "../santana-conversation-domain/questions.v1.json" with { type: "json" };
import relations from "../santana-conversation-domain/relations.v1.json" with { type: "json" };

type Outcome = {
  action: Result["action"]; response: string; sources: string[]; authority: Result["authority"];
  operation?: Result["operation"]; exception?: Result["exception"];
};
type Modality = "NOVA" | "TRANSFERENCIA" | "RENOVACAO";
const sourceIds: string[] = [...MODULES.CONCESSAO_TITULARIDADE.sources];
const goal = goals.goals.find(x => x.goal_code === "GOAL_CONCESSAO");
const modalityFact = facts.facts.find(x => x.fact_code === "concession_purpose");
const allowedModalities = modalityFact?.allowed_values ?? [];
const recadastroFact = facts.facts.find(x => x.fact_code === "recadastro_status");
function assertSources(): void {
  if (!goal || goal.topic_code !== "CONCESSAO" ||
    !["concession_purpose", "recadastro_status", "concession_reference", "requester_document"]
      .every(x => goal.required_facts.includes(x)) ||
    JSON.stringify(allowedModalities) !== JSON.stringify(["NOVA", "TRANSFERENCIA", "RENOVACAO"]) ||
    !recadastroFact || !recadastroFact.authoritative_values?.includes("OK") ||
    !relations.relations.some(x => x.relation_code === "REL_CONCESSAO_REQUIRES_RECADASTRO" && x.to_goal === "GOAL_RECADASTRO")) {
    throw Error("CONCESSAO_DOMAIN_SOURCE_DRIFT");
  }
}
const question = (code: string): string => questions.questions.find(x => x.fact_code === code)?.text ??
  (() => { throw Error("CONCESSAO_QUESTION_MISSING"); })();
const declared = (value: string): Fact => ({ value, origin: "CITIZEN" });
const isModality = (value: string): value is Modality => allowedModalities.includes(value as Modality);
const inferModality = (message: string): Modality | undefined =>
  /\b(?:transferir|transferencia|titularidade|mudar titular|passar para outro titular)\b/.test(message) ? "TRANSFERENCIA" :
  /\brenov\w*\b/.test(message) ? "RENOVACAO" :
  /\b(?:nova concessao|concessao nova|solicitar uma concessao nova)\b/.test(message) ? "NOVA" : undefined;

function record(state: CaseState, input: Input, field: string, value: string) {
  const previous = state.facts[field]?.value;
  if (previous === value) return;
  state.facts[field] = declared(value);
  state.history.push({ inbound_message_id: input.inbound_message_id, field, previous, current: value, origin: "CITIZEN" });
}
function nextQuestion(state: CaseState): string {
  if (!state.facts.concession_purpose && !state.facts.concession_other_declared) {
    return `${question("concession_purpose")} Se for outra situação, descreva brevemente.`;
  }
  if (state.facts.concession_other_declared && !state.facts.concession_other_description) {
    return "Qual é a outra situação que você deseja tratar sobre a concessão?";
  }
  if (["TRANSFERENCIA", "RENOVACAO"].includes(state.facts.concession_purpose?.value ?? "") && !state.facts.concession_reference) {
    return `${question("concession_reference")} Informe apenas uma referência sintética neste LAB.`;
  }
  if (!Object.keys(state.documents).length) {
    return "Se já tiver um arquivo referente ao pedido, informe apenas uma referência sintética; recebê-la não valida documento nem direito.";
  }
  return "As informações deste rascunho permanecem pendentes de conferência. Quer acompanhar o pedido ou corrigir algum dado declarado?";
}

/** Rules live here; bridge and n8n only validate/transport the common contract. */
export function concessaoTitularidade(input: Input, state: CaseState, message: string): Outcome {
  assertSources();
  const authority: Result["authority"] = [];
  const correction = /(?:corrig|na verdade|retific)/.test(message);
  const ambiguous = /\bregulariz\w*\b.{0,60}\b(?:jazigo|sepultura)\b/.test(message);
  const conflict = /\b(?:disputa|litigio|conflito de titularidade|dois titulares|duas pessoas se dizem titular|sem autorizacao)\b/.test(message);

  if (conflict) {
    state.phase = "WAITING_TEAM";
    authority.push({ topic: "TITULARIDADE", status: "HUMAN_DECISION_REQUIRED", reason: "Disputa ou ausência de autorização declarada: decisão sobre direitos reservada à Administração" });
    return { action: "EXCEPTION", response: "Registrei o conflito declarado neste LAB. A disputa de titularidade exige análise administrativa; não transferi nem aprovei direito algum.", sources: sourceIds, authority,
      exception: { kind: "DECISAO_ADMINISTRATIVA", reason: "Conflito declarado sobre direitos de concessão", evidence: input.current_message,
        next_owner: "Equipe do cemitério (simulação; nenhuma tarefa real criada)" } };
  }
  if (ambiguous) {
    state.phase = "WAITING_CITIZEN";
    authority.push({ topic: "INTENCAO_REGULARIZACAO", status: "UNKNOWN", reason: "Regularização pode ser Recadastro, Concessão/Titularidade ou outra situação" });
    return { action: "ASK", response: "Você quer atualizar dados cadastrais, tratar da concessão/titularidade ou de outra regularização do jazigo?", sources: sourceIds, authority };
  }

  const supplied = input.case_facts ?? {};
  for (const [key, value] of Object.entries(supplied)) {
    if (!["concession_reference", "concession_purpose", "concession_other_description"].includes(key) ||
      value.origin !== "CITIZEN" || !value.value.trim() ||
      (key === "concession_purpose" && !isModality(value.value))) throw Error("INVALID_CONCESSAO_FACT");
  }
  const explicitReference = supplied.concession_reference?.value.trim() || input.interpretation.reference?.trim();
  const previousReference = state.facts.concession_reference?.value;
  if (explicitReference && previousReference && previousReference !== explicitReference && !correction) {
    state.phase = "WAITING_CITIZEN";
    authority.push({ topic: "CONCESSION_REFERENCE", status: "UNKNOWN", reason: "Referência divergente sem correção explícita; não sobrescrever a concessão atual" });
    return { action: "ASK", response: "Você está corrigindo a referência desta concessão ou falando de outro jazigo? Mantive a referência anterior até esclarecer.", sources: sourceIds, authority };
  }
  if (explicitReference) {
    record(state, input, "concession_reference", explicitReference);
    authority.push({ topic: "CONCESSION_REFERENCE", status: "CONFIRMED", reason: "Referência declarada pelo munícipe; titularidade e cadastro não verificados" });
  }

  const modality = supplied.concession_purpose?.value as Modality | undefined ?? inferModality(message);
  if (modality) {
    const previous = state.facts.concession_purpose?.value;
    if (previous && previous !== modality && !correction) {
      state.phase = "WAITING_CITIZEN";
      authority.push({ topic: "CONCESSION_PURPOSE", status: "UNKNOWN", reason: "Modalidade diferente da registrada sem pedido claro de correção" });
      return { action: "ASK", response: "Você está corrigindo a modalidade deste pedido ou iniciando outro caso? Mantive a modalidade anterior.", sources: sourceIds, authority };
    }
    record(state, input, "concession_purpose", modality);
    authority.push({ topic: "CONCESSION_PURPOSE", status: "CONFIRMED", reason: "Modalidade declarada, sem decisão sobre concessão" });
  }
  if (supplied.concession_other_description) record(state, input, "concession_other_description", supplied.concession_other_description.value.trim());
  if (/\b(?:outra situacao|outra modalidade|outro assunto de concessao)\b/.test(message) && !modality) {
    record(state, input, "concession_other_declared", "SIM");
    authority.push({ topic: "OUTRA_MODALIDADE", status: "UNKNOWN", reason: "Outra situação é relato livre; não consta das três modalidades do catálogo v1" });
  }
  for (const document of input.document_references ?? []) state.documents[document] = "RECEIVED_UNVERIFIED";
  if ((input.document_references?.length ?? 0) || /\b(?:documento|arquivo|anexo|foto)\b/.test(message)) {
    state.phase = "WAITING_CITIZEN";
    authority.push({ topic: "DOCUMENTOS", status: "UNKNOWN", reason: "Referência recebida sem conferência; não comprova legitimidade nem direito" });
    return { action: "ASK", response: `Registrei só a referência do arquivo no LAB, sem validar o conteúdo. ${nextQuestion(state)} A decisão administrativa permanece pendente.`, sources: sourceIds, authority };
  }
  if (input.interpretation.objective === "ACOMPANHAMENTO" || /(?:acompanhar|andamento|como esta|situacao do pedido|retomar pedido)/.test(message)) {
    const draft = state.operation_ids.at(-1);
    authority.push({ topic: "CONCESSAO", status: "UNKNOWN", reason: "Nenhum registro oficial de concessão ou decisão foi consultado" });
    return { action: draft ? "ANSWER" : "ASK", response: draft
      ? `O rascunho LAB ${draft} permanece pendente. Modalidade e referência são declarações; documentos, Recadastro e decisão sobre direitos não foram confirmados.`
      : "Não há rascunho LAB deste caso. Você quer iniciar um pedido ou informar sua referência?", sources: sourceIds, authority };
  }
  if (/(?:encerrar|finalizar|concluir|obrigad)/.test(message)) {
    if (state.operation_ids.length || state.facts.concession_request_intent || state.phase === "WAITING_TEAM") {
      if (state.phase !== "WAITING_TEAM") state.phase = "WAITING_CITIZEN";
      authority.push({ topic: "DECISAO", status: "UNKNOWN", reason: "Rascunho e dados declarados não significam deferimento nem encerramento do pedido" });
      return { action: "ANSWER", response: "Posso encerrar a conversa, mas a solicitação LAB ainda está pendente de conferência e decisão. Nenhuma concessão foi aprovada, transferida ou renovada.", sources: sourceIds, authority };
    }
    state.phase = "RESOLVED_GRACE";
    return { action: "ANSWER", response: "Encerrei a orientação informativa. Nenhuma solicitação ou concessão oficial foi alterada.", sources: sourceIds, authority };
  }
  if (input.interpretation.objective === "INFORMACAO" && !state.operation_ids.length && !state.facts.concession_request_intent) {
    state.phase = "RESOLVED_GRACE";
    authority.push({ topic: "CONCESSAO", status: "CONDITIONAL", reason: "Catálogo de domínio v1 define modalidades, mas não homologa direitos, documentação ou procedimento vigente" });
    return { action: "ANSWER", response: "Posso orientar pedidos de concessão nova, transferência e renovação. A modalidade e a referência ajudam a identificar o caso; documentação aplicável, legitimidade e decisão precisam de fonte e conferência autorizadas. Quer iniciar um rascunho LAB?", sources: sourceIds, authority };
  }
  if (input.interpretation.objective === "INICIAR_SERVICO") record(state, input, "concession_request_intent", "SIM");
  if (state.facts.concession_request_intent && (state.facts.concession_purpose || state.facts.concession_other_description) && !state.operation_ids.length) {
    const id = `LAB-CON-${input.case_id}-${input.inbound_message_id}`;
    state.operation_ids.push(id);
    state.phase = "WAITING_CITIZEN";
    authority.push({ topic: "DECISAO", status: "UNKNOWN", reason: "Somente rascunho LAB; não há aprovação, transferência, renovação ou alteração cadastral" });
    authority.push({ topic: "RECADASTRO", status: "CONDITIONAL", reason: "Dependência descrita no domínio, porém status não verificado; não abrir Recadastro automaticamente" });
    return { action: "SIMULATED_OPERATION", response: `Criei apenas o rascunho simulado ${id}. ${nextQuestion(state)} Nenhum direito foi concedido, transferido ou renovado.`, sources: sourceIds, authority,
      operation: { id, kind: "REGISTER_CONCESSAO_DRAFT", simulated: true, confirmed_by_readback: false } };
  }
  state.phase = "WAITING_CITIZEN";
  authority.push({ topic: "RECADASTRO", status: "UNKNOWN", reason: "Status autoritativo não foi consultado; declaração de Recadastro não equivale a OK" });
  return { action: "ASK", response: correction ? `Registrei a correção declarada neste mesmo caso. ${nextQuestion(state)}` : nextQuestion(state), sources: sourceIds, authority };
}
