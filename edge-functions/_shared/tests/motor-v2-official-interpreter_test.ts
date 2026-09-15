import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { MotorV2OfficialInterpreter } from "../motor-v2-official-interpreter.ts";
import type { UnderstandingProvider } from "../../../santana-conversation-domain/motor-v2/understanding.ts";
import type { UnderstandingResult } from "../../../santana-conversation-domain/motor-v2/types.ts";
import { applyEvent, initState } from "../../../santana-conversation-domain/engine/engine.ts";
import { toConversationEvents } from "../../../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { planTurn } from "../../../santana-conversation-domain/runtime/turn.ts";

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

Deno.test("P0 preserves provider LOW confidence without weakening handoff priority", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    confidence: "low",
    risk: { level: "P0", signals: ["family_conflict"] },
  })).interpret(input("Há conflito familiar sobre quem pode autorizar."));

  assertEquals(result.primary_event?.event_kind, "HUMAN_REQUEST");
  assertEquals(result.primary_event?.confidence, "LOW");
  assertEquals(result.overall_confidence, "LOW");
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

Deno.test("official bridge sends structured context and keeps the deterministic reducer authoritative", async () => {
  const calls: Array<ReadonlyArray<{ turn_id: string; role: string; content: string; synthetic?: boolean }>> = [];
  const capturingProvider: UnderstandingProvider = {
    metadata: provider(baseUnderstanding).metadata,
    understand: (turns) => {
      calls.push(turns);
      return Promise.resolve(baseUnderstanding);
    },
  };
  const result = await new MotorV2OfficialInterpreter(capturingProvider).interpret({
    message_id: "msg-current",
    text: "Obrigado, era só isso.",
    context: {
      has_open_goal: true,
      open_goal_code: "GOAL_EXUMACAO",
      pending_question_fact: "burial_reference",
      known_subject_hints: ["exumação"],
      known_facts: [{ fact_code: "burial_reference", value: "quadra 3", confidence: "HIGH", source: "USER_EXPLICIT" }],
      active_case_id: "case-1",
      active_goal_status: "WAITING",
      handoff_active: true,
      parallel_goal_codes: ["GOAL_INFO_HORARIO"],
      pending_action_codes: ["propose_handoff"],
    },
  });

  assertEquals(calls, [[
    {
      turn_id: "msg-current:official-context",
      role: "assistant",
      synthetic: true,
      content: JSON.stringify({
        context_kind: "official_structured_context",
        state: "ACTIVE",
        current_goal: "GOAL_EXUMACAO",
        pending_question: "burial_reference",
        known_subject_hints: ["exumação"],
        known_facts: [{
          fact_code: "burial_reference",
          value: "quadra 3",
          confidence: "HIGH",
          source: "USER_EXPLICIT",
        }],
        active_case_id: "case-1",
        active_goal_status: "WAITING",
        handoff_active: true,
        parallel_goal_codes: ["GOAL_INFO_HORARIO"],
        pending_action_codes: ["propose_handoff"],
      }),
    },
    { turn_id: "msg-current", role: "user", content: "Obrigado, era só isso." },
  ]]);
  assertEquals(result.produced_by, "motor-v2-official-interpreter");
  assertEquals(result.primary_event?.event_kind, "SOCIAL");
});

Deno.test("V2 closed subintent mapping changes the official route without creating a fact", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    subintents: ["EXUMACAO"],
    journeys: ["RESTOS_MORTAIS"],
  })).interpret(input("Preciso resolver isso."));

  assertEquals(result.goal?.goal_code, "GOAL_EXUMACAO");
  assertEquals(result.primary_event?.event_kind, "NEW_GOAL");
  assertEquals(result.facts, []);
  const events = toConversationEvents(result, initState("route-test"));
  assertEquals(events.events[0]?.kind, "NEW_GOAL");
  assertEquals(events.events[0]?.goal_code, "GOAL_EXUMACAO");
});

Deno.test("official planTurn consumes the V2 route before reducer state is proposed", async () => {
  const plan = await planTurn(
    {
      message_id: "plan-route-1",
      text: "Preciso resolver isso.",
      state: initState("plan-route"),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["plan-route-1"],
      subintents: ["EXUMACAO"],
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.produced_by, "motor-v2-official-interpreter");
  assertEquals(plan.next_state.goals[0]?.goal_code, "GOAL_EXUMACAO");
  assertEquals(plan.next_state.cases.length, 1);
});

Deno.test("V2 intent change becomes same-case reclassification, not a new case", async () => {
  const state = applyEvent(initState("reclassify-test"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "current-subject",
  });
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    subintents: ["RECADASTRO"],
    journeys: ["DIREITOS_CADASTRO"],
    intent_changed: true,
  })).interpret({
    ...input("Agora preciso atualizar o recadastro."),
    context: {
      has_open_goal: true,
      open_goal_code: "GOAL_EXUMACAO",
      pending_question_fact: null,
      known_subject_hints: ["current-subject"],
      known_facts: [],
    },
  });

  assertEquals(result.primary_event?.event_kind, "RECLASSIFICATION");
  assertEquals(result.goal?.goal_code, "GOAL_RECADASTRO");
  const events = toConversationEvents(result, state);
  assertEquals(events.events[0]?.kind, "RECLASSIFICATION");
  const next = applyEvent(state, events.events[0]!);
  assertEquals(next.cases.length, state.cases.length);
  assertEquals(next.goals.length, state.goals.length);
  assertEquals(next.goals[0]?.goal_code, "GOAL_RECADASTRO");
});

