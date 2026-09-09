import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { ControlledLlmAdapter } from "../adapter/adapter.ts";
import {
  processOfficialTurn,
  type RuntimeCommit,
  type RuntimeInbound,
  type RuntimeLease,
  type RuntimeStore,
} from "../official_turn_service.ts";
import { initState } from "../../engine/engine.ts";

class MemoryStore implements RuntimeStore {
  state: unknown | null = null;
  revision = 0;
  catalogHash: string | null = null;
  duplicate = false;
  automation: RuntimeLease["automation_mode"] = "BOT_ACTIVE";
  commits: RuntimeCommit[] = [];

  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    this.catalogHash ??= input.catalog_hash;
    return Promise.resolve({
      duplicate: this.duplicate,
      conversation_id: "11111111-2222-4333-8444-555555555555",
      inbound_message_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      revision: this.revision,
      automation_mode: this.automation,
      catalog_hash: this.catalogHash,
      state: this.state,
    });
  }

  commitTurn(input: RuntimeCommit) {
    if (input.expected_revision !== this.revision) throw new Error("conversation revision moved");
    this.state = structuredClone(input.state);
    this.revision += 1;
    this.commits.push(input);
    return Promise.resolve({
      replayed: false,
      revision: this.revision,
      outbox_id: input.reply_body ? "outbox-1" : null,
    });
  }
}

const deterministicAdapter = new ControlledLlmAdapter({
  enabled: false,
  provider: {
    name: "test",
    model: "test",
    createRequest: () => ({ url: "https://invalid.local", headers: {}, body: "" }),
    extractText: () => "{}",
  },
  network: () => Promise.resolve({ status: 500, body: "" }),
});

const automaticReplies = { automatic_replies_allowed: true } as const;

function inbound(body: string): RuntimeInbound {
  return {
    external_message_id: "wapi-test-1",
    phone_e164: "+5511959805497",
    contact_name: "Teste autorizado",
    body,
    message_type: "text",
  };
}

