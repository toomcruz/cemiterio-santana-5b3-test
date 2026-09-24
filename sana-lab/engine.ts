import { consultar } from "../santana-authority-gateway/gateway.ts";
import { SCHEMA_VERSION, validateInput, type CaseState, type Fact, type Input, type Result } from "./contracts.ts";
import { recadastro } from "./recadastro.ts";

export interface Store { read(id: string): CaseState | undefined; commit(next: CaseState, expectedRevision: number): void }
export class MemoryStore implements Store {
  private cases = new Map<string, CaseState>();
  read(id: string) { const x = this.cases.get(id); return x && structuredClone(x); }
  commit(next: CaseState, expectedRevision: number) {
    if ((this.cases.get(next.case_id)?.revision ?? 0) !== expectedRevision) throw Error("REVISION_CONFLICT");
    this.cases.set(next.case_id, structuredClone(next));
  }
}
export function emptyState(input: Input): CaseState {
  return { schema_version: SCHEMA_VERSION, case_id: input.case_id, conversation_id: input.conversation_id,
    revision: 0, family: "INDEFINIDO", phase: "ACTIVE", facts: {}, documents: {}, demand_queue: [], questions: [],
    processed_ids: [], history: [], last_response: "", last_step: "NEW", operation_ids: [] };
}
const normalize = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function fact(v: string): Fact { return { value: v, origin: "CITIZEN" }; }
function exception(kind: "PEDIDO_HUMANO" | "DECISAO_ADMINISTRATIVA" | "FALHA_TECNICA", reason: string, evidence: string) {
  return { kind, reason, evidence, next_owner: "Equipe do cemitério (simulação; nenhuma tarefa real criada)" };
}

