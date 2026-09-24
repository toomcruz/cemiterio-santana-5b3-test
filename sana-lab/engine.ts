import { type CaseState, type Input, type Result, SCHEMA_VERSION, validateInput } from "./contracts.ts";
import { recadastro } from "./recadastro.ts";
import { concessaoTitularidade } from "./concessao_titularidade.ts";
import { exumacao } from "./exumacao.ts";

export interface Store {
  read(id: string): CaseState | undefined;
  commit(next: CaseState, expectedRevision: number): void;
}
function exception(
  kind: NonNullable<Result["exception"]>["kind"],
  reason: string,
  evidence: string,
): NonNullable<Result["exception"]> {
  return { kind, reason, evidence, next_owner: "Equipe do cemitério (simulação; nenhuma tarefa real criada)" };
}
export class MemoryStore implements Store {
  private cases = new Map<string, CaseState>();
  read(id: string) {
    const x = this.cases.get(id);
    return x && structuredClone(x);
  }
  commit(next: CaseState, expectedRevision: number) {
    if ((this.cases.get(next.case_id)?.revision ?? 0) !== expectedRevision) throw Error("REVISION_CONFLICT");
    this.cases.set(next.case_id, structuredClone(next));
  }
}
export function emptyState(input: Input): CaseState {
  return {
    schema_version: SCHEMA_VERSION,
    case_id: input.case_id,
    conversation_id: input.conversation_id,
    revision: 0,
    family: "INDEFINIDO",
    phase: "ACTIVE",
    facts: {},
    documents: {},
    demand_queue: [],
    questions: [],
    processed_ids: [],
    history: [],
    last_response: "",
    last_step: "NEW",
    operation_ids: [],
  };
}
const normalize = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Interpreter is supplied as input. This layer decides actions and never calls Gemini or a transport. */
export async function handle(input: Input, store: Store, today = "2026-09-24"): Promise<Result> {
  validateInput(input);
  const current = store.read(input.case_id) ?? emptyState(input);
  if (current.conversation_id !== input.conversation_id) throw Error("CASE_MISMATCH");
  if (input.current_state && input.current_state.revision !== current.revision) throw Error("STALE_STATE");
  const base = { schema_version: SCHEMA_VERSION, case_id: input.case_id, correlation_id: input.correlation_id };
  if (current.processed_ids.includes(input.inbound_message_id)) {
    return { ...base, action: "DUPLICATE", response: "", next_state: current, sources: [], authority: [] };
  }
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
  if (
    input.interpretation.explicit_human ||
    /(?:quero|preciso|prefiro|falar com|chame).{0,30}(?:atendente|pessoa|humano)/.test(message)
  ) {
    if (s.family === "INDEFINIDO" && family !== "INDEFINIDO") s.family = family;
    action = "EXCEPTION";
    human = exception("PEDIDO_HUMANO", "Pedido explícito de atendente", input.current_message);
    response =
      "Você pediu atendimento humano. O pedido ficou registrado nesta simulação; nenhum encaminhamento real foi feito.";
    s.phase = "WAITING_TEAM";
  } else if (s.family === "EXUMACAO" && family !== s.family) {
    action = "ANSWER";
    response =
      "Percebi que o assunto mudou. Mantive a exumação neste caso e não iniciei o outro assunto. Você pode retomá-la depois.";
    s.phase = "WAITING_CITIZEN";
  } else if (s.family !== "INDEFINIDO" && family !== s.family) {
    throw Error("FAMILY_CONFLICT");
  } else if (family === "RECADASTRO") {
    s.family = "RECADASTRO";
    const result = recadastro(input, s, message);
    action = result.action;
    response = result.response;
    sources = result.sources;
    authority.push(...result.authority);
    operation = result.operation;
    human = result.exception;
  } else if (family === "CONCESSAO_TITULARIDADE") {
    s.family = "CONCESSAO_TITULARIDADE";
    const result = concessaoTitularidade(input, s, message);
    action = result.action;
    response = result.response;
    sources = result.sources;
    authority.push(...result.authority);
    operation = result.operation;
    human = result.exception;
  } else if (family !== "EXUMACAO") {
    action = "UNSUPPORTED";
    response = "Preciso esclarecer qual serviço você procura.";
  } else {
    s.family = "EXUMACAO";
    const result = await exumacao(input, s, message, today);
    action = result.action;
    response = result.response;
    sources = result.sources;
    authority.push(...result.authority);
    operation = result.operation;
    human = result.exception;
  }
  if (!response) throw Error("EMPTY_RESPONSE");
  s.last_step = action;
  s.last_response = response;
  s.processed_ids.push(input.inbound_message_id);
  s.revision++;
  if (action === "ASK" && s.family !== "EXUMACAO" && !s.questions.includes(response)) s.questions.push(response);
  store.commit(s, current.revision);
  const reread = store.read(input.case_id)!;
  if (operation) operation.confirmed_by_readback = reread.operation_ids.includes(operation.id);
  return {
    ...base,
    action,
    response,
    next_state: reread,
    sources,
    authority,
    ...(operation && { operation }),
    ...(human && { exception: human }),
  };
}
