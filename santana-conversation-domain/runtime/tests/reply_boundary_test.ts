import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { applyEvent, initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import type { Interpretation } from "../interpreter/types.ts";
import { planTurn } from "../turn.ts";

function mapping(overrides: Partial<NonNullable<Interpretation["official_mapping"]>> = {}) {
  return {
    journeys: ["EXUMACAO"],
    subintents: ["EXUMACAO"],
    transverse_states: [],
    intent_changed: false,
    complexity: "simple",
    risk_level: "none",
    confidence: "high",
    evidence_turn_ids: ["message"],
    selected_event: null,
    suppressed_events: [],
    reason: "test",
    ...overrides,
  };
}

function stateWithGoal(id: string, goalCode = "GOAL_EXUMACAO") {
  return applyEvent(initState(id), { kind: "NEW_GOAL", goal_code: goalCode, case_ref: `${id}:subject` });
}

function candidate(input: Parameters<typeof interpret>[0], overrides: Partial<Interpretation>): Interpretation {
  return {
    ...interpret(input),
    official_mapping: mapping(),
    ...overrides,
  };
}

Deno.test("reply preserves a corroborated parallel goal from the committed state", async () => {
  const result = await planTurn({
    message_id: "multi-reply",
    text: "Preciso de exumação e também de recadastro.",
    state: initState("multi-reply"),
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "NEW_GOAL", confidence: "MEDIUM", evidence: input.text },
        goal: { goal_code: "GOAL_EXUMACAO", confidence: "MEDIUM", evidence: input.text },
        secondary_goals: [{ goal_code: "GOAL_RECADASTRO", confidence: "MEDIUM", evidence: input.text }],
        case_reference: { kind: "NEW", subject_kind: "DECEASED", subject_hint: null, confidence: "HIGH" },
        overall_confidence: "MEDIUM",
        needs_clarification: false,
      })),
  });

  assertEquals(result.next_state.goals.map((goal) => goal.goal_code), ["GOAL_EXUMACAO", "GOAL_RECADASTRO"]);
  assert(result.reply_draft?.includes("recadastro"));
  assert(result.reply_draft?.includes("outro assunto deste atendimento"));
  assert(!result.reply_draft?.includes("agendamento"));
});

Deno.test("reply explains a same-case reclassification and preserves the prior topic", async () => {
  const before = stateWithGoal("reclass-reply");
  const result = await planTurn({
    message_id: "reclass-reply-message",
    text: "Agora preciso tratar do recadastro.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "RECLASSIFICATION", confidence: "MEDIUM", evidence: input.text },
        goal: { goal_code: "GOAL_RECADASTRO", confidence: "MEDIUM", evidence: input.text },
        case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: null, confidence: "LOW" },
        official_mapping: mapping({ intent_changed: true, selected_event: "RECLASSIFICATION" }),
        overall_confidence: "LOW",
        needs_clarification: false,
      })),
  });

  assertEquals(result.next_state.goals[0]?.goal_code, "GOAL_RECADASTRO");
  assert(result.reply_draft?.includes("agora vamos tratar de recadastro"));
  assert(result.reply_draft?.includes("exumação foi preservado"));
  assert(!result.reply_draft?.includes("finalidade da exumação"));
});

Deno.test("same-goal concession correction drafts the committed next question", async () => {
  const before = stateWithGoal("same-goal-correction", "GOAL_RECADASTRO");
  const text =
    "A concessão correta é Quadra 15, terreno 63. O falecido é José da Silva e está sepultado na Quadra 8, terreno 42.";
  const result = await planTurn({
    message_id: "same-goal-correction-message",
    text,
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "CORRECTION", confidence: "HIGH", evidence: input.text },
        goal: { goal_code: "GOAL_CONCESSAO", confidence: "HIGH", evidence: "concessão" },
        case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: null, confidence: "HIGH" },
        official_mapping: mapping({
          journeys: ["DIREITOS_CADASTRO", "JAZIGO_ESPACO_FISICO"],
          subintents: ["RECADASTRO", "CONCESSAO"],
          intent_changed: true,
          selected_event: "CORRECTION",
        }),
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.goals[0]?.goal_code, "GOAL_RECADASTRO");
  assertEquals(result.next_state.pending_question?.question_code, "Q_RECADASTRO_HOLDER_DOCUMENT");
  assert(result.reply_draft?.startsWith("Registrei a correção informada."));
  assert(result.reply_draft?.includes("documento do titular"));
  assert(!result.reply_draft?.includes("tratar de concessão"));
  assert(!result.reply_draft?.includes("Confirme se deseja seguir"));
});

Deno.test("media clarification explains the boundary without claiming image analysis", async () => {
  const result = await planTurn({
    message_id: "media-reply",
    text: "Veja a foto e confirme o conteúdo.",
    state: initState("media-reply"),
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: null,
        official_mapping: mapping({ transverse_states: ["MEDIA_NOT_ANALYZED"] }),
        needs_clarification: true,
        clarification_reason: "mídia essencial ainda não analisada",
        overall_confidence: "LOW",
      })),
  });

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.reply_draft?.includes("conteúdo da imagem ainda não foi analisado"));
  assert(!result.reply_draft?.includes("Pode me explicar um pouco melhor"));
});

