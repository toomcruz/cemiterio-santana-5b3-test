import type {
  BenchmarkTraceV1,
  MotorV2LabResult,
  MotorV2Message,
} from "../../santana-conversation-domain/motor-v2/types.ts";

export const SHADOW_MODE = "OFFLINE_REPLAY" as const;

export interface ShadowReferenceLabels {
  source: "phase11_heuristic_recomputed_on_decision_window";
  scope: "decision_input_prefix_only";
  human_validated: false;
  journeys: string[];
  subintents: string[];
  transverse_states: string[];
  intent_changed: boolean;
  multi_intent: boolean;
  handoff_observed: boolean;
  possible_abandonment: boolean;
  resolution_apparent: boolean;
  risk_flags: string[];
}

export interface ShadowInputEnvelope {
  schema_version: "phase18-shadow-input/1.2.0";
  mode: typeof SHADOW_MODE;
  cohort_id: string;
  cohort_hash: string;
  source_snapshot_sha256: string;
  event_id: string;
  episode_id: string;
  started_at: string;
  ended_at: string;
  decision_at: string;
  source_episode_message_count: number;
  messages: MotorV2Message[];
  observed_followup_messages: MotorV2Message[];
  reference: ShadowReferenceLabels;
}

export interface WouldCall {
  mode: "would_call";
  tool: string;
  sanitized_input: Record<string, string | boolean | string[]>;
  sanitized_input_sha256: string;
  confirmation_required: boolean;
  expected_receipt: string;
  effect_permitted: false;
  reason: string;
}

export interface ReplyFeatures {
  sha256: string;
  characters: number;
  question_count: number;
  menu_signal: boolean;
  completion_claim_signal: boolean;
}

export interface ShadowEngineProjection {
  engine: string;
  recognized_intents: string[];
  journeys: string[];
  transverse_states: string[];
  intent_changed: boolean;
  risk_level: string;
  risk_signals: string[];
  reused_fact_keys: string[];
  asked_fact_keys: string[];
  actions_proposed: string[];
  actions_executed_real: [];
  claim_codes: string[];
  blocked_claim_codes: string[];
  current_policy_refs: string[];
  policy_gaps: Array<{ field: string; status: string }>;
  handoff: BenchmarkTraceV1["handoff"];
  would_call: WouldCall[];
  receipts_required: string[];
  receipts_observed: [];
  tracks: BenchmarkTraceV1["final_track_states"];
  case_closed: boolean;
  closure_basis: string[];
  reply: ReplyFeatures;
  latency_ms: number;
  provider: MotorV2LabResult["provider"] | null;
}

export interface ShadowComparisonRecord {
  schema_version: "phase18-shadow-record/1.2.0";
  mode: typeof SHADOW_MODE;
  event_id: string;
  episode_id: string;
  input_hash: string;
  cohort_id: string;
  cohort_hash: string;
  source_snapshot_sha256: string;
  started_at: string;
  ended_at: string;
  decision_at: string;
  decision_input_message_count: number;
  observed_followup_count: number;
  post_observation_tail_count: number;
  source_message_count: number;
  reference: ShadowReferenceLabels;
  observed_current: {
    inbound_count: number;
    outbound_count: number;
    last_direction: "inbound" | "outbound";
    observed_handoff_signal: boolean;
    observed_menu_signal: boolean;
    observed_completion_claim_signal: boolean;
    last_outbound_reply: ReplyFeatures | null;
    raw_content_persisted: false;
  };
  current_workflow_replay: ShadowEngineProjection;
  motor_v2_shadow: ShadowEngineProjection;
  divergence_codes: string[];
  candidate_evidence: string[];
  zero_effects: {
    network_allowed: false;
    production_adapters_loaded: false;
    real_messages_sent: 0;
    real_tools_executed: 0;
    official_state_writes: 0;
    simulated_current_outbox_only: true;
  };
  provenance: {
    input_source: "immutable_whatsapp_snapshot";
    current_result_kind: "isolated_current_workflow_replay";
    v2_result_kind: "offline_shadow_proposal";
    reference_kind: "unreviewed_window_aligned_heuristic_candidate_evidence";
  };
}

export interface StoredShadowRecord {
  schema_version: "phase18-shadow-store-record/1.0.0";
  event_id: string;
  input_hash: string;
  result_hash: string;
  consolidated_at: string;
  result: ShadowComparisonRecord;
}

export interface ShadowCheckpoint {
  schema_version: "phase18-shadow-checkpoint/1.0.0";
  cohort_id: string;
  cohort_hash: string;
  completed_event_ids: string[];
  completed_count: number;
  last_event_id: string | null;
  rebuilt_from_records: boolean;
}
