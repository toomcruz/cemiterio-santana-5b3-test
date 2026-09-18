import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function openRuntime(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS conversation_state (
      conversation_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      automation_mode TEXT NOT NULL CHECK (automation_mode IN ('bot','human')),
      control_version TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      state_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inbound_receipts (
      inbound_message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation_state(conversation_id),
      external_message_id TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('RECEIVED','COMMITTED','HUMAN_ACTIVE')),
      UNIQUE (conversation_id, inbound_message_id)
    );
    CREATE TABLE IF NOT EXISTS subject_bindings (
      conversation_id TEXT NOT NULL REFERENCES conversation_state(conversation_id),
      binding_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE','INVALIDATED','REPLACED')),
      PRIMARY KEY (conversation_id, binding_id),
      UNIQUE (conversation_id, subject_key, lifecycle)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_subject ON subject_bindings(conversation_id, subject_key) WHERE lifecycle = 'ACTIVE';
    CREATE TABLE IF NOT EXISTS outbound_queue (
      outbox_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation_state(conversation_id),
      inbound_message_id TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED'))
    );
    CREATE TABLE IF NOT EXISTS turn_events (
      event_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      inbound_message_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event_kind TEXT NOT NULL,
      binding_id TEXT,
      outbox_id TEXT,
      UNIQUE (conversation_id, revision),
      UNIQUE (inbound_message_id),
      FOREIGN KEY (conversation_id, inbound_message_id)
        REFERENCES inbound_receipts(conversation_id, inbound_message_id),
      FOREIGN KEY (conversation_id, binding_id)
        REFERENCES subject_bindings(conversation_id, binding_id),
      FOREIGN KEY (outbox_id) REFERENCES outbound_queue(outbox_id)
    );
  `);
  if (!db.prepare("SELECT 1 FROM conversation_state WHERE conversation_id = 'conv-1'").get()) {
    db.prepare("INSERT INTO conversation_state VALUES (?, 0, 'bot', ?, 's0', ?)")
      .run("conv-1", "control-0", JSON.stringify({ seq: 0, lifecycle: "ACTIVE" }));
  }
  return db;
}

function acquire(db, { externalId, messageId = `msg:${externalId}`, body, contentHash = "h1" }) {
  const existing = db.prepare("SELECT * FROM inbound_receipts WHERE external_message_id = ?").get(externalId);
  if (existing) {
    if (existing.content_hash !== contentHash) throw new Error("EXTERNAL_MESSAGE_CONTENT_COLLISION");
    return { duplicate: true, ...existing };
  }
  db.prepare("INSERT INTO inbound_receipts VALUES (?, 'conv-1', ?, ?, 'RECEIVED')")
    .run(messageId, externalId, contentHash);
  return { duplicate: false, inboundMessageId: messageId, body };
}

function commit(db, input, fault = null) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = db.prepare("SELECT * FROM conversation_state WHERE conversation_id = ?").get(input.conversationId);
    if (!state) throw new Error("CONVERSATION_NOT_FOUND");
    if (state.automation_mode !== "bot") throw new Error("HUMAN_ACTIVE");
    const replay = db.prepare("SELECT * FROM turn_events WHERE inbound_message_id = ?").get(input.inboundMessageId);
    if (replay) {
      if (replay.event_kind !== input.eventKind || replay.binding_id !== (input.bindingId ?? null)) {
        throw new Error("REPLAY_PAYLOAD_MISMATCH");
      }
      db.exec("COMMIT");
      return { replayed: true, revision: replay.revision };
    }
    if (state.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
    const next = state.revision + 1;
    if (input.bindingId) {
      const binding = db.prepare("SELECT * FROM subject_bindings WHERE conversation_id = ? AND binding_id = ? AND lifecycle = 'ACTIVE'")
        .get(input.conversationId, input.bindingId);
      if (!binding && (!input.binding || input.binding.bindingId !== input.bindingId)) {
        throw new Error("BINDING_NOT_ACTIVE_OR_CROSS_CONVERSATION");
      }
    }
    db.prepare("UPDATE conversation_state SET revision = ?, state_hash = ?, state_json = ? WHERE conversation_id = ?")
      .run(next, input.stateHash, JSON.stringify(input.state), input.conversationId);
    if (fault === "after-state") throw new Error("INJECTED_AFTER_STATE");
    if (input.binding && !db.prepare("SELECT 1 FROM subject_bindings WHERE conversation_id = ? AND binding_id = ?").get(input.conversationId, input.binding.bindingId)) {
      db.prepare("INSERT INTO subject_bindings VALUES (?, ?, ?, ?, 'ACTIVE')")
        .run(input.conversationId, input.binding.bindingId, input.binding.caseId, input.binding.subjectKey);
    }
    if (fault === "after-binding") throw new Error("INJECTED_AFTER_BINDING");
    db.prepare("INSERT INTO outbound_queue VALUES (?, ?, ?, ?, 'PENDING')")
      .run(input.outboxId, input.conversationId, input.inboundMessageId, input.reply);
    if (fault === "after-outbox") throw new Error("INJECTED_AFTER_OUTBOX");
    db.prepare("INSERT INTO turn_events VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.eventId, input.conversationId, input.inboundMessageId, next, input.eventKind, input.bindingId ?? null, input.outboxId);
    db.prepare("UPDATE inbound_receipts SET status = 'COMMITTED' WHERE inbound_message_id = ?")
      .run(input.inboundMessageId);
    if (fault === "after-receipt") throw new Error("INJECTED_AFTER_RECEIPT");
    db.exec("COMMIT");
    return { replayed: false, revision: next };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function base(overrides = {}) {
  return {
    conversationId: "conv-1",
    inboundMessageId: "msg:1",
    expectedRevision: 0,
    stateHash: "s1",
    state: { seq: 1, lifecycle: "ACTIVE", event: "FOCUS_CASE" },
    eventId: "event:1",
    eventKind: "FOCUS_CASE",
    bindingId: "binding:mother",
    binding: { bindingId: "binding:mother", caseId: "case:mother", subjectKey: "minha mae" },
    outboxId: "outbox:1",
    reply: "Qual e o local do sepultamento?",
    ...overrides,
  };
}

function runTurn(db, input, fault = null) {
  acquire(db, { externalId: input.inboundMessageId, messageId: input.inboundMessageId, body: "turn", contentHash: input.inboundMessageId });
  return commit(db, input, fault);
}

function claimDelivery(db, outboxId) {
  const row = db.prepare(`
    SELECT q.*, c.automation_mode
      FROM outbound_queue q JOIN conversation_state c USING (conversation_id)
     WHERE q.outbox_id = ?
  `).get(outboxId);
  if (!row) throw new Error("OUTBOX_NOT_FOUND");
  if (row.automation_mode !== "bot") {
    db.prepare("UPDATE outbound_queue SET status = 'CANCELLED' WHERE outbox_id = ? AND status = 'PENDING'").run(outboxId);
    return { claimed: false, status: "CANCELLED" };
  }
  if (row.status !== "PENDING") return { claimed: false, status: row.status };
  db.prepare("UPDATE outbound_queue SET status = 'PROCESSING' WHERE outbox_id = ?").run(outboxId);
  return { claimed: true, status: "PROCESSING" };
}

test("LAB commit atomically persists state, binding, receipt, event and outbox", () => {
  const db = openRuntime();
  const result = runTurn(db, base());
  assert.deepEqual(result, { replayed: false, revision: 1 });
  assert.equal(db.prepare("SELECT revision FROM conversation_state").get().revision, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM subject_bindings").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM turn_events").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM outbound_queue").get().n, 1);
  assert.equal(db.prepare("SELECT status FROM inbound_receipts").get().status, "COMMITTED");
});

test("fault injection rolls back every commit boundary", () => {
  for (const fault of ["after-state", "after-binding", "after-outbox", "after-receipt"]) {
    const db = openRuntime();
    assert.throws(() => runTurn(db, base(), fault), new RegExp(`INJECTED_${fault.replaceAll("-", "_").toUpperCase()}`));
    assert.equal(db.prepare("SELECT revision FROM conversation_state").get().revision, 0, fault);
    assert.equal(db.prepare("SELECT count(*) AS n FROM subject_bindings").get().n, 0, fault);
    assert.equal(db.prepare("SELECT count(*) AS n FROM turn_events").get().n, 0, fault);
    assert.equal(db.prepare("SELECT count(*) AS n FROM outbound_queue").get().n, 0, fault);
  }
});

test("replay is idempotent and divergent payload fails", () => {
  const db = openRuntime();
  runTurn(db, base());
  assert.deepEqual(runTurn(db, base()), { replayed: true, revision: 1 });
  assert.throws(() => runTurn(db, base({ eventKind: "RESUME_CASE" })), /REPLAY_PAYLOAD_MISMATCH/);
  assert.equal(db.prepare("SELECT revision FROM conversation_state").get().revision, 1);
});

test("duplicate inbound is accepted once and content collision fails", () => {
  const db = openRuntime();
  assert.equal(acquire(db, { externalId: "wa-1", body: "oi" }).duplicate, false);
  assert.equal(acquire(db, { externalId: "wa-1", body: "oi" }).duplicate, true);
  assert.throws(() => acquire(db, { externalId: "wa-1", body: "alterado", contentHash: "h2" }), /CONTENT_COLLISION/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM inbound_receipts").get().n, 1);
});

test("composite receipt and binding FKs reject cross-conversation association", () => {
  const db = openRuntime();
  assert.throws(() => db.prepare("INSERT INTO turn_events VALUES ('e', 'conv-other', 'msg:none', 1, 'FOCUS_CASE', 'binding:none', NULL)").run(), /FOREIGN KEY/);
  assert.throws(() => commit(db, base({ bindingId: "binding:missing", binding: null })), /BINDING_NOT_ACTIVE/);
});

test("revision conflict models concurrent workers without double effects", () => {
  const db = openRuntime();
  runTurn(db, base());
  assert.throws(() => runTurn(db, base({ inboundMessageId: "msg:2", eventId: "event:2", outboxId: "outbox:2", expectedRevision: 0, stateHash: "s2" })), /REVISION_CONFLICT/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM outbound_queue").get().n, 1);
});

test("human takeover blocks a bot commit until explicit resume control", () => {
  const db = openRuntime();
  db.prepare("UPDATE conversation_state SET automation_mode = 'human', control_version = 'control-human' WHERE conversation_id = 'conv-1'").run();
  assert.equal(db.prepare("SELECT automation_mode FROM conversation_state").get().automation_mode, "human");
  assert.throws(() => commit(db, base({ inboundMessageId: "msg:human", eventId: "event:human", outboxId: "outbox:human" })), /HUMAN_ACTIVE/);
  const control = db.prepare("SELECT control_version FROM conversation_state").get().control_version;
  assert.equal(control, "control-human");
});

test("worker revalidates human takeover before sending queued output", () => {
  const db = openRuntime();
  runTurn(db, base());
  db.prepare("UPDATE conversation_state SET automation_mode = 'human', control_version = 'control-human' WHERE conversation_id = 'conv-1'").run();
  assert.deepEqual(claimDelivery(db, "outbox:1"), { claimed: false, status: "CANCELLED" });
  assert.equal(db.prepare("SELECT status FROM outbound_queue WHERE outbox_id = 'outbox:1'").get().status, "CANCELLED");
});

test("restart preserves revision, binding, receipt and pending outbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "sana-v1-runtime-"));
  const file = join(dir, "runtime.sqlite");
  try {
    const first = openRuntime(file);
    runTurn(first, base());
    first.close();
    const restarted = openRuntime(file);
    assert.equal(restarted.prepare("SELECT revision FROM conversation_state").get().revision, 1);
    assert.equal(restarted.prepare("SELECT binding_id FROM subject_bindings").get().binding_id, "binding:mother");
    assert.equal(restarted.prepare("SELECT status FROM inbound_receipts").get().status, "COMMITTED");
    assert.equal(restarted.prepare("SELECT status FROM outbound_queue").get().status, "PENDING");
    restarted.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
