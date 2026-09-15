import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { applyEvent, type ConversationState, initState } from "../../../santana-conversation-domain/engine/engine.ts";
import { currentCatalogHash } from "../../../santana-conversation-domain/runtime/server_transition.ts";
import { HttpProblem } from "../http.ts";
import { processOfficialOperator } from "../official-operator.ts";
import { OfficialSupabaseRest } from "../official-rest.ts";

const CONVERSATION = "33333333-3333-4333-a333-333333333333";
const COMMAND = "44444444-4444-4444-a444-444444444444";
const ACTOR = "55555555-5555-4555-a555-555555555555";
const CONTROL_VERSION = "2026-09-15T15:07:07.639798+00:00";
const NON_CANARY_PHONE = "+5511987654321";
const CANARY_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type Call = { route: string; body: Record<string, unknown> };

async function harness(state: ConversationState) {
  const calls: Call[] = [];
  const catalogHash = await currentCatalogHash();
  const fetcher: typeof fetch = (input, init) => {
    const route = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ route, body });
    if (route === "/auth/v1/user") return Promise.resolve(Response.json({ id: ACTOR }));
    if (route.endsWith("support_runtime_operator_snapshot")) {
      return Promise.resolve(Response.json({
        state,
        revision: 7,
        catalog_hash: catalogHash,
        automation_mode: "human",
        control_version: CONTROL_VERSION,
        phone_e164: NON_CANARY_PHONE,
        requests: [],
      }));
    }
    if (route.endsWith("support_runtime_operator_replay")) {
      return Promise.resolve(Response.json({ replayed: false, revision: 7 }));
    }
    if (route.endsWith("support_runtime_commit_operator")) {
      return Promise.resolve(Response.json({
        ok: true,
        command: "RESUME",
        command_id: COMMAND,
        revision: 8,
        control_version: "2026-09-15T15:07:08.639798+00:00",
        automation_mode: "bot",
        outbox_id: null,
      }));
    }
    return Promise.reject(new Error(`unexpected transport route ${route}`));
  };
  const rest = new OfficialSupabaseRest({
    url: "https://supabase.invalid",
    serviceRoleKey: "fixture-service",
    fetcher,
  });
  const request = new Request("https://runtime.invalid", {
    headers: { authorization: "Bearer fixture-user" },
  });
  return { calls, rest, request };
}

function resumeEnvelope() {
  return {
    kind: "OPERATOR_COMMAND",
    conversation_id: CONVERSATION,
    command_id: COMMAND,
    expected_revision: 7,
    expected_control_version: CONTROL_VERSION,
    command: { type: "RESUME" },
  };
}

Deno.test("operator snapshot enables manual control even when phone is outside Motor V2 canary", async () => {
  const state = applyEvent(initState(CONVERSATION), { kind: "HUMAN_REQUEST" });
  const fixture = await harness(state);
  const result = await processOfficialOperator(
    { kind: "OPERATOR_SNAPSHOT", conversation_id: CONVERSATION },
    fixture.request,
    fixture.rest,
    CANARY_HASH,
  );
  assertEquals(result.commands_enabled, true);
  assertEquals(result.automation_mode, "human");
  assert(!fixture.calls.some((call) => call.route.endsWith("support_runtime_commit_operator")));
});

Deno.test("authenticated RESUME outside canary clears handoff and commits BOT silently", async () => {
  const state = applyEvent(initState(CONVERSATION), { kind: "HUMAN_REQUEST" });
  assert(state.handoff !== null);
  const fixture = await harness(state);
  const result = await processOfficialOperator(
    resumeEnvelope(),
    fixture.request,
    fixture.rest,
    CANARY_HASH,
  );
  const commit = fixture.calls.find((call) => call.route.endsWith("support_runtime_commit_operator"));
  assert(commit);
  const next = commit.body.p_state as ConversationState;
  assertEquals(next.handoff, null);
  assertEquals((commit.body.p_projection as Record<string, unknown>).automation_mode, "bot");
  assertEquals(commit.body.p_reply_body, null);
  assertEquals((result as Record<string, unknown>).automation_mode, "bot");
  assertEquals((result as Record<string, unknown>).command_id, COMMAND);
});

Deno.test("RESUME root envelope rejects extra browser identity fields before commit", async () => {
  const fixture = await harness(initState(CONVERSATION));
  try {
    await processOfficialOperator(
      { ...resumeEnvelope(), actor_id: "forged" },
      fixture.request,
      fixture.rest,
      CANARY_HASH,
    );
    throw new Error("expected rejection");
  } catch (error) {
    assert(error instanceof HttpProblem);
    assertEquals(error.code, "INVALID_OPERATOR_COMMAND");
  }
  assert(!fixture.calls.some((call) => call.route.endsWith("support_runtime_commit_operator")));
});
