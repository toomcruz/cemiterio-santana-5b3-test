import { assert, assertEquals } from "../fixtures/assert.ts";
import { ids } from "../fixtures/ids.ts";
import { batchFixture, stateFixture, taxonomyFixture } from "../fixtures/state.ts";
import { classifyDeterministically } from "../../edge-functions/support-classifier/index.ts";

Deno.test("classifier uses pending state before interpreting Sim", async () => {
  const state = stateFixture({
    pending_confirmation: { confirmation_id: ids.confirmation, confirmation_nonce: ids.nonce, topic_id: ids.topic, expires_at: "2026-08-14T13:00:00.000Z", status: "PENDING" },
  });
  const output = await classifyDeterministically({
    schema_version: "1.0", correlation_id: ids.decision, release_id: ids.release, state, taxonomy: taxonomyFixture(),
    message_batch: batchFixture("sim"), technical_signals: { duplicate: false, human_active: false, provider_window_open: true, inbound_source: "WAPI" },
  });
  assertEquals(output.message_role, "CONFIRMATION_AFFIRMATIVE");
  assert(output.evidence.some((item) => item.kind === "PENDING_QUESTION"));
});

Deno.test("classifier blocks automatic handling while human is active", async () => {
  const output = await classifyDeterministically({
    schema_version: "1.0", correlation_id: ids.decision, release_id: ids.release,
    state: stateFixture({ automation_mode: "HUMAN_ACTIVE", human_handoff_active: true }), taxonomy: taxonomyFixture(),
    message_batch: batchFixture("quero recadastro"), technical_signals: { duplicate: false, human_active: true, provider_window_open: true, inbound_source: "WAPI" },
  });
  assertEquals(output.classification_status, "BLOCKED");
  assertEquals(output.ambiguity_codes, ["HUMAN_ACTIVE"]);
});

Deno.test("classifier recognizes internal complaint intent without creating a request", async () => {
  const output = await classifyDeterministically({
    schema_version: "1.0", correlation_id: ids.decision, release_id: ids.release, state: stateFixture({ active_topic: null }), taxonomy: taxonomyFixture(),
    message_batch: batchFixture("Quero fazer uma reclamação sobre o atendimento"), technical_signals: { duplicate: false, human_active: false, provider_window_open: true, inbound_source: "WAPI" },
  });
  assertEquals(output.intent_candidates[0]?.code, "RECLAMACAO_INTERNA");
  assertEquals(output.complaint_signal, true);
});

Deno.test("ambiguous batch returns no response text and no invented classification", async () => {
  const output = await classifyDeterministically({
    schema_version: "1.0", correlation_id: ids.decision, release_id: ids.release, state: stateFixture({ active_topic: null }), taxonomy: taxonomyFixture(),
    message_batch: batchFixture("olá"), technical_signals: { duplicate: false, human_active: false, provider_window_open: true, inbound_source: "WAPI" },
  });
  assertEquals(output.classification_status, "AMBIGUOUS");
  assertEquals(output.ambiguity_codes, ["NO_CONFIDENT_SERVICE_OR_INTENT"]);
  assert(!("body" in output));
});

Deno.test("aggregated batch drives topic change without discarding the old topic", async () => {
  const output = await classifyDeterministically({
    schema_version: "1.0", correlation_id: ids.decision, release_id: ids.release, state: stateFixture(), taxonomy: taxonomyFixture(),
    message_batch: batchFixture("agora preciso de exumação", { message_ids: [ids.message, "12121212-1212-4121-8121-121212121212"], quiet_seconds: 7 }),
    technical_signals: { duplicate: false, human_active: false, provider_window_open: true, inbound_source: "WAPI" },
  });
  assertEquals(output.topic_transition_candidate, "START_NEW");
  assertEquals(output.message_role, "TOPIC_CHANGE");
  assertEquals(output.service_candidates[0]?.code, "EXUMACAO");
});