Deno.test("official runtime commits state and outbox only after a fluid jazigo turn is planned", async () => {
  const store = new MemoryStore();
  const result = await processOfficialTurn(
    inbound("Meu jazigo está violado"),
    store,
    deterministicAdapter,
    automaticReplies,
  );

  assertEquals(result.kind, "COMMITTED");
  assert(result.reply_body?.includes("ocorrência relatada"));
  assertEquals(result.outbox_id, "outbox-1");
  assertEquals(store.commits.length, 1);
  assertEquals(store.commits[0]?.projection.subject, "comercial");
  assertEquals(store.commits[0]?.projection.automation_mode, "bot");
  assert(store.commits[0]?.state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS"));
  assert(store.commits[0]?.state.goals.some((goal) => goal.goal_code === "GOAL_RECLAMACAO"));
});

Deno.test("official runtime routes a human-owned conversation without an automatic reply", async () => {
  const store = new MemoryStore();
  store.automation = "HUMAN_ACTIVE";
  store.state = initState("11111111-2222-4333-8444-555555555555");
  const result = await processOfficialTurn(inbound("Preciso de ajuda"), store, deterministicAdapter, automaticReplies);

  assertEquals(result.kind, "HUMAN_ACTIVE");
  assertEquals(result.reply_body, null);
  assertEquals(result.outbox_id, null);
  assertEquals(store.commits.length, 1);
  assertEquals(store.commits[0]?.reply_body, null);
});

Deno.test("official runtime never reinterprets an already persisted inbound message", async () => {
  const store = new MemoryStore();
  store.duplicate = true;
  const result = await processOfficialTurn(
    inbound("Meu jazigo está violado"),
    store,
    deterministicAdapter,
    automaticReplies,
  );
  assertEquals(result.kind, "DUPLICATE");
  assertEquals(store.commits.length, 0);
});

Deno.test("official runtime refuses invalid persisted state instead of silently resetting history", async () => {
  const store = new MemoryStore();
  store.state = { conversation_id: "11111111-2222-4333-8444-555555555555" };
  await assertRejects(
    () => processOfficialTurn(inbound("Meu jazigo está violado"), store, deterministicAdapter, automaticReplies),
    /persisted conversation state is invalid/,
  );
});

Deno.test("official runtime reopens only a legacy auto-resolved jazigo triage on its next safe turn", async () => {
  const store = new MemoryStore();
  const legacy = initState("11111111-2222-4333-8444-555555555555");
  legacy.goals.push({
    goal_id: "g001",
    goal_code: "GOAL_JAZIGO_SERVICOS",
    case_id: "case001",
    status: "RESOLVED",
    status_reason: null,
    parent_goal_id: null,
    overlay_of: null,
    stack_index: 0,
    informational: false,
    return_to_parent: false,
    opened_at_seq: 1,
    closed_at_seq: 1,
    created_by_relation: null,
  });
  legacy.cases.push({ case_id: "case001", subject_kind: "GRAVE", subject_ref: "legacy-grave", opened_at_seq: 1 });
  legacy.facts.push({
    fact_id: "f001",
    fact_code: "grave_service_description",
    case_id: "case001",
    goal_id: null,
    value: "Meu jazigo está violado",
    source: "USER_EXPLICIT",
    confidence: "CONFIRMED",
    status: "ACTIVE",
    recorded_at_seq: 1,
    superseded_by: null,
    superseded_at_seq: null,
    supersession_reason: null,
    conflicts_with: null,
    authoritative: false,
    derived_from: [],
  });
  store.state = legacy;

  const result = await processOfficialTurn(
    inbound("Quadra 3, jazigo 18"),
    store,
    deterministicAdapter,
    automaticReplies,
  );

  assertEquals(result.kind, "COMMITTED");
  const base = store.commits[0]?.state.goals.find((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS");
  assertEquals(base?.status, "ACTIVE");
  assertEquals(store.commits[0]?.state.current_topic, "JAZIGO_SERVICOS");
  assert(result.reply_body?.includes("referência informada"));
});

Deno.test("official runtime records a stored attachment without treating it as validated", async () => {
  const store = new MemoryStore();
  const originalAcquire = store.acquireInbound.bind(store);
  store.acquireInbound = async (input) => ({
    ...await originalAcquire(input),
    received_document: {
      documento_id: "doc-attachment-1",
      tipo: "application/pdf",
      descricao: "declaracao.pdf",
      recebido_em: "2026-09-08T15:00:00.000Z",
    },
  });

  const result = await processOfficialTurn(
    inbound("Meu jazigo está violado"),
    store,
    deterministicAdapter,
    automaticReplies,
  );

  assert(result.reply_body?.startsWith("Arquivo recebido e preservado."));
  const document = store.commits[0]?.state.documentos?.[0];
  assertEquals(document?.estado, "RECEBIDO");
  assertEquals(document?.aceito_por, undefined);
  assertEquals(document?.descricao, "declaracao.pdf");
});

Deno.test("a human-owned conversation preserves an attachment but emits no bot reply", async () => {
  const store = new MemoryStore();
  store.automation = "HUMAN_ACTIVE";
  store.state = initState("11111111-2222-4333-8444-555555555555");
  const originalAcquire = store.acquireInbound.bind(store);
  store.acquireInbound = async (input) => ({
    ...await originalAcquire(input),
    received_document: {
      documento_id: "doc-attachment-human",
      tipo: "image/jpeg",
      descricao: "foto.jpg",
      recebido_em: "2026-09-08T15:00:00.000Z",
    },
  });

  const result = await processOfficialTurn(
    inbound("[Arquivo recebido: foto.jpg]"),
    store,
    deterministicAdapter,
    automaticReplies,
  );

  assertEquals(result.kind, "HUMAN_ACTIVE");
  assertEquals(result.reply_body, null);
  assertEquals(store.commits[0]?.state.documentos?.[0]?.estado, "RECEBIDO");
});

Deno.test("an attachment storage failure is transparent, retains the active triage and never claims validation", async () => {
  const store = new MemoryStore();
  const originalAcquire = store.acquireInbound.bind(store);
  store.acquireInbound = async (input) => ({
    ...await originalAcquire(input),
    attachment_failure: "ATTACHMENT_DOWNLOAD_FAILED",
  });

  const result = await processOfficialTurn(
    inbound("Meu jazigo está violado"),
    store,
    deterministicAdapter,
    automaticReplies,
  );

  assert(result.reply_body?.includes("não consegui armazenar o arquivo"));
  assert(result.reply_body?.includes("ocorrência relatada"));
  assert(!result.reply_body?.includes("validaç"));
  assertEquals(store.commits[0]?.state.documentos?.length, 0);
  assertEquals(store.commits[0]?.state.handoff, null);
});

Deno.test("official runtime persists a non-canary inbound as human-owned without interpreting or enqueueing", async () => {
  const store = new MemoryStore();
  let interpretations = 0;
  const forbiddenInterpreter = {
    interpret: () => {
      interpretations += 1;
      return Promise.reject(new Error("interpreter must not run for a blocked canary"));
    },
  };

  const result = await processOfficialTurn(
    inbound("Preciso de atendimento"),
    store,
    forbiddenInterpreter,
    { automatic_replies_allowed: false },
  );

  assertEquals(result.kind, "HUMAN_ACTIVE");
  assertEquals(result.reply_body, null);
  assertEquals(result.outbox_id, null);
  assertEquals(interpretations, 0);
  assertEquals(store.commits.length, 1);
  assertEquals(store.commits[0]?.outcome, "HUMAN_ACTIVE");
  assertEquals(store.commits[0]?.projection.automation_mode, "human");
});

Deno.test("official runtime returns the committed protocol text rather than the pre-commit draft", async () => {
  const memory = new MemoryStore();
  const committedBody = "Recebi seu pedido. Protocolo do atendimento: SAN-TESTE-001.";
  const store: RuntimeStore = {
    acquireInbound: (input) => memory.acquireInbound(input),
    commitTurn: async (input) => ({ ...await memory.commitTurn(input), reply_body: committedBody }),
  };
  const result = await processOfficialTurn(
    inbound("Meu jazigo está violado"),
    store,
    deterministicAdapter,
    automaticReplies,
  );
  assertEquals(result.reply_body, committedBody);
  assert(result.reply_body !== memory.commits[0]?.reply_body);
});
