import { assertEquals, assertThrows } from "jsr:@std/assert";
import { assertClosedLiveCohortSafety } from "../live-shadow/run_live_shadow.ts";
import { ControlledGeminiUnderstandingProvider } from "../../santana-conversation-domain/motor-v2/providers/gemini.ts";
import { MotorV2Runtime } from "../../santana-conversation-domain/motor-v2/runtime.ts";

Deno.test("real-AI boundary remains behind deterministic P0 policy", async () => {
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey: "test-only",
    model: "gemini-test",
    network: () =>
      Promise.resolve({
        status: 200,
        body: JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                text: JSON.stringify({
                  schema_version: "motor-v2-understanding/1.0.0",
                  journeys: ["RESTOS_MORTAIS"],
                  subintents: ["CORPO_SEMI_INTACTO"],
                  transverse_states: [],
                  intent_changed: false,
                  complexity: "low",
                  risk: { level: "none", signals: [] },
                  confidence: "high",
                  evidence_turns: ["turn_one"],
                }),
              }],
            },
          }],
        }),
      }),
  });
  const result = await new MotorV2Runtime(provider).runLabCase({
    case_id: "case_test_ai_p0",
    conversation_id: "conversation_test_ai_p0",
    inbound_id: "inbound_test_ai_p0",
    messages: [{ turn_id: "turn_one", role: "user", content: "corpo semi intacto" }],
    known_facts: [],
    do_not_ask_again: [],
    track_states: [{ track_id: "track_restos", label: "RESTOS_MORTAIS", status: "active" }],
    administrative_gaps: {
      current_deadline: "requires_current_policy",
      current_value: "requires_current_policy",
      current_documents: "requires_current_policy",
      family_authorization: "requires_current_policy",
      current_schedule: "requires_current_policy",
      eligibility: "requires_current_policy",
      current_procedure: "requires_current_policy",
    },
    fixed_clock: { instant: "2026-09-13T12:00:00Z", timezone: "America/Sao_Paulo" },
  });
  assertEquals(result.state.understanding.risk.level, "P0");
  assertEquals(result.state.policy.handoff.priority, "P0");
  assertEquals(result.trace.tool_calls, []);
});

Deno.test("provider credential is mandatory", () => {
  assertThrows(
    () => new ControlledGeminiUnderstandingProvider({ apiKey: "", model: "gemini-test" }),
    Error,
    "credential",
  );
});

Deno.test("live provider rejects cohorts that do not attest both privacy closures", () => {
  const safety = {
    respond_allowed: false,
    action_allowed: false,
    official_write_allowed: false,
    tools_mode: "would_call_only",
    raw_content_persisted: false,
    raw_identifiers_persisted: false,
  } as const;
  assertClosedLiveCohortSafety(safety);
  assertThrows(
    () => assertClosedLiveCohortSafety({ ...safety, raw_content_persisted: true }),
    Error,
    "not closed",
  );
  assertThrows(
    () => assertClosedLiveCohortSafety({ ...safety, raw_identifiers_persisted: true }),
    Error,
    "not closed",
  );
  assertThrows(
    () => assertClosedLiveCohortSafety({ ...safety, unexpected: false }),
    Error,
    "missing or extra fields",
  );
});
