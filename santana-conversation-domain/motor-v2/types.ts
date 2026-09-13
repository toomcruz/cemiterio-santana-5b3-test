export type JsonScalar = string | number | boolean | null;

export type Confidence = "high" | "medium" | "low";
export type Complexity = "low" | "medium" | "high" | "critical";
export type RiskLevel = "none" | "P3" | "P2" | "P1" | "P0";
export type HandoffPriority = "none" | "normal" | "priority" | "P0";
export type GapStatus = "unknown" | "requires_current_policy" | "human_validation_required";
export type TrackStatus =
  | "new"
  | "active"
  | "blocked"
  | "pending_handoff"
  | "handoff_accepted"
  | "handled"
  | "closed"
  | "inactive"
  | "unknown";

export interface MotorV2Message {
  turn_id: string;
  role: "user" | "assistant";
  content: string;
  synthetic?: boolean;
}

export interface SeededFact {
  key: string;
  value: JsonScalar;
  source_turn: string;
  status: "user_provided" | "system_observed" | "synthetic_fixture";
}

export interface SeededTrack {
  track_id: string;
  label: string;
  status: Exclude<TrackStatus, "unknown">;
}

export interface AdministrativeGaps {
  current_deadline: GapStatus;
  current_value: GapStatus;
  current_documents: GapStatus;
  family_authorization: GapStatus;
  current_schedule: GapStatus;
  eligibility: GapStatus;
  current_procedure: GapStatus;
}

export interface FixedClock {
  instant: string;
  timezone: string;
}

/**
 * Lab input intentionally excludes expected intents, assertions and target labels.
 * Seeded facts/tracks model already-persisted context, not an answer key.
 */
export interface MotorV2LabInput {
  case_id?: string;
  conversation_id?: string;
  inbound_id?: string;
  messages: MotorV2Message[];
  known_facts: SeededFact[];
  do_not_ask_again: string[];
  track_states: SeededTrack[];
  administrative_gaps: AdministrativeGaps;
  fixed_clock: FixedClock;
}

export interface UnderstandingResult {
  schema_version: "motor-v2-understanding/1.0.0";
  journeys: string[];
  subintents: string[];
  transverse_states: string[];
  intent_changed: boolean;
  complexity: Complexity;
  risk: { level: RiskLevel; signals: string[] };
  confidence: Confidence;
  evidence_turns: string[];
}

export interface UnderstandingProviderMetadata {
  id: string;
  kind: "deterministic_lab" | "controlled_ai";
  uses_ai: boolean;
  model: string;
  schema_guarded: boolean;
}

export type FactTemporalStatus = "not_applicable" | GapStatus;

export interface VersionedFact {
  fact_id: string;
  key: string;
  value: JsonScalar;
  value_type: "string" | "number" | "boolean" | "null";
  source: SeededFact["status"] | "current_policy" | "receipt";
  source_ref: string;
  confidence: Confidence;
  version: number;
  status: "active" | "superseded";
  observed_at: string;
  temporal_status: FactTemporalStatus;
  superseded_by: string | null;
}

export interface MotorV2Track {
  track_id: string;
  label: string;
  status: TrackStatus;
  subintents: string[];
  updated_at: string;
}

export type PolicyAction =
  | "PRESERVE_STATE"
  | "PRIORITIZE_URGENT"
  | "ACKNOWLEDGE_UNCERTAINTY"
  | "HANDOFF"
  | "REQUEST_EXPLICIT_CONFIRMATION"
  | "WAIT_FOR_RECEIPT";

export interface HandoffDecision {
  lifecycle: "none" | "offered" | "accepted" | "completed";
  offered: boolean;
  priority: HandoffPriority;
  reason: string;
  payload_fields: string[];
  accepted: boolean | "unknown";
}

export interface PolicyDecision {
  actions: PolicyAction[];
  asked_fact_keys: string[];
  handoff: HandoffDecision;
  blocked_claims: string[];
  required_receipt_types: ReceiptType[];
  policy_gaps: Array<{ field: keyof AdministrativeGaps; status: GapStatus }>;
  current_policy_refs: string[];
}

export type ReceiptType =
  | "handoff_acceptance"
  | "booking_confirmation"
  | "payment_confirmation"
  | "document_confirmation"
  | "execution_confirmation"
  | "explicit_user_confirmation"
  | "resolution_confirmation";

export interface GatewayReceipt {
  receipt_id: string;
  receipt_type: ReceiptType;
  tool: string;
  idempotency_key: string;
  issued_at: string;
  payload_hash: string;
  executor_reference_hash: string;
  bound_claim_codes: string[];
  integrity_hash: string;
}

export interface GatewayCallRecord {
  tool: string;
  authorized: boolean;
  side_effect: boolean;
  outcome: "denied" | "proposed" | "executed" | "replayed";
  reason: string;
  receipt: GatewayReceipt | null;
}

export interface MotorV2AuditEvent {
  sequence: number;
  at: string;
  kind: string;
  detail: string;
  state_hash: string;
}

export interface MotorV2State {
  schema_version: "motor-v2-state/1.0.0";
  conversation_id: string;
  revision: number;
  facts: VersionedFact[];
  tracks: MotorV2Track[];
  understanding: UnderstandingResult;
  policy: PolicyDecision;
  receipts: GatewayReceipt[];
  processed_inbound_ids: string[];
  audit: MotorV2AuditEvent[];
  state_hash: string;
}

export interface BenchmarkTraceV1 {
  schema_version: "benchmark-trace-v1.0.0";
  case_id: string;
  reply: string;
  recognized_intents: string[];
  reused_fact_keys: string[];
  asked_fact_keys: string[];
  actions: string[];
  track_updates: Array<{ track_id: string; from: string; to: string; evidence: string }>;
  handoff: {
    offered: boolean;
    priority: HandoffPriority;
    reason: string;
    payload_fields: string[];
    accepted: boolean | "unknown";
  };
  claims: Array<{ claim_code: string; text_span: string; receipt_refs: string[] }>;
  tool_calls: Array<{ tool: string; authorized: boolean; side_effect: boolean }>;
  receipts_used: string[];
  final_track_states: Record<string, TrackStatus>;
  case_closed: boolean;
  closure_basis: string[];
  normalization: {
    method: "deterministic" | "isolated_semantic_judge" | "hybrid";
    model: string;
    review_required: boolean;
  };
}

export interface MotorV2Metrics {
  duration_ms: number;
  message_count: number;
  user_turn_count: number;
  recognized_intent_count: number;
  track_count: number;
  question_count: number;
  tool_call_count: number;
  retry_count: number;
}

export interface MotorV2LabResult {
  trace: BenchmarkTraceV1;
  state: MotorV2State;
  audit: MotorV2AuditEvent[];
  metrics: MotorV2Metrics;
  provider: UnderstandingProviderMetadata;
  duplicate: boolean;
}
