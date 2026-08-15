import type { ConversationStateSnapshot, MessageBatch } from "./state.ts";

export const CLASSIFIER_MESSAGE_ROLES = [
  "NEW_TOPIC",
  "ANSWER_TO_PENDING_QUESTION",
  "CONTINUATION",
  "FRAGMENT",
  "COMMAND",
  "DOCUMENT_SUBMISSION",
  "CONFIRMATION_AFFIRMATIVE",
  "CONFIRMATION_NEGATIVE",
  "TOPIC_CHANGE",
  "UNKNOWN",
] as const;

export type ClassifierMessageRole = (typeof CLASSIFIER_MESSAGE_ROLES)[number];
export type ClassificationStatus = "OK" | "AMBIGUOUS" | "BLOCKED" | "INVALID_INPUT";
export type EvidenceKind =
  | "STATE"
  | "PENDING_QUESTION"
  | "EXACT_COMMAND"
  | "TEXT_SPAN"
  | "ATTACHMENT"
  | "MODEL_EVIDENCE_SUMMARY";

export interface TaxonomySnapshot {
  release_id: string;
  taxonomy_hash: string;
  intents: Array<{ code: string; visibility: "PUBLIC" | "INTERNAL" | "SYSTEM" }>;
  services: Array<{ code: string; availability_status: "ACTIVE" | "A_CONFIRMAR" | "RETIRED"; aliases: string[] }>;
  location_types: Array<"QUADRA_GERAL" | "JAZIGO" | "OSSUARIO" | "NAO_INFORMADO" | "A_CONFIRMAR">;
}

export interface ClassifierInput {
  schema_version: "1.0";
  correlation_id: string;
  release_id: string;
  message_batch: MessageBatch;
  state: ConversationStateSnapshot;
  taxonomy: TaxonomySnapshot;
  technical_signals: {
    duplicate: boolean;
    human_active: boolean;
    provider_window_open: boolean | null;
    inbound_source: "WAPI" | "MANUAL" | "SYSTEM";
    phone_hash?: string;
  };
}

export interface ClassificationCandidate {
  code: string;
  confidence: number;
  source: "DETERMINISTIC" | "MODEL";
  evidence_ids: string[];
}

export interface ClassifierEvidence {
  evidence_id: string;
  kind: EvidenceKind;
  message_id?: string;
  start?: number;
  end?: number;
  redacted_summary: string;
}

export interface ClassifierOutput {
  schema_version: "1.0";
  correlation_id: string;
  release_id: string;
  classification_status: ClassificationStatus;
  message_role: ClassifierMessageRole;
  intent_candidates: ClassificationCandidate[];
  service_candidates: ClassificationCandidate[];
  location_candidate: {
    location_type: "QUADRA_GERAL" | "JAZIGO" | "OSSUARIO" | "NAO_INFORMADO" | "A_CONFIRMAR";
    confidence: number;
    evidence_ids: string[];
  } | null;
  complaint_signal: boolean;
  human_need_signal: boolean;
  topic_transition_candidate: "KEEP_ACTIVE" | "START_NEW" | "AMBIGUOUS";
  continuation_of_topic_id: string | null;
  document_signal: "NONE" | "POSSIBLE_DOCUMENT" | "TECHNICAL_DOCUMENT";
  ambiguity_codes: string[];
  evidence: ClassifierEvidence[];
}

export function validateClassifierOutput(output: ClassifierOutput, taxonomy: TaxonomySnapshot): string[] {
  const errors: string[] = [];
  if (output.release_id !== taxonomy.release_id) errors.push("RELEASE_MISMATCH");
  if (!CLASSIFIER_MESSAGE_ROLES.includes(output.message_role)) errors.push("INVALID_MESSAGE_ROLE");
  if (output.intent_candidates.length > 3 || output.service_candidates.length > 3) errors.push("TOO_MANY_CANDIDATES");
  const intentCodes = new Set(taxonomy.intents.map((item) => item.code));
  const serviceCodes = new Set(taxonomy.services.map((item) => item.code));
  for (const item of output.intent_candidates) {
    if (!intentCodes.has(item.code) || item.confidence < 0 || item.confidence > 1) {
      errors.push("INVALID_INTENT_CANDIDATE");
    }
  }
  for (const item of output.service_candidates) {
    if (!serviceCodes.has(item.code) || item.confidence < 0 || item.confidence > 1) {
      errors.push("INVALID_SERVICE_CANDIDATE");
    }
  }
  if (
    output.message_role === "CONFIRMATION_AFFIRMATIVE" && !output.evidence.some((e) => e.kind === "PENDING_QUESTION")
  ) {
    errors.push("CONFIRMATION_WITHOUT_PENDING_CONTEXT");
  }
  return [...new Set(errors)];
}
