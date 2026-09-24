import { adaptLegacy, SCHEMA_VERSION, type Input } from "./contracts.ts";
import type { Store } from "./engine.ts";

/** n8n boundary: receives simulated, explicit identifiers; no LLM or IDs synthesized here. */
export function adaptN8nTurn(event: {
  conversation_id: string; episode_id: string; case_id: string; correlation_id: string;
  inbound_message_id: string; message: string; legacy_output: Record<string, unknown>;
  document_references?: string[];
}, store: Store): Input {
  const interpretation = adaptLegacy(event.legacy_output);
  return {
    schema_version: SCHEMA_VERSION, environment: "LAB", channel: "SIMULATOR",
    conversation_id: event.conversation_id, episode_id: event.episode_id, case_id: event.case_id,
    correlation_id: event.correlation_id, inbound_message_id: event.inbound_message_id,
    current_message: event.message, current_state: store.read(event.case_id),
    document_references: event.document_references ?? [], interpretation,
  };
}
