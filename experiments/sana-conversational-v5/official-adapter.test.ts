/** Tests against the actual checked-out canonical modules, not against a second reducer. */
import { initState } from "../../santana-conversation-domain/engine/engine.ts";
import { interpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../../santana-conversation-domain/runtime/interpreter/guard.ts";
import { contextFromState } from "../../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { officialBridge } from "./official-adapter.ts";
import { runPreview, type Message } from "./core.ts";

const message: Message = {
  id: "v5-offline-input", conversationId: "v5-offline-conversation", sessionId: "v5-offline-session",
  role: "user", text: "Quero exumar meu pai",
};
function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
Deno.test("V5 bridge reads the canonical empty state", () => {
  const state = initState(message.conversationId);
  const snapshot = officialBridge().snapshot(state);
  assert(snapshot.conversationId === message.conversationId, "same conversation");
  assert(snapshot.pending === null && snapshot.facts.length === 0, "no invented context");
});
Deno.test("V5 embeds the existing strict interpretation schema", () => {
  const prompt = JSON.parse(officialBridge().interpretationPrompt(initState(message.conversationId), message));
  assert(prompt.schema && prompt.contract.includes(message.id), "canonical contract included");
});
Deno.test("V5 delegates state transitions to real planTurn without mutating input", async () => {
  const state = initState(message.conversationId);
  const before = JSON.stringify(state);
  const interpretation = guardInterpretation(interpret({
    message_id: message.id, text: message.text, context: contextFromState(state),
  }));
  const result = await officialBridge().preview(state, message, JSON.parse(JSON.stringify(interpretation)));
  assert(result.outcome !== "INTERPRETATION_UNAVAILABLE", "canonical interpretation accepted");
  assert(result.state.goals.some((g) => g.goal_code === "GOAL_EXUMACAO"), "real reducer opened exhumation goal");
  assert(JSON.stringify(state) === before, "caller state unchanged");
});
Deno.test("V5 rejects an invalid canonical interpretation at the real boundary", async () => {
  let rejected = false;
  try { await officialBridge().preview(initState(message.conversationId), message, { facts: [] }); }
  catch { rejected = true; }
  assert(rejected, "strict existing validator rejected invented payload");
});
Deno.test("V5 real authority lookup is explicit, versioned and read-only", async () => {
  const state = initState(message.conversationId);
  const before = JSON.stringify(state);
  const result = await officialBridge().lookup(state, { kind: "DOCUMENTOS", evidence: "documentos" }, "2026-09-23");
  assert(result.id === "authority:DOCUMENTOS" && /^[a-f0-9]{64}$/.test(result.version), "versioned authority response");
  assert(["AVAILABLE", "NEEDS_CONTEXT", "NOT_AVAILABLE", "CONFLICT"].includes(result.status), "no assumption of availability");
  assert(JSON.stringify(state) === before, "authority lookup did not mutate state");
});
Deno.test("V5 whole preview with real canonical bridge remains uncommitted", async () => {
  const state = initState(message.conversationId);
  const interpretation = guardInterpretation(interpret({
    message_id: message.id, text: message.text, context: contextFromState(state),
  }));
  let calls = 0;
  const result = await runPreview({
    mode: "simulation", state, message, correlationId: "v5-offline-correlation", referenceDate: "2026-09-23",
    history: [], automaticRepliesAllowed: true,
  }, {
    bridge: officialBridge(), model: {
      name: "scripted-not-gemini",
      generate() {
        calls++;
        return Promise.resolve(calls === 1
          ? { action: "CONTINUE", interpretation, questions: [], askFollowup: false }
          : { parts: [{ kind: "ack", text: "Entendi o que você precisa.", sourceIds: [] }] });
      },
    },
  });
  assert(result.status === "DRAFT" && calls === 2, "two model stages, mocked");
  assert(result.externalEffects.length === 0 && result.persisted === false, "no persistence/transport");
  assert(state.goals.length === 0, "original state remains unchanged");
});
