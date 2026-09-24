import type { CaseState, Fact, Input, Result } from "./contracts.ts";
import { MODULES } from "./modules.ts";
import goals from "../santana-conversation-domain/goals.v1.json" with { type: "json" };
import questions from "../santana-conversation-domain/questions.v1.json" with { type: "json" };

type Outcome = {
  action: Result["action"]; response: string; sources: string[]; authority: Result["authority"];
  operation?: Result["operation"]; exception?: Result["exception"];
};
const declared = (value: string): Fact => ({ value, origin: "CITIZEN" });
const sources = [...MODULES.RECADASTRO.sources];
const goal = goals.goals.find(x => x.goal_code === "GOAL_RECADASTRO");
if (!goal || goal.required_facts[0] !== "concession_reference" || goal.required_facts[1] !== "recadastro_holder_document" ||
  !goal.completion_required_facts?.includes("recadastro_status")) throw Error("RECADASTRO_SOURCE_DRIFT");
const promptFor = (factCode: string) => questions.questions.find(x => x.fact_code === factCode)?.text ?? (() => { throw Error("RECADASTRO_QUESTION_MISSING"); })();

/** Recadastro policy is confined to this module; bridge and n8n only transport it. */
export function recadastro(input: Input, state: CaseState, message: string): Outcome {
  const authority: Result["authority"] = [];
  const ref = input.interpretation.reference?.trim();
  const correction = /(?:corrig|na verdade|retific)/.test(message);
  if (ref && (correction || !state.facts.concession_reference)) {
    const previous = state.facts.concession_reference?.value;
    state.facts.concession_reference = declared(ref);
    if (previous !== ref) state.history.push({ inbound_message_id: input.inbound_message_id,
      field: "concession_reference", previous, current: ref, origin: "CITIZEN" });
    authority.push({ topic: "CONCESSION_REFERENCE", status: "CONFIRMED", reason: "Referência declarada, sem comprovação cadastral" });
  }
  for (const [key, value] of Object.entries(input.case_facts ?? {})) {
    if (!["concession_reference", "update_purpose"].includes(key) || value.origin !== "CITIZEN" || !value.value.trim()) throw Error("INVALID_RECADASTRO_FACT");
    const previous = state.facts[key]?.value;
    state.facts[key] = value;
    if (previous !== value.value) state.history.push({ inbound_message_id: input.inbound_message_id,
      field: key, previous, current: value.value, origin: "CITIZEN" });
  }
  if (/\b(?:transferencia|transferir|mudar titular|passar para outro titular)\b/.test(message)) {
    authority.push({ topic: "TITULARIDADE", status: "UNKNOWN", reason: "Transferência de direitos pertence a outra demanda; não foi autorizada neste LAB" });
    state.phase = "WAITING_CITIZEN";
    return { action: "ASK", response: "Transferir titularidade é uma demanda diferente de atualizar cadastro. Você quer atualizar seus dados cadastrais ou tratar de transferência da concessão? Não fiz nenhuma transferência.", sources, authority };
  }
  if (/\b(?:disputa|litigio|conflito de titularidade|sem autorizacao)\b/.test(message)) {
    authority.push({ topic: "TITULARIDADE", status: "HUMAN_DECISION_REQUIRED", reason: "Conflito declarado requer decisão administrativa sobre direitos" });
    state.phase = "WAITING_TEAM";
    return { action: "EXCEPTION", response: "Registrei o conflito nesta simulação. A titularidade exige análise específica; o cadastro não foi alterado.", sources, authority,
      exception: { kind: "DECISAO_ADMINISTRATIVA", reason: "Conflito declarado sobre titularidade", evidence: input.current_message,
        next_owner: "Equipe do cemitério (simulação; nenhuma tarefa real criada)" } };
  }
  if (/\bregulariz\w*\b.{0,60}\b(?:jazigo|sepultura)\b/.test(message)) {
    authority.push({ topic: "INTENCAO_REGULARIZACAO", status: "UNKNOWN", reason: "Regularizar jazigo pode envolver cadastro, concessão ou outra pendência; a intenção ainda não foi esclarecida" });
    state.phase = "WAITING_CITIZEN";
    return { action: "ASK", response: "Você quer atualizar dados cadastrais, tratar da concessão ou de outra regularização do jazigo?", sources, authority };
  }
  if (correction) {
    state.phase = "WAITING_CITIZEN";
    return { action: "ASK", response: ref ? `Corrigi a referência declarada neste caso. ${promptFor("recadastro_holder_document")} No LAB use apenas uma referência sintética, que ainda dependerá de conferência.` : "Qual dado declarado devo corrigir? Informe apenas a referência ou o tipo de atualização, sem enviar números pessoais aqui.", sources, authority };
  }
  if (input.document_references?.length || /\b(?:documento|arquivo|anexo|foto)\b/.test(message)) {
    for (const document of input.document_references ?? []) state.documents[document] = "RECEIVED_UNVERIFIED";
    authority.push({ topic: "DOCUMENTOS", status: "UNKNOWN", reason: "Referência recebida sem conferência; lista documental aplicável não homologada para este LAB" });
    state.phase = "WAITING_CITIZEN";
    return { action: "ASK", response: "Registrei somente a referência do arquivo nesta simulação, sem conferir o conteúdo. Ainda não há validação nem aprovação cadastral. Enquanto aguarda conferência, qual dado você precisa atualizar?", sources, authority };
  }
  if (input.interpretation.objective === "ACOMPANHAMENTO" || /(?:acompanhar|andamento|como esta|situacao do pedido)/.test(message)) {
    const draft = state.operation_ids.at(-1);
    authority.push({ topic: "CADASTRO", status: "UNKNOWN", reason: "Nenhum sistema cadastral oficial foi consultado" });
    return { action: draft ? "ANSWER" : "ASK", response: draft
      ? `O rascunho LAB ${draft} existe neste caso. A atualização oficial e a verificação ainda estão pendentes; não há aprovação confirmada.`
      : "Não há rascunho neste caso LAB. Você tem uma referência da solicitação ou quer iniciar uma atualização cadastral?", sources, authority };
  }
  if (/(?:encerrar|finalizar|concluir|obrigad)/.test(message)) {
    if (state.operation_ids.length) {
      state.phase = "WAITING_CITIZEN";
      authority.push({ topic: "CONCLUSAO", status: "UNKNOWN", reason: "Rascunho não equivale a atualização cadastral concluída" });
      return { action: "ANSWER", response: "Posso encerrar a conversa, mas o rascunho LAB continua pendente. Não há confirmação de recadastro concluído.", sources, authority };
    }
    state.phase = "RESOLVED_GRACE";
    return { action: "ANSWER", response: "Concluí a orientação informativa nesta simulação. Nenhum cadastro oficial foi alterado.", sources, authority };
  }
  if (input.interpretation.objective === "INFORMACAO" && !state.operation_ids.length) {
    state.phase = "RESOLVED_GRACE";
    authority.push({ topic: "CADASTRO", status: "CONDITIONAL", reason: "Fontes de domínio orientam a coleta, mas não homologam documentos e prazos" });
    return { action: "ANSWER", response: "Posso orientar uma atualização cadastral. A referência da concessão e a documentação pertinente ajudam a identificar o caso; os requisitos exatos e a aprovação precisam de confirmação oficial. Quer iniciar um rascunho LAB?", sources, authority };
  }
  if (input.interpretation.objective === "INICIAR_SERVICO" && !state.operation_ids.length) {
    const id = `LAB-REC-${input.case_id}-${input.inbound_message_id}`;
    state.operation_ids.push(id);
    state.phase = "WAITING_CITIZEN";
    authority.push({ topic: "CADASTRO", status: "UNKNOWN", reason: "Somente rascunho LAB criado; cadastro oficial não consultado nem alterado" });
    return { action: "SIMULATED_OPERATION", response: `Criei o rascunho simulado ${id}, sem atualizar o cadastro oficial. ${state.facts.concession_reference ? promptFor("recadastro_holder_document") + " Use apenas referência sintética no LAB; falta conferência." : promptFor("concession_reference")}`, sources, authority,
      operation: { id, kind: "REGISTER_RECADASTRO_DRAFT", simulated: true, confirmed_by_readback: false } };
  }
  if (!state.facts.concession_reference) {
    state.phase = "WAITING_CITIZEN";
    return { action: "ASK", response: `${promptFor("concession_reference")} Sua resposta será informação declarada, ainda não conferida.`, sources, authority };
  }
  if (!state.facts.update_purpose) {
    state.phase = "WAITING_CITIZEN";
    if (!Object.keys(state.documents).length) return { action: "ASK", response: `${promptFor("recadastro_holder_document")} No LAB, use apenas uma referência sintética de arquivo. O recebimento ainda dependerá de conferência.`, sources, authority };
    return { action: "ASK", response: "Qual dado cadastral você precisa atualizar?", sources, authority };
  }
  state.phase = "WAITING_CITIZEN";
  return { action: "ASK", response: "Registrei suas informações declaradas neste caso LAB. Há algum documento a informar ou deseja acompanhar o rascunho? Nenhuma atualização oficial foi confirmada.", sources, authority };
}
