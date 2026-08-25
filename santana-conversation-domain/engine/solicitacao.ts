// Fase 4B — R7 Solicitação e assunto real.
// Fonte: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4B.
// Fora da fronteira do release_id. Sem status global único.

export type SolicitacaoCategory =
  | "VENDA"
  | "ACOMPANHAMENTO"
  | "RECLAMACAO"
  | "SOLICITACAO_TAXA"
  | "SOLICITACAO_AGENDAMENTO"
  | "CONSULTA"
  | "ENCAMINHAMENTO_ADMINISTRACAO";

export type VendaEstado = "INTERESSE" | "SOLICITACAO_CONTATO" | "CONTATO_FEITO";
export type AcompanhamentoEstado = "ABERTO" | "EM_ANDAMENTO" | "RESOLVIDO";
export type ReclamacaoEstado = "OVERLAY_ABERTO" | "OVERLAY_EM_TRATAMENTO" | "OVERLAY_RESOLVIDO";
export type TaxaEstado = "SOLICITADA" | "PAGA";
export type AgendamentoEstado = "PEDIDA" | "CONFIRMADA_POR_HUMANO";
export type ConsultaEstado = "RESPONDIDA" | "ENCAMINHADA";
export type EncaminhamentoEstado = "ABERTO" | "DEVOLVIDO";

export type SolicitacaoEstado =
  | VendaEstado
  | AcompanhamentoEstado
  | ReclamacaoEstado
  | TaxaEstado
  | AgendamentoEstado
  | ConsultaEstado
  | EncaminhamentoEstado;

export const CATEGORY_CYCLES: Record<SolicitacaoCategory, readonly SolicitacaoEstado[]> = {
  VENDA: ["INTERESSE", "SOLICITACAO_CONTATO", "CONTATO_FEITO"],
  ACOMPANHAMENTO: ["ABERTO", "EM_ANDAMENTO", "RESOLVIDO"],
  RECLAMACAO: ["OVERLAY_ABERTO", "OVERLAY_EM_TRATAMENTO", "OVERLAY_RESOLVIDO"],
  SOLICITACAO_TAXA: ["SOLICITADA", "PAGA"],
  SOLICITACAO_AGENDAMENTO: ["PEDIDA", "CONFIRMADA_POR_HUMANO"],
  CONSULTA: ["RESPONDIDA", "ENCAMINHADA"],
  ENCAMINHAMENTO_ADMINISTRACAO: ["ABERTO", "DEVOLVIDO"],
};

export interface ConfirmedFact {
  code: string;
  value: string;
}

export interface AssuntoComposition {
  label: string;
  fell_back: boolean;
  rule_id: string;
}

export interface ForwardingRef {
  destinatario: string;
  executor: "SYSTEM" | "HUMAN";
}

export interface SolicitacaoInput {
  solicitacao_id: string;
  case_id: string | null;
  category: SolicitacaoCategory;
  topic_code: string;
  overlay_of_goal_id: string | null;
  summary: string;
  reason: string;
  collected_fact_ids: string[];
  pending_question_ref: string | null;
  pending_action_refs: string[];
  forwarding: ForwardingRef | null;
  estado: SolicitacaoEstado;
  opened_at_seq: number;
  confirmed_facts: ConfirmedFact[];
}

export interface SolicitacaoRecord {
  solicitacao_id: string;
  case_id: string | null;
  category: SolicitacaoCategory;
  topic_code: string;
  overlay_of_goal_id: string | null;
  assunto: AssuntoComposition;
  summary: string;
  reason: string;
  collected_fact_ids: string[];
  pending_question_ref: string | null;
  pending_action_refs: string[];
  forwarding: ForwardingRef | null;
  estado: SolicitacaoEstado;
  opened_at_seq: number;
}

function factValue(facts: ConfirmedFact[], code: string): string | null {
  return facts.find((f) => f.code === code)?.value ?? null;
}

/** G12 — composição do assunto a partir de fatos confirmados. Fail-closed. */
export function composeAssunto(facts: ConfirmedFact[]): AssuntoComposition {
  const item = factValue(facts, "commercial_item");
  const stage = factValue(facts, "commercial_stage");
  const delivery = factValue(facts, "commercial_delivery_status");

  if (item === "LAPIDE" && stage === "PEDIDO_PAGO" && delivery === "PENDENTE") {
    return {
      label: "Lapide comprada e nao instalada",
      fell_back: false,
      rule_id: "G12_LAPIDE_PEDIDO_PAGO_PENDENTE",
    };
  }

  const other = factValue(facts, "other_subject_description");
  if (other && other.trim().length > 0) {
    return {
      label: `Duvida sobre ${other.trim()}`,
      fell_back: false,
      rule_id: "G12_OTHER_SUBJECT_DESCRIPTION",
    };
  }

  return {
    label: "Solicitacao sem assunto composto",
    fell_back: true,
    rule_id: "G12_FAIL_CLOSED_GENERIC",
  };
}

export function assertEstadoNoCiclo(
  category: SolicitacaoCategory,
  estado: SolicitacaoEstado,
): void {
  const cycle = CATEGORY_CYCLES[category];
  if (!cycle.includes(estado)) {
    throw new Error(
      `estado '${estado}' fora do ciclo proprio de ${category}: [${cycle.join(", ")}]`,
    );
  }
}

export function createSolicitacao(input: SolicitacaoInput): SolicitacaoRecord {
  assertEstadoNoCiclo(input.category, input.estado);
  if (input.category === "RECLAMACAO" && !input.overlay_of_goal_id) {
    throw new Error("RECLAMACAO exige overlay_of_goal_id (base obrigatoria)");
  }
  const assunto = composeAssunto(input.confirmed_facts);
  return {
    solicitacao_id: input.solicitacao_id,
    case_id: input.case_id,
    category: input.category,
    topic_code: input.topic_code,
    overlay_of_goal_id: input.overlay_of_goal_id,
    assunto,
    summary: input.summary,
    reason: input.reason,
    collected_fact_ids: [...input.collected_fact_ids],
    pending_question_ref: input.pending_question_ref,
    pending_action_refs: [...input.pending_action_refs],
    forwarding: input.forwarding
      ? { ...input.forwarding }
      : null,
    estado: input.estado,
    opened_at_seq: input.opened_at_seq,
  };
}

/**
 * Estado observável estruturado — sem texto livre (summary/reason/label).
 * Gate PASS 4B: categorias distintas => observáveis distintos.
 */
export function observableSolicitacaoState(sol: SolicitacaoRecord): string {
  return JSON.stringify({
    category: sol.category,
    estado: sol.estado,
    topic_code: sol.topic_code,
    has_overlay: sol.overlay_of_goal_id !== null,
    has_case: sol.case_id !== null,
    has_forwarding: sol.forwarding !== null,
    assunto_fell_back: sol.assunto.fell_back,
    assunto_rule_id: sol.assunto.rule_id,
  });
}