Deno.test("V2 multi-intent is not collapsed into an arbitrary official transition", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    subintents: ["EXUMACAO", "RECADASTRO"],
    journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
    transverse_states: ["MULTI_INTENT"],
    complexity: "medium",
  })).interpret(input("Preciso tratar os dois assuntos."));

  assertEquals(result.needs_clarification, true);
  assertEquals(toConversationEvents(result).events, []);
  assert(result.clarification_reason?.includes("mais de um assunto"));
});

Deno.test("LOW global confidence preserves corroborated parallel goals without advancing actions", async () => {
  const inputText = "Preciso de exumação e também de recadastro.";
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    confidence: "low",
    subintents: ["EXUMACAO", "RECADASTRO"],
    journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
    transverse_states: ["MULTI_INTENT"],
    evidence_turns: ["msg-1"],
  })).interpret(input(inputText));

  assertEquals(result.needs_clarification, false);
  assertEquals(result.secondary_goals?.map((goal) => goal.goal_code), ["GOAL_RECADASTRO"]);
  const plan = await planTurn(
    {
      ...input(inputText),
      state: initState("low-multi-intent"),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      confidence: "low",
      subintents: ["EXUMACAO", "RECADASTRO"],
      journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
      transverse_states: ["MULTI_INTENT"],
      evidence_turns: ["msg-1"],
    })),
  );

  assertEquals(plan.next_state.goals.length, 2);
  assertEquals(plan.next_state.pending_actions, []);
});

Deno.test("LOW global confidence does not invent an uncorroborated parallel goal", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    confidence: "low",
    subintents: ["EXUMACAO", "RECADASTRO"],
    journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
    transverse_states: ["MULTI_INTENT"],
  })).interpret(input("Preciso de exumação."));

  assertEquals(result.goal?.goal_code, "GOAL_EXUMACAO");
  assertEquals(result.secondary_goals, undefined);
  assertEquals(result.primary_event?.event_kind, "NEW_GOAL");
});

Deno.test("V2 closing state becomes a social no-op when no question is pending", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    transverse_states: ["CONVERSATION_CLOSING"],
  })).interpret(input("Obrigado."));

  assertEquals(result.primary_event?.event_kind, "SOCIAL");
  assertEquals(result.needs_clarification, false);
});

Deno.test("V2 does not open a goal from a simple closing response", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    transverse_states: ["CONVERSATION_CLOSING"],
  })).interpret({
    ...input("Obrigado."),
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
      known_facts: [],
    },
  });

  assertEquals(result.primary_event?.event_kind, "SOCIAL");
  assertEquals(result.goal, null);
});

Deno.test("V2 low confidence remains a clarification instead of an official transition", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    confidence: "low",
  })).interpret(input("Talvez seja sobre isso."));

  assertEquals(result.needs_clarification, true);
  assertEquals(toConversationEvents(result).events, []);
});

Deno.test("V2 known but unmapped subintent fails closed instead of inventing an official goal", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    subintents: ["ADMINISTRACAO_PROVISORIA"],
  })).interpret(input("Preciso saber como prosseguir."));

  assertEquals(result.needs_clarification, true);
  assert(result.clarification_reason?.includes("mapeamento"));
  assertEquals(toConversationEvents(result).events, []);
});

Deno.test("V2 P0 crosses the bridge as a human handoff event without an action", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    risk: { level: "P0", signals: ["family_conflict"] },
  })).interpret(input("Há conflito familiar sobre quem pode autorizar."));
  const events = toConversationEvents(result, initState("p0-bridge"));

  assertEquals(events.events[0]?.kind, "HUMAN_REQUEST");
  assertEquals(result.facts, []);
});

Deno.test("V2 semantic claims without current-turn evidence fail closed", async () => {
  const result = await new MotorV2OfficialInterpreter(provider({
    ...baseUnderstanding,
    evidence_turns: ["older-turn"],
    subintents: ["EXUMACAO"],
  })).interpret(input("Preciso resolver isso."));

  assertEquals(result.needs_clarification, true);
  assert(result.clarification_reason?.includes("evidência"));
  assertEquals(result.primary_event, null);
});

