import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import { sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";
import type { MotorV2LabResult, ReceiptType } from "../../santana-conversation-domain/motor-v2/types.ts";
import type { WouldCall } from "./types.ts";

const TOOL_BY_RECEIPT: Record<ReceiptType, string> = {
  handoff_acceptance: "propose_handoff",
  booking_confirmation: "propose_booking_change",
  payment_confirmation: "propose_payment_operation",
  document_confirmation: "propose_document_operation",
  execution_confirmation: "propose_service_execution",
  explicit_user_confirmation: "request_explicit_confirmation",
  resolution_confirmation: "propose_resolution_check",
};

export async function proposedCalls(result: MotorV2LabResult): Promise<WouldCall[]> {
  const calls: WouldCall[] = [];
  for (const receipt of result.state.policy.required_receipt_types) {
    const sanitized_input = {
      conversation_ref: result.state.conversation_id,
      track_ids: Object.keys(result.trace.final_track_states).sort(),
      risk_level: result.state.understanding.risk.level,
      confirmation_required: receipt === "explicit_user_confirmation" ||
        ["booking_confirmation", "payment_confirmation", "document_confirmation", "execution_confirmation"]
          .includes(receipt),
    };
    calls.push({
      mode: "would_call",
      tool: TOOL_BY_RECEIPT[receipt],
      sanitized_input,
      sanitized_input_sha256: await sha256(canonicalJson(sanitized_input)),
      confirmation_required: sanitized_input.confirmation_required,
      expected_receipt: receipt,
      effect_permitted: false,
      reason: "Shadow mode records the required capability but cannot execute an operational effect.",
    });
  }
  return calls;
}
