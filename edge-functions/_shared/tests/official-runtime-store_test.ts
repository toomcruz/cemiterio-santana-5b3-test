import { assertEquals } from "../../../tests/fixtures/assert.ts";
import type { RuntimeCommit, RuntimeInbound } from "../../../santana-conversation-domain/runtime/official_turn_service.ts";
import { OfficialSupabaseRest } from "../official-rest.ts";
import {
  type RuntimeAttachmentProcessor,
  SupabaseRuntimeStore,
} from "../official-runtime-store.ts";

class FakeRest {
  calls: Array<{ name: string; body: Record<string, unknown> }> = [];

  async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, body });
    if (name === "support_runtime_acquire_inbound") {
      return {
        duplicate: false,
        conversation_id: "11111111-2222-4333-8444-555555555555",
        inbound_message_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
        revision: 0,
        automation_mode: "BOT_ACTIVE",
        catalog_hash: "a".repeat(64),
        state: null,
      };
    }
    if (name === "support_runtime_commit_turn") {
      return { replayed: false, revision: 1, outbox_id: "outbox-1" };
    }
    throw new Error("unexpected RPC");
  }
}

const attachment: RuntimeAttachmentProcessor = {
  async persist() {
    return {
      received_document: {
        documento_id: "doc-1",
        tipo: "application/pdf",
        descricao: "teste.pdf",
        recebido_em: "2026-09-08T15:00:00.000Z",
      },
      failure_code: null,
    };
  },
};

function inbound(): RuntimeInbound & { catalog_hash: string } {
  return {
    external_message_id: "wapi-1",
    phone_e164: "+5511959805497",
    contact_name: "Canario",
    body: "[Arquivo recebido: teste.pdf]",
    message_type: "document",
    metadata: { source: "wapi", safe: true },
    attachment: {
      file_name: "teste.pdf",
      mime_type: "application/pdf",
      message_type: "document",
      media_url: "https://api.w-api.app/private-file",
      media_key: "secret-media-key",
      media_direct_path: "/private",
    },
    catalog_hash: "a".repeat(64),
  };
}

Deno.test("official store forwards only safe metadata to the database acquisition RPC", async () => {
  const rest = new FakeRest();
  const store = new SupabaseRuntimeStore(rest as unknown as OfficialSupabaseRest, attachment);
  const lease = await store.acquireInbound(inbound());

  assertEquals(lease.received_document?.documento_id, "doc-1");
  const call = rest.calls[0];
  assertEquals(call?.name, "support_runtime_acquire_inbound");
  assertEquals(call?.body.p_metadata, { source: "wapi", safe: true });
  assertEquals(JSON.stringify(call?.body).includes("secret-media-key"), false);
  assertEquals(JSON.stringify(call?.body).includes("private-file"), false);
});

Deno.test("official store maps a committed turn to one service-only RPC", async () => {
  const rest = new FakeRest();
  const store = new SupabaseRuntimeStore(rest as unknown as OfficialSupabaseRest, null);
  const commit: RuntimeCommit = {
    conversation_id: "11111111-2222-4333-8444-555555555555",
    inbound_message_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    expected_revision: 0,
    catalog_hash: "a".repeat(64),
    state_hash: "b".repeat(64),
    state: {
      schema_version: "santana-conversation-state/v1",
      conversation_id: "11111111-2222-4333-8444-555555555555",
      seq: 0,
      cases: [],
      goals: [],
      facts: [],
      pending_question: null,
      parked_questions: [],
      pending_actions: [],
      forbidden_goals: [],
      handoff: null,
      event_log: [],
      solicitacoes: [],
      documentos: [],
      acoes: [],
      acompanhamentos: [],
      current_topic: null,
      origin_topic: null,
    },
    outcome: "PROPOSED",
    event_kind: null,
    reply_body: "Olá",
    projection: {
      subject: "nao_classificado",
      stage: "novos",
      automation_mode: "bot",
      flow_state: {},
    },
  };

  const result = await store.commitTurn(commit);

  assertEquals(result, { replayed: false, revision: 1, outbox_id: "outbox-1" });
  assertEquals(rest.calls[0]?.name, "support_runtime_commit_turn");
  assertEquals(rest.calls[0]?.body.p_state_hash, "b".repeat(64));
});
