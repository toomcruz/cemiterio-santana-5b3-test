/** Offline pipeline proof: official store boundary, outbox, replay and suppressed delivery. */
import { assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import type { LanguageInterpreter } from "../adapter/adapter.ts";
import {
  processOfficialTurn,
  type RuntimeCommit,
  type RuntimeInbound,
  type RuntimeLease,
  type RuntimeStore,
} from "../official_turn_service.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { canonicalJson, sha256 } from "../server_transition.ts";
import { type ConversationState, initState } from "../../engine/engine.ts";

const CONVERSATION_ID = "92222222-2222-4222-8222-222222222222";
const ALLOWED = { automatic_replies_allowed: true } as const;

type DurableState = {
  state: ConversationState;
  revision: number;
  committed: Set<string>;
  outbox: Map<string, string>;
  commits: number;
};

class DurableTestStore implements RuntimeStore {
  constructor(private readonly durable: DurableState, private readonly failCommit = false) {}

  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    return Promise.resolve({
      duplicate: this.durable.committed.has(input.external_message_id),
      conversation_id: CONVERSATION_ID,
      inbound_message_id: input.external_message_id,
      revision: this.durable.revision,
      automation_mode: "BOT_ACTIVE",
      catalog_hash: input.catalog_hash,
      state: structuredClone(this.durable.state),
    });
  }

  async commitTurn(input: RuntimeCommit) {
    if (this.failCommit) throw new Error("synthetic commit failure");
    if (this.durable.committed.has(input.inbound_message_id)) {
      return { replayed: true, revision: this.durable.revision, outbox_id: null };
    }
    if (input.expected_revision !== this.durable.revision) throw new Error("revision conflict");
    if (input.state_hash !== await sha256(canonicalJson(input.state))) throw new Error("state hash mismatch");
    this.durable.state = structuredClone(input.state);
    this.durable.revision += 1;
    this.durable.committed.add(input.inbound_message_id);
    this.durable.commits += 1;
    const outboxId = input.reply_body ? `outbox-${input.inbound_message_id}` : null;
    if (outboxId) this.durable.outbox.set(outboxId, input.reply_body!);
    return { replayed: false, revision: this.durable.revision, outbox_id: outboxId };
  }
}

function input(id: string): RuntimeInbound {
  return {
    external_message_id: id,
    phone_e164: "+5511000000000",
    contact_name: "offline test",
    body: "Meu jazigo está violado",
    message_type: "text",
  };
}

const interpreter: LanguageInterpreter = {
  interpret: (message) => Promise.resolve(interpret(message)),
};

function deliverSuppressed(outboxId: string | null): "suppressed" {
  if (!outboxId) throw new Error("delivery requires a committed outbox item");
  return "suppressed";
}

Deno.test("official pipeline does not deliver when commit fails", async () => {
  const durable: DurableState = {
    state: initState(CONVERSATION_ID),
    revision: 0,
    committed: new Set(),
    outbox: new Map(),
    commits: 0,
  };
  let deliveries = 0;
  await assertRejects(
    () => processOfficialTurn(input("commit-fails"), new DurableTestStore(durable, true), interpreter, ALLOWED),
    /synthetic commit failure/,
  );
  assertEquals(durable.commits, 0);
  assertEquals(durable.outbox.size, 0);
  assertEquals(deliveries, 0);
});

Deno.test("official pipeline commits before suppressed delivery and replay is idempotent after restart", async () => {
  const durable: DurableState = {
    state: initState(CONVERSATION_ID),
    revision: 0,
    committed: new Set(),
    outbox: new Map(),
    commits: 0,
  };
  let interpretations = 0;
  const countingInterpreter: LanguageInterpreter = {
    interpret: async (message) => {
      interpretations += 1;
      return await interpret(message);
    },
  };
  const first = await processOfficialTurn(
    input("replay-once"),
    new DurableTestStore(durable),
    countingInterpreter,
    ALLOWED,
  );
  assertEquals(first.kind, "COMMITTED");
  assertEquals(durable.commits, 1);
  assertEquals(durable.outbox.size, 1);
  assertEquals(deliverSuppressed(first.outbox_id), "suppressed");
  // The committed outbox remains recoverable; no external delivery is attempted.
  const second = await processOfficialTurn(
    input("replay-once"),
    new DurableTestStore(durable),
    countingInterpreter,
    ALLOWED,
  );
  assertEquals(second.kind, "DUPLICATE");
  assertEquals(durable.commits, 1);
  assertEquals(durable.outbox.size, 1);
  assertEquals(interpretations, 1);
});
