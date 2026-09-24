export const SCHEMA_VERSION = "sana-lab/1" as const;
export type Family = "EXUMACAO" | "RECADASTRO" | "CONCESSAO_TITULARIDADE" | "INDEFINIDO";
export type Objective = "INFORMACAO" | "INICIAR_SERVICO" | "ACOMPANHAMENTO" | "ALTERACAO_CANCELAMENTO" | "INDEFINIDO";
export type Fact = { value: string; origin: "CITIZEN" | "SYSTEM"; evidence?: string };
export type Input = {
  schema_version: typeof SCHEMA_VERSION; environment: "LAB";
  conversation_id: string; episode_id: string; case_id: string;
  correlation_id: string; inbound_message_id: string; channel: "SIMULATOR";
  current_message: string; current_state?: CaseState;
  case_facts?: Record<string, Fact>; document_references?: string[];
  linked_case_ids?: string[];
  interpretation: { family: Family; objective: Objective; turn: string; reference?: string; aspects?: string[]; explicit_human?: boolean };
};
export type CaseState = {
  schema_version: typeof SCHEMA_VERSION; case_id: string; conversation_id: string;
  revision: number; family: Family; phase: "ACTIVE" | "WAITING_CITIZEN" | "WAITING_TEAM" | "RESOLVED_GRACE";
  facts: Record<string, Fact>; documents: Record<string, "DECLARED" | "RECEIVED_UNVERIFIED" | "VERIFIED">;
  demand_queue: Family[]; questions: string[]; processed_ids: string[];
  linked_case_ids?: string[];
  history: Array<{ inbound_message_id: string; field: string; previous?: string; current: string; origin: "CITIZEN" }>;
  last_response: string; last_step: string; operation_ids: string[];
};
export type Result = {
  schema_version: typeof SCHEMA_VERSION; case_id: string; correlation_id: string;
  action: "ANSWER" | "ASK" | "SIMULATED_OPERATION" | "EXCEPTION" | "DUPLICATE" | "UNSUPPORTED";
  response: string; next_state: CaseState; sources: string[];
  authority: Array<{ topic: string; status: "CONFIRMED" | "CONDITIONAL" | "UNKNOWN" | "HUMAN_DECISION_REQUIRED"; reason: string }>;
  operation?: { id: string; kind: string; simulated: true; confirmed_by_readback: boolean };
  exception?: { kind: "PEDIDO_HUMANO" | "DECISAO_ADMINISTRATIVA" | "FALHA_TECNICA"; reason: string; evidence: string; next_owner: string };
};
export function validateInput(v: Input): void {
  if (v.schema_version !== SCHEMA_VERSION || v.environment !== "LAB" || v.channel !== "SIMULATOR") throw Error("LAB_ONLY");
  for (const k of ["conversation_id", "episode_id", "case_id", "correlation_id", "inbound_message_id", "current_message"] as const) {
    if (typeof v[k] !== "string" || !v[k].trim()) throw Error(`INVALID_${k}`);
  }
  if (!["EXUMACAO", "RECADASTRO", "CONCESSAO_TITULARIDADE", "INDEFINIDO"].includes(v.interpretation?.family)) throw Error("INVALID_FAMILY");
  if (!["INFORMACAO", "INICIAR_SERVICO", "ACOMPANHAMENTO", "ALTERACAO_CANCELAMENTO", "INDEFINIDO"].includes(v.interpretation.objective)) throw Error("INVALID_OBJECTIVE");
  if (v.current_state && (v.current_state.case_id !== v.case_id || v.current_state.conversation_id !== v.conversation_id)) throw Error("CASE_MISMATCH");
  if (v.linked_case_ids && (!Array.isArray(v.linked_case_ids) || v.linked_case_ids.some(x => typeof x !== "string" || !x.trim() || x === v.case_id))) throw Error("INVALID_CASE_LINK");
}
export function adaptLegacy(output: Record<string, unknown>) {
  const family = output.familia;
  const objective = output.objetivo;
  if (!["EXUMACAO", "RECADASTRO", "CONCESSAO_TITULARIDADE", "INDEFINIDO"].includes(String(family)) ||
      !["INFORMACAO", "INICIAR_SERVICO", "ACOMPANHAMENTO", "ALTERACAO_CANCELAMENTO", "INDEFINIDO"].includes(String(objective))) throw Error("INVALID_LEGACY_TRIAGE");
  return { family: family as Family, objective: objective as Objective, turn: String(output.tipo_turno ?? "DEMANDA"),
    reference: String(output.referencia ?? ""), aspects: Array.isArray(output.aspectos) ? output.aspectos.filter((x): x is string => typeof x === "string") : [],
    explicit_human: output.precisa_humano === true && /(?:atendente|pessoa|humano|equipe)/i.test(String(output.motivo_humano ?? "")) };
}
