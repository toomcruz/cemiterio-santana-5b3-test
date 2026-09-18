import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("B2 proposal targets the existing support_runtime boundary", async () => {
  const sql = await readFile(resolve(root, "database/migrations/0027_sana_v1_binding_ledger_proposal.sql"), "utf8");
  assert.doesNotMatch(sql, /create schema if not exists sana_runtime/i);
  assert.match(sql, /support_runtime\.subject_bindings/i);
  assert.match(sql, /foreign key \(conversation_id, inbound_message_id\)/i);
  assert.match(sql, /foreign key \(conversation_id, binding_id\)/i);
  assert.match(sql, /on delete restrict/i);
  assert.match(sql, /materialize_bindings/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /REQUIRED CODE INTEGRATION/i);
  assert.doesNotMatch(sql, /drop table|drop schema|delete from/i);
});

test("B6 lifecycle contract keeps human mode and session/process boundaries", async () => {
  const doc = await readFile(resolve(root, "docs/SANA-V1-LIFECYCLE-CONTRACT.md"), "utf8");
  for (const term of [
    "FOCUS_CASE",
    "RESUME_CASE",
    "ACTIVE",
    "WAITING",
    "SUSPENDED",
    "CLOSED",
    "HUMAN_ACTIVE",
    "expected_control_version",
    "não fecha processo",
    "nunca reativa o bot",
  ]) assert.match(doc, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});
