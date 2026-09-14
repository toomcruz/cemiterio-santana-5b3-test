import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { MotorV2OfficialInterpreter } from "../motor-v2-official-interpreter.ts";
import type { UnderstandingProvider } from "../../../santana-conversation-domain/motor-v2/understanding.ts";
import type { UnderstandingResult } from "../../../santana-conversation-domain/motor-v2/types.ts";

const baseUnderstanding: UnderstandingResult = {
  schema_version: "motor-v2-understanding/1.0.0",
  journeys: ["RESTOS_MORTAIS"],
  subintents: ["EXUMACAO"],
  transverse_states: [],
  intent_changed: false,
  complexity: "low",
  risk: { level: "none", signals: [] },
  confidence: "high",
  evidence_turns: ["msg-1"],
};

function input(text: string) {
  return {
    message_id: "msg-1",
    text,
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
      known_facts: [],
    },
  };
}

function provider(result: UnderstandingResult): UnderstandingProvider {
  return {
    metadata: {
      id: "test-v2",
      kind: "controlled_ai",
      uses_ai: true,
      model: "openai/gpt-oss-20b",
      schema_guarded: true,
    },
    understand: () => Promise.resolve(result),
  };
}

Deno.test("official V2 interpreter preserves the official reducer boundary for P0", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    risk: { level: "P0", signals: ["non_natural_death"] },
  })).interpret(input("A morte foi não natural."));

  assertEquals(result.primary_event?.event_kind, "HUMAN_REQUEST");
  assertEquals(result.produced_by, "motor-v2-official-interpreter");
  assertEquals(result.needs_clarification, false);
});

Deno.test("official V2 interpreter refuses conclusions when media was not analyzed", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    transverse_states: ["MEDIA_NOT_ANALYZED"],
  })).interpret(input("Veja a foto e confirme o conteúdo."));

  assertEquals(result.needs_clarification, true);
  assert(result.clarification_reason?.includes("mídia"));
});

Deno.test("official V2 interpreter remains compatible with processOfficialTurn inputs", async () => {
  const result = await new MotorV2OfficialInterpreter(provider(baseUnderstanding)).interpret(
    input("Preciso de exumação."),
  );
  assertEquals(result.schema_version, "santana-interpretation/v1");
  assertEquals(result.message_id, "msg-1");
});
