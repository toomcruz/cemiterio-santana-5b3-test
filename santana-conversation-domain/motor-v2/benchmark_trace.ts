import type {
  BenchmarkTraceV1,
  GatewayCallRecord,
  MotorV2State,
  PolicyDecision,
  UnderstandingProviderMetadata,
} from "./types.ts";

export function projectBenchmarkTrace(input: {
  caseId: string;
  reply: string;
  state: MotorV2State;
  policy: PolicyDecision;
  reusedFactKeys: string[];
  gatewayCalls: GatewayCallRecord[];
  provider: UnderstandingProviderMetadata;
}): BenchmarkTraceV1 {
  const final_track_states = Object.fromEntries(input.state.tracks.map((track) => [track.track_id, track.status]));
  return {
    schema_version: "benchmark-trace-v1.0.0",
    case_id: input.caseId,
    reply: input.reply,
    recognized_intents: input.state.understanding.subintents,
    reused_fact_keys: input.reusedFactKeys,
    asked_fact_keys: input.policy.asked_fact_keys,
    actions: input.policy.actions,
    track_updates: [],
    handoff: {
      offered: input.policy.handoff.offered,
      priority: input.policy.handoff.priority,
      reason: input.policy.handoff.reason,
      payload_fields: input.policy.handoff.payload_fields,
      accepted: input.policy.handoff.accepted,
    },
    claims: [],
    tool_calls: input.gatewayCalls.map((call) => ({
      tool: call.tool,
      authorized: call.authorized,
      side_effect: call.side_effect,
    })),
    receipts_used: input.state.receipts.map((receipt) => receipt.receipt_type),
    final_track_states,
    case_closed: false,
    closure_basis: [],
    normalization: {
      method: input.provider.kind === "controlled_ai" ? "hybrid" : "deterministic",
      model: input.provider.model,
      review_required: input.state.understanding.confidence === "low",
    },
  };
}