/** Interpreter is supplied as input. This layer decides actions and never calls Gemini or a transport. */
export async function handle(input: Input, store: Store, today = "2026-09-24"): Promise<Result> {
  validateInput(input);
  const current = store.read(input.case_id) ?? emptyState(input);
  if (current.conversation_id !== input.conversation_id) throw Error("CASE_MISMATCH");
  if (input.current_state && input.current_state.revision !== current.revision) throw Error("STALE_STATE");
  const base = { schema_version: SCHEMA_VERSION, case_id: input.case_id, correlation_id: input.correlation_id };
  if (current.processed_ids.includes(input.inbound_message_id)) return { ...base, action: "DUPLICATE", response: "", next_state: current, sources: [], authority: [] };
  const s: CaseState = structuredClone(current);
  for (const linkedId of input.linked_case_ids ?? []) {
    const linked = store.read(linkedId);
    if (!linked) throw Error("LINK_CASE_NOT_FOUND");
    if (linked.conversation_id !== input.conversation_id) throw Error("LINK_CASE_CONVERSATION_MISMATCH");
    s.linked_case_ids ??= [];
    if (!s.linked_case_ids.includes(linkedId)) s.linked_case_ids.push(linkedId);
  }
  const message = normalize(input.current_message);
  let action: Result["action"] = "ANSWER";
  let response = "";
  let sources: string[] = [];
  const authority: Result["authority"] = [];
  let operation: Result["operation"];
  let human: Result["exception"];
  const family = input.interpretation.family === "INDEFINIDO" ? s.family : input.interpretation.family;
  if (input.interpretation.explicit_human || /(?:quero|preciso|prefiro|falar com|chame).{0,30}(?:atendente|pessoa|humano)/.test(message)) {
    action = "EXCEPTION";
    human = exception("PEDIDO_HUMANO", "Pedido explícito de atendente", input.current_message);
    response = "Você pediu atendimento humano. O pedido ficou registrado nesta simulação; nenhum encaminhamento real foi feito.";
    s.phase = "WAITING_TEAM";
  } else if (s.family !== "INDEFINIDO" && family !== s.family) {
    throw Error("FAMILY_CONFLICT");
  } else if (family === "RECADASTRO") {
    s.family = "RECADASTRO";
    const result = recadastro(input, s, message);
    action = result.action; response = result.response; sources = result.sources;
    authority.push(...result.authority); operation = result.operation; human = result.exception;
  } else if (family !== "EXUMACAO") {
    action = "UNSUPPORTED";
    response = "Preciso esclarecer qual serviço você procura.";
  } else {
    s.family = "EXUMACAO";
    for (const [k, v] of Object.entries(input.case_facts ?? {})) {
      if (typeof v?.value !== "string" || !["CITIZEN", "SYSTEM"].includes(v.origin)) throw Error("INVALID_FACT");
      if (v.origin === "SYSTEM" && !v.evidence) throw Error("SYSTEM_FACT_REQUIRES_EVIDENCE");
      s.facts[k] = v;
    }
    if (input.interpretation.reference && !s.facts.reference) s.facts.reference = fact(input.interpretation.reference);
    // Destino é fato declarado deste caso, nunca nova demanda OSSUARIO/TRANSLADO.
    const destination = /\bossuario\b/.test(message) ? "OSSUARIO" :
      /(?:outro cemiterio|traslad|levar para outro)/.test(message) ? "OUTRO_CEMITERIO" : "";
    if (destination) {
      const previous = s.facts.destination?.value;
      s.facts.destination = fact(destination);
      if (previous !== destination) s.history.push({ inbound_message_id: input.inbound_message_id, field: "destination", previous, current: destination, origin: "CITIZEN" });
      authority.push({ topic: "DESTINATION", status: "CONFIRMED", reason: "Declaração do munícipe, sem confirmação operacional" });
    }
    if (/(?:corrig|na verdade|retific)/.test(message)) {
      if (input.interpretation.reference) s.facts.reference = fact(input.interpretation.reference);
      action = "ASK"; response = destination === "OUTRO_CEMITERIO"
        ? "Atualizei o destino declarado para outro cemitério neste mesmo caso. Isso pode exigir regras de traslado ainda não verificadas. Qual é o cemitério de destino?"
        : "Atualizei a referência declarada nesta simulação. Qual informação da exumação você quer corrigir ou completar?";
      if (destination === "OUTRO_CEMITERIO") authority.push({ topic: "TRANSLADO_REGRAS", status: "UNKNOWN", reason: "Condições e documentos de destino externo não validados neste LAB" });
    } else if (/\b(?:disputa|briga|conflito|sem autorizacao)\b/.test(message)) {
      action = "EXCEPTION"; human = exception("DECISAO_ADMINISTRATIVA", "Conflito de autorização exige verificação", input.current_message);
      authority.push({ topic: "AUTORIZACAO", status: "HUMAN_DECISION_REQUIRED", reason: "Conflito declarado entre responsáveis" });
      response = "Registrei a situação para análise nesta simulação. Não posso confirmar autorização para a exumação."; s.phase = "WAITING_TEAM";
    } else if (/(?:preco|valor|custa|taxa|quanto fica)/.test(message)) {
      const price = await consultar("PRECO", { servico: "EXUMACAO" }, today);
      sources = [price.release_id, ...(price.source_id ? [price.source_id] : [])];
      if (price.status !== "NEEDS_CONTEXT") throw Error(`UNEXPECTED_PRICE_STATUS_${price.status}`);
      action = "ASK"; response = "O valor depende da modalidade da exumação. Você sabe se a sepultura é em terreno a prazo indeterminado, gaveta unitária a prazo fixo ou se a exumação será feita em ossuário? Não vou escolher uma tarifa pelo destino dos restos.";
      authority.push({ topic: "PRECO", status: "CONDITIONAL", reason: "Modalidade tarifária não confirmada; destino não a determina" });
      s.phase = "WAITING_CITIZEN";
    } else if (/(?:document|foto|anexo)/.test(message) || (input.document_references?.length ?? 0) > 0) {
      for (const ref of input.document_references ?? []) s.documents[ref] = "RECEIVED_UNVERIFIED";
      const docs = await consultar("DOCUMENTOS", {}, today);
      sources = [docs.release_id, ...(docs.source_id ? [docs.source_id] : [])];
      action = "ASK"; response = "Registrei as referências dos arquivos nesta simulação, sem conferir o conteúdo. A lista de documentos depende do destino e de quem assina. " +
        (!s.facts.destination ? "Qual é o destino pretendido dos restos?" :
          !s.facts.signatory ? "Quem será o responsável pela assinatura da autorização?" :
          "A conferência dos documentos e da autorização ainda está pendente. Você quer acompanhar o rascunho?");
      authority.push({ topic: "DOCUMENTOS", status: "UNKNOWN", reason: "Referências recebidas sem verificação; lista aplicável não determinada" });
      s.phase = "WAITING_CITIZEN";
    } else if (input.interpretation.objective === "ACOMPANHAMENTO") {
      response = s.operation_ids.length ? `Há um registro simulado ${s.operation_ids.at(-1)} neste caso. Isso não indica aprovação nem agendamento.` : "Não encontrei operação simulada neste caso. Você tem alguma referência para identificar a solicitação?";
      action = s.operation_ids.length ? "ANSWER" : "ASK";
    } else if (/(?:terminar atendimento|encerrar conversa|obrigad)/.test(message)) {
      if (s.operation_ids.length) {
        response = "Posso encerrar a conversa, mas o rascunho simulado permanece pendente. Documentos, autorização e operação real ainda não foram confirmados.";
        s.phase = "WAITING_CITIZEN";
      } else {
        response = "Concluí esta conversa informativa na simulação. Nenhum serviço físico ou pedido administrativo foi confirmado.";
        s.phase = "RESOLVED_GRACE";
      }
    } else if (destination && s.operation_ids.length) {
      response = `Registrei ${destination === "OSSUARIO" ? "ossuário" : "outro cemitério"} como destino declarado no mesmo caso de exumação. A viabilidade e as condições ainda precisam de fonte aplicável; não abri outra demanda.`;
      action = "ANSWER";
      authority.push({ topic: "VIABILIDADE_DESTINO", status: "UNKNOWN", reason: "Destino informado não comprova disponibilidade ou autorização" });
    } else if (input.interpretation.objective === "INFORMACAO") {
      response = "A exumação requer agendamento prévio. Posso orientar a próxima etapa conforme o caso; o pedido de data não confirma agendamento.";
      sources = ["docs/regras-operacionais-n8n.md@main:sha3a912f4"];
    } else if (input.interpretation.objective === "INICIAR_SERVICO") {
      if (!s.facts.reference) {
        action = "ASK"; response = "De quem é a exumação pretendida? Pode informar uma referência para identificar a pessoa, sem enviar documentos agora?";
        s.phase = "WAITING_CITIZEN";
      } else if (!s.operation_ids.length) {
        const id = `LAB-EXU-${input.case_id}-${input.inbound_message_id}`;
        s.operation_ids.push(id);
        operation = { id, kind: "REGISTER_DRAFT_REQUEST", simulated: true, confirmed_by_readback: false };
        action = "SIMULATED_OPERATION";
        response = `Registrei um rascunho simulado ${id}. A abertura real, documentos, autorização e data ainda dependem de verificação.`;
        s.phase = "WAITING_CITIZEN";
      } else response = "O rascunho simulado deste caso já existe; não criei outro.";
    } else { action = "ASK"; response = "Você quer iniciar uma exumação, acompanhar um pedido ou tirar uma dúvida?"; }
  }
  if (!response) throw Error("EMPTY_RESPONSE");
  s.last_step = action; s.last_response = response; s.processed_ids.push(input.inbound_message_id); s.revision++;
  if (action === "ASK") s.questions.push(response);
  store.commit(s, current.revision);
  const reread = store.read(input.case_id)!;
  if (operation) operation.confirmed_by_readback = reread.operation_ids.includes(operation.id);
  return { ...base, action, response, next_state: reread, sources, authority, ...(operation && { operation }), ...(human && { exception: human }) };
}
