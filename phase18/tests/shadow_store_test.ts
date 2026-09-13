import { assertEquals, assertRejects } from "jsr:@std/assert";
import { DurableShadowStore } from "../shadow/store.ts";
import type { ShadowComparisonRecord } from "../shadow/types.ts";

function record(eventId: string, inputHash: string): ShadowComparisonRecord {
  const emptyReply = {
    sha256: "a".repeat(64),
    characters: 0,
    question_count: 0,
    menu_signal: false,
    completion_claim_signal: false,
  };
  const engine = {
    engine: "test",
    recognized_intents: [],
    journeys: [],
    transverse_states: [],
    intent_changed: false,
    risk_level: "none",
    risk_signals: [],
    reused_fact_keys: [],
    asked_fact_keys: [],
    actions_proposed: [],
    actions_executed_real: [] as [],
    claim_codes: [],
    blocked_claim_codes: [],
    current_policy_refs: [],
    policy_gaps: [],
    handoff: {
      offered: false,
      priority: "none" as const,
      reason: "none",
      payload_fields: [],
      accepted: "unknown" as const,
    },
    would_call: [],
    receipts_required: [],
    receipts_observed: [] as [],
    tracks: {},
    case_closed: false,
    closure_basis: [],
    reply: emptyReply,
    latency_ms: 0,
    provider: null,
  };
  return {
    schema_version: "phase18-shadow-record/1.2.0",
    mode: "OFFLINE_REPLAY",
    event_id: eventId,
    episode_id: "episode_test",
    input_hash: inputHash,
    cohort_id: "cohort_test",
    cohort_hash: "c".repeat(64),
    source_snapshot_sha256: "d".repeat(64),
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T01:00:00Z",
    decision_at: "2026-01-01T00:30:00Z",
    decision_input_message_count: 1,
    observed_followup_count: 0,
    post_observation_tail_count: 0,
    source_message_count: 1,
    reference: {
      source: "phase11_heuristic_recomputed_on_decision_window",
      scope: "decision_input_prefix_only",
      human_validated: false,
      journeys: [],
      subintents: [],
      transverse_states: [],
      intent_changed: false,
      multi_intent: false,
      handoff_observed: false,
      possible_abandonment: false,
      resolution_apparent: false,
      risk_flags: [],
    },
    observed_current: {
      inbound_count: 1,
      outbound_count: 0,
      last_direction: "inbound",
      observed_handoff_signal: false,
      observed_menu_signal: false,
      observed_completion_claim_signal: false,
      last_outbound_reply: null,
      raw_content_persisted: false,
    },
    current_workflow_replay: engine,
    motor_v2_shadow: engine,
    divergence_codes: [],
    candidate_evidence: [],
    zero_effects: {
      network_allowed: false,
      production_adapters_loaded: false,
      real_messages_sent: 0,
      real_tools_executed: 0,
      official_state_writes: 0,
      simulated_current_outbox_only: true,
    },
    provenance: {
      input_source: "immutable_whatsapp_snapshot",
      current_result_kind: "isolated_current_workflow_replay",
      v2_result_kind: "offline_shadow_proposal",
      reference_kind: "unreviewed_window_aligned_heuristic_candidate_evidence",
    },
  };
}

Deno.test("durable shadow store survives reopen and exact replay is idempotent", async () => {
  const root = await Deno.makeTempDir();
  try {
    const eventId = "shadow_event_abcdefgh";
    const inputHash = "b".repeat(64);
    const first = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    assertEquals(
      (await first.commit(eventId, inputHash, record(eventId, inputHash), "2026-01-01T01:00:00Z")).duplicate,
      false,
    );
    const reopened = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    assertEquals(
      (await reopened.commit(eventId, inputHash, record(eventId, inputHash), "2026-01-01T01:00:00Z")).duplicate,
      true,
    );
    assertEquals((await reopened.checkpoint()).completed_count, 1);
    assertEquals((await reopened.list()).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("same event id with different input fails closed", async () => {
  const root = await Deno.makeTempDir();
  try {
    const eventId = "shadow_event_abcdefgh";
    const store = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    await store.commit(eventId, "b".repeat(64), record(eventId, "b".repeat(64)), "2026-01-01T01:00:00Z");
    await assertRejects(
      () => store.commit(eventId, "e".repeat(64), record(eventId, "e".repeat(64)), "2026-01-01T01:00:00Z"),
      Error,
      "reused with different content",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("concurrent conflicting commits serialize and fail closed", async () => {
  const root = await Deno.makeTempDir();
  try {
    const eventId = "shadow_event_concurrent";
    const firstHash = "b".repeat(64);
    const secondHash = "e".repeat(64);
    const store = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    const settled = await Promise.allSettled([
      store.commit(eventId, firstHash, record(eventId, firstHash), "2026-01-01T01:00:00Z"),
      store.commit(eventId, secondHash, record(eventId, secondHash), "2026-01-01T01:00:00Z"),
    ]);
    assertEquals(settled.filter((result) => result.status === "fulfilled").length, 1);
    assertEquals(settled.filter((result) => result.status === "rejected").length, 1);
    assertEquals((await store.list()).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("opened store rejects a persisted record from another cohort", async () => {
  const root = await Deno.makeTempDir();
  try {
    const eventId = "shadow_event_cohortbind";
    const inputHash = "b".repeat(64);
    const first = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    await first.commit(eventId, inputHash, record(eventId, inputHash), "2026-01-01T01:00:00Z");
    await assertRejects(
      () => DurableShadowStore.open(root, "cohort_other", "d".repeat(64)),
      Error,
      "belongs to another cohort",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("checkpoint is reconstructed from complete records and ignores temporary files", async () => {
  const root = await Deno.makeTempDir();
  try {
    const store = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    for (const suffix of ["abcdefgh", "ijklmnop"]) {
      const eventId = `shadow_event_${suffix}`;
      const inputHash = suffix === "abcdefgh" ? "b".repeat(64) : "e".repeat(64);
      await store.commit(eventId, inputHash, record(eventId, inputHash), "2026-01-01T01:00:00Z");
    }
    await Deno.writeTextFile(`${root}/records/interrupted.tmp.deadbeef`, "partial");
    const reopened = await DurableShadowStore.open(root, "cohort_test", "c".repeat(64));
    assertEquals((await reopened.checkpoint()).completed_count, 2);
    assertEquals((await reopened.list()).length, 2);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
