import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import {
  currentCatalogHash,
  hydratePersistedState,
  prepareTransition,
} from "../server_transition.ts";
import { planTurn } from "../turn.ts";

const conversationId = "7e764b29-7e0c-4b66-9474-000000000001";
const inboundMessageId = "7e764b29-7e0c-4b66-9474-000000000002";

Deno.test("server transition turns an official jazigo complaint into one atomic database payload", async () => {
  const persisted = { exists: false, seq: 0 };
  const hydrated = hydratePersistedState(persisted, conversationId);
  const plan = await planTurn({
    message_id: inboundMessageId,
    text: "Meu jazigo está violado",
    state: hydrated.state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(plan.outcome, "PROPOSED");
  const prepared = await prepareTransition({
    persisted,
    previous: hydrated.state,
    next: plan.next_state,
    event_kind: plan.interpretation?.primary_event?.event_kind ?? "UNCERTAIN",
    identity_secret: "laboratory-identity-secret",
    identity_key_version: 1,
    inbound_message_id: inboundMessageId,
    correlation_id: "7e764b29-7e0c-4b66-9474-000000000003",
  });

  assertEquals(prepared.expected_seq, 0);
  assertEquals(prepared.transition.event_kind, "COMPLAINT");
  assertEquals(prepared.transition.catalog_hash.length, 64);
  assertEquals(prepared.transition.state_hash.length, 64);
  assertEquals(prepared.idempotency_key.length, 64);
  assert(prepared.transition.ops.some((op) => op.op === "open_case" && op.subject_kind === "GRAVE"));
  assert(prepared.transition.ops.some((op) => op.op === "push_goal" && op.goal_code === "GOAL_JAZIGO_SERVICOS"));
  assert(prepared.transition.ops.some((op) => op.op === "push_goal" && op.goal_code === "GOAL_RECLAMACAO"));
  const facts = prepared.transition.ops.filter((op) => op.op === "record_fact");
  assertEquals(facts.length, 2);
  assert(facts.every((op) => op.inbound_message_id === inboundMessageId));
  assert(facts.every((op) => op.authoritative === false));
});

Deno.test("server transition rejects a persisted state from another catalog before writing", async () => {
  const catalogHash = await currentCatalogHash();
  const state = initState(conversationId);
  await assertRejects(
    () => prepareTransition({
      persisted: { exists: true, seq: 4, catalog_hash: "0".repeat(64) },
      previous: state,
      next: state,
      event_kind: "SOCIAL",
      identity_secret: "laboratory-identity-secret",
      identity_key_version: 1,
    }),
    /catalog hash mismatch/,
  );
  assertEquals(catalogHash.length, 64);
});