Deno.test("closing reply follows the committed SOCIAL close and clears the question", async () => {
  const before = stateWithGoal("closing-reply");
  const result = await planTurn({
    message_id: "closing-reply-message",
    text: "Obrigado, era só isso.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "SOCIAL", confidence: "HIGH", evidence: input.text },
        official_mapping: mapping({ transverse_states: ["CONVERSATION_CLOSING"], selected_event: "SOCIAL" }),
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.pending_question, null);
  assert(result.reply_draft?.includes("Encerramos este atendimento"));
  assert(!result.reply_draft?.includes("finalidade"));
});

Deno.test("new case reply explains separation from the previous deceased", async () => {
  const before = stateWithGoal("new-case-reply");
  const result = await planTurn({
    message_id: "new-case-reply-message",
    text: "É para outro falecido; preciso de exumação.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "NEW_GOAL", confidence: "HIGH", evidence: input.text },
        goal: { goal_code: "GOAL_EXUMACAO", confidence: "HIGH", evidence: input.text },
        case_reference: { kind: "NEW", subject_kind: "DECEASED", subject_hint: "outro falecido", confidence: "HIGH" },
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.cases.length, 2);
  assert(result.reply_draft?.includes("outro falecido"));
  assert(result.reply_draft?.includes("atendimento anterior separado"));
  assert(result.reply_draft?.includes("finalidade"));
});

Deno.test("correction reply does not announce a topic change without a state transition", async () => {
  const before = stateWithGoal("correction-reply");
  const result = await planTurn({
    message_id: "correction-reply-message",
    text: "Na verdade, quero recadastro, não exumação.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "CORRECTION", confidence: "HIGH", evidence: input.text },
        goal: { goal_code: "GOAL_RECADASTRO", confidence: "HIGH", evidence: input.text },
        case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: null, confidence: "HIGH" },
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.goals[0]?.goal_code, "GOAL_EXUMACAO");
  assert(!result.reply_draft?.includes("recadastro, não de exumação"));
  assert(!result.reply_draft?.includes("Confirme se deseja seguir"));
});

Deno.test("correction subintent cannot announce a topic change without a state transition", async () => {
  const before = stateWithGoal("correction-mapped-reply");
  const result = await planTurn({
    message_id: "correction-mapped-reply-message",
    text: "Na verdade, quero recadastro, não exumação.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "CORRECTION", confidence: "HIGH", evidence: input.text },
        goal: { goal_code: "GOAL_EXUMACAO", confidence: "HIGH", evidence: "exumação" },
        case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: null, confidence: "HIGH" },
        official_mapping: mapping({
          subintents: ["RECADASTRO", "EXUMACAO"],
          intent_changed: true,
          selected_event: "CORRECTION",
        }),
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.goals[0]?.goal_code, "GOAL_EXUMACAO");
  assert(!result.reply_draft?.includes("recadastro, não de exumação"));
  assert(!result.reply_draft?.includes("Confirme se deseja seguir"));
});

Deno.test("priority handoff reply never adds a parallel clarification", async () => {
  const result = await planTurn({
    message_id: "p0-reply",
    text: "Há conflito familiar sobre quem pode autorizar.",
    state: initState("p0-reply"),
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "HUMAN_REQUEST", confidence: "HIGH", evidence: input.text },
        official_mapping: mapping({ risk_level: "P0", selected_event: "HUMAN_REQUEST" }),
        needs_clarification: false,
        overall_confidence: "LOW",
      })),
  });

  assertEquals(result.next_state.handoff?.priority, "P0");
  assert(result.reply_draft?.includes("encaminhamento"));
  assertEquals(result.question_draft, null);
  assert(!result.reply_draft?.includes("Pode me explicar"));
});

Deno.test("return with known context keeps the pending subject in the citizen reply", async () => {
  const before = stateWithGoal("return-context-reply");
  const result = await planTurn({
    message_id: "return-context-reply-message",
    text: "A referência é quadra 3.",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) =>
      Promise.resolve(candidate(input, {
        primary_event: { event_kind: "COMPLEMENT", confidence: "HIGH", evidence: input.text },
        facts: [{
          fact_code: "burial_reference",
          value: "quadra 3",
          source: "USER_EXPLICIT",
          confidence: "HIGH",
          evidence: "quadra 3",
          requires_confirmation: false,
        }],
        case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: null, confidence: "HIGH" },
        needs_clarification: false,
        overall_confidence: "HIGH",
      })),
  });

  assertEquals(result.next_state.goals[0]?.goal_code, "GOAL_EXUMACAO");
  assert(result.next_state.facts.some((fact) => fact.fact_code === "burial_reference"));
  assert(result.reply_draft?.includes("Entendi"));
  assert(result.reply_draft?.includes("exumação") || result.reply_draft?.includes("esposo"));
  assert(!result.reply_draft?.includes("recadastro"));
});
