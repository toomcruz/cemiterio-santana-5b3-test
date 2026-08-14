import type { ClassifierOutput } from "./classifier.ts";
import type { ConversationStateSnapshot } from "./state.ts";

export type DecisionAction =
  | "RESPONDER"
  | "FAZER_PERGUNTA"
  | "ENVIAR_DOCUMENTO"
  | "SOLICITAR_CONFIRMACAO"
  | "CRIAR_SOLICITACAO"
  | "TRANSFERIR_HUMANO"
  | "AGUARDAR_DOCUMENTO"
  | "ENCERRAR"
  | "NAO_RESPONDER_SEM_CONFIRMACAO";

export type AConfirmarRestriction =
  | "NO_PRICE"
  | "NO_DEADLINE"
  | "NO_SLA"
  | "NO_REQUIRED_DOCUMENT"
  | "NO_ADMINISTRATIVE_PROPOSAL"
  | "NO_LEGACY_FALLBACK";

export interface ResolvedFactReference {
  type: "PRICE" | "DOCUMENT" | "HOURS" | "CONDITION" | "MESSAGE" | "ASSET";
  id: string;
}

export interface ResponsePlan {
  mode: "DETERMINISTIC" | "FIELD_TEMPLATE" | "GEMINI";
  template_id?: string;
  template_variables?: Record<string, string | number | boolean>;
  allowed_fact_refs: ResolvedFactReference[];
  asset_ids: string[];
  question?: { question_code: string; expected_answer_schema: Record<string, unknown> };
  max_questions: 0 | 1;
}

export interface StatePatch {
  expected_state_version: number;
  operations: Array<
    | { op: "CREATE_SESSION"; session_id: string; release_id: string }
    | { op: "CREATE_TOPIC"; topic_id: string; intent_code: string; service_code?: string }
    | { op: "SET_TOPIC_STATUS"; topic_id: string; status: string }
    | { op: "SET_PENDING_QUESTION"; topic_id: string; question_code: string }
    | { op: "CLEAR_PENDING_QUESTION"; topic_id: string }
    | { op: "MERGE_COLLECTED_DATA"; topic_id: string; allowed_fields: Record<string, unknown> }
    | { op: "SET_AUTOMATION_MODE"; mode: "BOT_ACTIVE" | "HUMAN_ACTIVE" }
    | { op: "SCHEDULE_INACTIVITY"; session_id: string }
    | { op: "CANCEL_INACTIVITY"; session_id: string }
    | { op: "CLOSE_SESSION"; session_id: string; reason: string }
  >;
}

export interface RequestPlan {
  mode: "NONE" | "PROPOSE";
  request_policy_id: string;
  subject_template_id: string;
  /** Only keys allowed by the published request policy schema may occur. */
  proposal_field_values: Record<string, string | boolean | number | null>;
  document_ids: string[];
  confirmation_required: true;
}

export interface DocumentPlan {
  mode: "NONE" | "REQUEST" | "ACCEPT" | "SEND";
  requirement_ids: string[];
  asset_ids: string[];
  human_review_required: boolean;
}

export interface HandoffPlan {
  mode: "NONE" | "PROPOSE" | "ACTIVATE";
  handoff_policy_id: string;
  reason_code: string;
  queue_code: string | null;
  pause_bot: boolean;
}

export interface ValidationRequirements {
  session_must_be_active: boolean;
  topic_id?: string;
  expected_topic_version?: number;
  human_must_be_inactive: boolean;
  confirmation_nonce_required: boolean;
  required_document_ids: string[];
  provider_delivery_required: boolean;
  idempotency_key?: string;
}

export interface DecisionPlan {
  schema_version: "1.0";
  decision_id: string;
  correlation_id: string;
  release_id: string;
  state_version: number;
  outcome: "PERMITTED" | "BLOCKED" | "A_CONFIRMAR";
  actions: DecisionAction[];
  response_plan: ResponsePlan | null;
  state_patch: StatePatch;
  request_plan: RequestPlan | null;
  document_plan: DocumentPlan | null;
  handoff_plan: HandoffPlan | null;
  reason_codes: string[];
  validation_requirements: ValidationRequirements;
  a_confirmar_restrictions: AConfirmarRestriction[];
  expires_at: string;
}

export interface DecisionInput {
  correlation_id: string;
  release_id: string;
  classification: ClassifierOutput;
  state: ConversationStateSnapshot;
  technical_context: {
    now: string;
    provider_window_open: boolean | null;
    channel: "WHATSAPP";
    human_active: boolean;
    duplicate: boolean;
  };
}

export const A_CONFIRMAR_RESTRICTIONS: AConfirmarRestriction[] = [
  "NO_PRICE",
  "NO_DEADLINE",
  "NO_SLA",
  "NO_REQUIRED_DOCUMENT",
  "NO_ADMINISTRATIVE_PROPOSAL",
  "NO_LEGACY_FALLBACK",
];

export function assertAConfirmarPlan(plan: DecisionPlan): string[] {
  if (plan.outcome !== "A_CONFIRMAR") return [];
  const errors: string[] = [];
  if (plan.request_plan) errors.push("A_CONFIRMAR_CANNOT_PROPOSE_REQUEST");
  if (plan.response_plan?.allowed_fact_refs.some((fact) => fact.type !== "MESSAGE")) {
    errors.push("A_CONFIRMAR_CANNOT_RESOLVE_FACT");
  }
  if (plan.actions.includes("CRIAR_SOLICITACAO") || plan.actions.includes("SOLICITAR_CONFIRMACAO")) {
    errors.push("A_CONFIRMAR_CANNOT_CREATE_ADMINISTRATIVE_FLOW");
  }
  return errors;
}