Deno.test("planTurn preserves an intent change as official reclassification", async () => {
  const state = applyEvent(initState("intent-change-plan"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "same-person",
  });
  const plan = await planTurn(
    {
      message_id: "intent-change-plan-turn",
      text: "Agora preciso tratar do recadastro.",
      state,
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["intent-change-plan-turn"],
      subintents: ["RECADASTRO"],
      journeys: ["DIREITOS_CADASTRO"],
      intent_changed: true,
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "RECLASSIFICATION");
  assertEquals(plan.next_state.event_log.at(-1)?.event_kind, "RECLASSIFICATION");
  assertEquals(plan.next_state.cases.length, 1);
  assertEquals(plan.next_state.goals[0]?.goal_code, "GOAL_RECADASTRO");
  assertEquals(plan.interpretation?.official_mapping?.selected_event, "RECLASSIFICATION");
});

Deno.test("a valid correction is not overwritten by V2 intent_changed", async () => {
  const state = applyEvent(initState("correction-plan"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "same-person",
  });
  const plan = await planTurn(
    {
      message_id: "correction-plan-turn",
      text: "Na verdade, já foi exumado.",
      state,
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["correction-plan-turn"],
      intent_changed: true,
      subintents: ["EXUMACAO"],
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "CORRECTION");
  assertEquals(plan.next_state.event_log.at(-1)?.event_kind, "CORRECTION");
  assertEquals(plan.next_state.facts.some((fact) => fact.fact_code === "remains_status"), true);
});

Deno.test("closing has social priority and does not create handoff or clarification", async () => {
  const state = applyEvent(initState("closing-plan"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "same-person",
  });
  const plan = await planTurn(
    {
      message_id: "closing-plan-turn",
      text: "Obrigado, era só isso.",
      state,
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["closing-plan-turn"],
      transverse_states: ["CONVERSATION_CLOSING"],
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "SOCIAL");
  assertEquals(plan.next_state.event_log.at(-1)?.event_kind, "SOCIAL");
  assertEquals(plan.next_state.handoff, null);
  assertEquals(plan.question_draft, null);
});

Deno.test("P0 has explicit priority and suppresses clarification", async () => {
  const plan = await planTurn(
    {
      message_id: "p0-priority-turn",
      text: "Há conflito familiar sobre quem pode autorizar.",
      state: initState("p0-priority"),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["p0-priority-turn"],
      risk: { level: "P0", signals: ["family_conflict"] },
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "HUMAN_REQUEST");
  assertEquals(plan.question_draft, null);
  assertEquals(plan.next_state.handoff?.priority, "P0");
  assertEquals(plan.next_state.event_log.at(-1)?.event_kind, "HUMAN_REQUEST");
});

Deno.test("a new case remains NEW_GOAL even when V2 reports intent_changed", async () => {
  const plan = await planTurn(
    {
      message_id: "new-case-plan-turn",
      text: "É para outro falecido; preciso de exumação.",
      state: applyEvent(initState("new-case-plan"), {
        kind: "NEW_GOAL",
        goal_code: "GOAL_EXUMACAO",
        case_ref: "first-person",
      }),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["new-case-plan-turn"],
      subintents: ["EXUMACAO"],
      intent_changed: true,
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "NEW_GOAL");
  assertEquals(plan.next_state.event_log.at(-1)?.event_kind, "NEW_GOAL");
  assertEquals(plan.next_state.cases.length, 2);
});

Deno.test("closed multi-intent goals are preserved as parallel official goals", async () => {
  const plan = await planTurn(
    {
      message_id: "multi-plan-turn",
      text: "Preciso de exumação e também de recadastro.",
      state: initState("multi-plan"),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["multi-plan-turn"],
      subintents: ["EXUMACAO", "RECADASTRO"],
      journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
      transverse_states: ["MULTI_INTENT"],
      complexity: "medium",
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.next_state.cases.length, 1);
  assertEquals(plan.next_state.goals.map((goal) => goal.goal_code), ["GOAL_EXUMACAO", "GOAL_RECADASTRO"]);
  assertEquals(plan.next_state.event_log.map((event) => event.event_kind), ["NEW_GOAL", "PARALLEL_QUESTION"]);
});

Deno.test("handoff priority never emits an automatic clarification", async () => {
  const plan = await planTurn(
    {
      message_id: "handoff-priority-turn",
      text: "Quero falar com uma pessoa sobre este atendimento.",
      state: applyEvent(initState("handoff-priority"), {
        kind: "NEW_GOAL",
        goal_code: "GOAL_EXUMACAO",
        case_ref: "same-person",
      }),
      automation_mode: "BOT_ACTIVE",
    },
    new MotorV2OfficialInterpreter(provider({
      ...baseUnderstanding,
      evidence_turns: ["handoff-priority-turn"],
      subintents: ["EXUMACAO", "RECADASTRO"],
      journeys: ["RESTOS_MORTAIS", "DIREITOS_CADASTRO"],
      transverse_states: ["MULTI_INTENT"],
    })),
  );

  assertEquals(plan.outcome, "PROPOSED");
  assertEquals(plan.interpretation?.primary_event?.event_kind, "HUMAN_REQUEST");
  assertEquals(plan.question_draft, null);
  assertEquals(plan.next_state.handoff?.priority, "normal");
});
