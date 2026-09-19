import type { ConversationState } from "../santana-conversation-domain/engine/engine.ts";
import type {
  RuntimeCommit,
  RuntimeInbound,
  RuntimeLease,
  RuntimeStore,
} from "../santana-conversation-domain/runtime/official_turn_service.ts";

export type LabTurnRecord = {
  inbound: RuntimeInbound;
  state_before: ConversationState | null;
  state_after: ConversationState | null;
  commit: RuntimeCommit | null;
  result: { revision: number; outbox_id: string | null; replayed: boolean } | null;
  receipt: { status: "COMMITTED" | "REPLAYED"; revision: number } | null;
  outbox: { id: string; body: string; status: "PENDING" } | null;
};

export class LabStore implements RuntimeStore {
  state: ConversationState | null = null;
  revision = 0;
  readonly conversation_id: string;
  readonly turns: LabTurnRecord[] = [];
  readonly committed = new Set<string>();
  readonly outbox = new Map<string, { body: string; status: "PENDING" }>();
  automation: RuntimeLease["automation_mode"] = "BOT_ACTIVE";

  constructor(conversationId: string) {
    this.conversation_id = conversationId;
  }

  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    const duplicate = this.committed.has(input.external_message_id);
    const before = this.state ? structuredClone(this.state) : null;
    this.turns.push({
      inbound: structuredClone(input),
      state_before: before,
      state_after: null,
      commit: null,
      result: null,
      receipt: duplicate ? { status: "REPLAYED", revision: this.revision } : null,
      outbox: null,
    });
    return Promise.resolve({
      duplicate,
      conversation_id: this.conversation_id,
      inbound_message_id: input.external_message_id,
      revision: this.revision,
      automation_mode: this.automation,
      catalog_hash: input.catalog_hash,
      state: structuredClone(this.state),
    });
  }

  commitTurn(input: RuntimeCommit) {
    const turn = this.turns.at(-1)!;
    if (input.expected_revision !== this.revision) throw new Error("LAB_REVISION_CONFLICT");
    if (this.committed.has(input.inbound_message_id)) {
      turn.result = { revision: this.revision, outbox_id: null, replayed: true };
      turn.receipt = { status: "REPLAYED", revision: this.revision };
      return Promise.resolve({ replayed: true, revision: this.revision, outbox_id: null });
    }
    this.state = structuredClone(input.state);
    this.revision += 1;
    this.committed.add(input.inbound_message_id);
    const outboxId = input.reply_body ? `lab-outbox-${this.revision}` : null;
    if (outboxId) this.outbox.set(outboxId, { body: input.reply_body!, status: "PENDING" });
    turn.commit = structuredClone(input);
    turn.state_after = structuredClone(input.state);
    turn.result = { revision: this.revision, outbox_id: outboxId, replayed: false };
    turn.receipt = { status: "COMMITTED", revision: this.revision };
    turn.outbox = outboxId ? { id: outboxId, ...structuredClone(this.outbox.get(outboxId)!) } : null;
    return Promise.resolve({ replayed: false, revision: this.revision, outbox_id: outboxId });
  }
}
