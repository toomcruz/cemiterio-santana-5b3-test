// Contrato tipado da camada de interpretacao de linguagem (5B.4-C).
// A interpretacao e uma PROPOSTA: nao escreve no banco, nao cria autoridade e
// so vira estado depois de passar pelo reducer canonico.

import type { EventKind, FactValue } from "../../engine/catalog.ts";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Origem que a camada de linguagem pode alegar. Nunca SYSTEM/DOCUMENT/DERIVED_RULE. */
export type InterpreterSource = "USER_EXPLICIT" | "USER_CORRECTION";

export interface CandidateFact {
  fact_code: string;
  value: FactValue;
  source: InterpreterSource;
  confidence: Confidence;
  /** Trecho da mensagem que sustenta o candidato. Sem evidencia nao ha fato. */
  evidence: string;
  /** true quando o fato precisa de confirmacao do usuario antes de virar evento. */
  requires_confirmation: boolean;
}

export interface CandidateEvent {
  event_kind: EventKind;
  confidence: Confidence;
  evidence: string;
}

export interface CandidateGoal {
  goal_code: string;
  confidence: Confidence;
  evidence: string;
}

export interface CaseReference {
  /** CURRENT: segue o case em foco. NEW: outro falecido/pedido. AMBIGUOUS: nao da para decidir. */
  kind: "CURRENT" | "NEW" | "AMBIGUOUS";
  subject_kind: "DECEASED" | "CONCESSION" | "ORDER" | "GENERIC";
  /** Pista textual do sujeito (nunca PII estruturada; o HMAC e calculado fora daqui). */
  subject_hint: string | null;
  confidence: Confidence;
}

export interface Ambiguity {
  code: string;
  description: string;
  options: string[];
  /** Ambiguidade bloqueadora impede a interpretacao de virar evento. */
  blocking: boolean;
}

/** Aquilo que o interpretador se recusou a inferir, com o motivo. */
export interface Refusal {
  reason:
    | "AUTHORITATIVE_FACT"
    | "OFFICIAL_RULE"
    | "UNKNOWN_CODE"
    | "VALUE_OUT_OF_DOMAIN"
    | "FORBIDDEN_SOURCE"
    | "LOW_CONFIDENCE";
  detail: string;
}

export interface Interpretation {
  schema_version: "santana-interpretation/v1";
  message_id: string;
  text_normalized: string;
  primary_event: CandidateEvent | null;
  secondary_events: CandidateEvent[];
  goal: CandidateGoal | null;
  case_reference: CaseReference;
  facts: CandidateFact[];
  ambiguities: Ambiguity[];
  overall_confidence: Confidence;
  needs_clarification: boolean;
  clarification_reason: string | null;
  refusals: Refusal[];
  /** Identificador do interpretador que produziu a proposta (mock, LLM, humano). */
  produced_by: string;
}

export interface InterpreterInput {
  message_id: string;
  text: string;
  /** Estado conversacional resumido, para desambiguar referencia de case e retomada. */
  context: {
    has_open_goal: boolean;
    open_goal_code: string | null;
    pending_question_fact: string | null;
    known_subject_hints: string[];
  };
}
