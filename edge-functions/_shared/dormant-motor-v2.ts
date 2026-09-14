import { MotorV2Runtime } from "../../santana-conversation-domain/motor-v2/runtime.ts";
import {
  CONTROLLED_NVIDIA_MODEL,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import type { RuntimeInbound } from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";
import { HttpProblem } from "./http.ts";

const UNKNOWN_GAPS = {
  current_deadline: "unknown",
  current_value: "unknown",
  current_documents: "unknown",
  family_authorization: "unknown",
  current_schedule: "unknown",
  eligibility: "unknown",
  current_procedure: "unknown",
} as const;

/**
 * Dormant-only adapter. It produces a Motor V2 proposal and never sends or
 * writes anything. Durable production state/action integration is a later
 * activation gate, not part of Fase 19B.
 */
export async function runDormantMotorV2Proposal(inbound: RuntimeInbound) {
  const apiKey = Deno.env.get("NVIDIA_API_KEY")?.trim() ?? "";
  if (!apiKey) throw new HttpProblem(503, "MOTOR_V2_UNCONFIGURED", "Motor V2 provider is not configured");
  const idHash = await sha256(inbound.external_message_id);
  const result = await new MotorV2Runtime(
    new ControlledNvidiaUnderstandingProvider({
      apiKey,
      model: CONTROLLED_NVIDIA_MODEL,
      timeoutMs: 60_000,
      maxOutputTokens: 1024,
    }),
  ).runLabCase({
    case_id: `canary_${idHash.slice(0, 20)}`,
    conversation_id: `canary_${idHash.slice(0, 20)}`,
    inbound_id: `inbound_${idHash.slice(20, 40)}`,
    messages: [{ turn_id: `turn_${idHash.slice(0, 20)}`, role: "user", content: inbound.body }],
    known_facts: [],
    do_not_ask_again: [],
    track_states: [{ track_id: "primary", label: "atendimento canário", status: "active" }],
    administrative_gaps: UNKNOWN_GAPS,
    fixed_clock: { instant: new Date().toISOString(), timezone: "America/Sao_Paulo" },
  });
  return {
    provider: result.provider,
    reply_proposal: result.trace.reply,
    risk: result.state.understanding.risk,
    handoff: result.state.policy.handoff,
    required_receipts: result.state.policy.required_receipt_types,
    actions: result.state.policy.actions,
    effects: false,
  };
}
