import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, applyEvent, initState } from "../../engine/engine.ts";
import { buildPrompt } from "../adapter/prompt.ts";
import { contextFromState } from "../interpreter/bridge.ts";
import { interpret } from "../interpreter/deterministic.ts";
import type { InterpreterInput } from "../interpreter/types.ts";
import { planTurn } from "../turn.ts";

const state = () =>
  applyEvent(initState("synthetic-conversation"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_TRANSPORTE",
    case_ref: "synthetic-subject-a",
  });

Deno.test("official turn invokes interpretation during an active goal with the pending question", async () => {
  const before = state();
  let captured: InterpreterInput | undefined;
  const result = await planTurn({
    message_id: "turn-1",
    text: "ja foi exumado",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) => {
      captured = input;
      return Promise.resolve(interpret(input));
    },
  });
  assert(captured);
  assertEquals(captured.context.open_goal_code, "GOAL_TRANSPORTE");
  assertEquals(captured.context.pending_question_fact, before.pending_question?.fact_code);
  assertEquals(result.outcome, "PROPOSED");
  assert(result.next_state.facts.some((fact) => fact.fact_code === "remains_status" && fact.value === "EXUMADO"));
  assertEquals(before, state(), "input must not be mutated");
});

Deno.test("unknown answer preserves the goal, documents and history, without handoff or menu", async () => {
  const before = state();
  const result = await planTurn({
    message_id: "turn-2",
    text: "nao sei o nome",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) => Promise.resolve(interpret(input)),
  });
  assertEquals(result.outcome, "CLARIFICATION");
  assertEquals(result.next_state, before);
  assertEquals(result.next_state.handoff, null);
  assert(result.question_draft !== null);
  assert(!result.question_draft.includes("remains_status"), "internal fact codes must not be shown");
});

Deno.test("human mode never invokes interpretation and produces no draft", async () => {
  const result = await planTurn(
    { message_id: "turn-3", text: "ola", state: state(), automation_mode: "HUMAN_ACTIVE" },
    {
      interpret: () => {
        throw new Error("must not call");
      },
    },
  );
  assertEquals(result.outcome, "HUMAN_ACTIVE");
  assertEquals(result.question_draft, null);
});

Deno.test("provider failure preserves state without inventing a handoff", async () => {
  const before = state();
  const result = await planTurn({ message_id: "turn-4", text: "ola", state: before, automation_mode: "BOT_ACTIVE" }, {
    interpret: () => Promise.reject(new Error("provider unavailable")),
  });
  assertEquals(result.outcome, "INTERPRETATION_UNAVAILABLE");
  assertEquals(result.next_state, before);
  assertEquals(result.question_draft, null);
});

Deno.test("wrong message identity is rejected even from an injected interpreter", async () => {
  const before = state();
  const result = await planTurn({
    message_id: "turn-5",
    text: "ja foi exumado",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) => Promise.resolve({ ...interpret(input), message_id: "different-turn" }),
  });
  assertEquals(result.outcome, "INTERPRETATION_UNAVAILABLE");
  assertEquals(result.next_state, before);
});

Deno.test("context includes collected facts but excludes facts belonging to another case", () => {
  let before = applyEvent(state(), { kind: "COMPLEMENT", facts: [{ code: "remains_status", value: "EXUMADO" }] });
  assert(contextFromState(before).known_facts?.some((fact) => fact.fact_code === "remains_status"));
  before = applyEvent(before, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "synthetic-subject-b" });
  assert(!contextFromState(before).known_facts?.some((fact) => fact.fact_code === "remains_status"));
});

Deno.test("prompt pins message identity and explains literal evidence and continuation", () => {
  const prompt = buildPrompt({ message_id: "unique-turn", text: "nao sei", context: contextFromState(state()) });
  assert(prompt.includes('"message_id":"unique-turn"'));
  assert(prompt.includes("exact substring"));
  assert(prompt.includes("pending question"));
  assert(prompt.includes("does not erase the topic"));
});

Deno.test("accented Portuguese retains literal evidence through the strict turn boundary", async () => {
  const text = "Já foi exumado";
  const result = await planTurn({ message_id: "accented", text, state: state(), automation_mode: "BOT_ACTIVE" }, {
    interpret: (input) => Promise.resolve(interpret(input)),
  });
  assertEquals(result.outcome, "PROPOSED");
  assert(result.interpretation?.facts.every((fact) => text.includes(fact.evidence)));
});

Deno.test("facts submitted in case B cannot fill a pending fact in case A", () => {
  const first = state();
  const firstGoal = first.goals[0]!;
  const second = applyEvent(first, { kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "subject-b" });
  const after = applyEvent(second, {
    kind: "COMPLEMENT",
    facts: [{ code: "remains_status", value: "EXUMADO" }],
  });
  assertEquals(activeFact(after, "remains_status", firstGoal), null);
});

Deno.test("violation report belongs to the complaint overlay and is not asked again", async () => {
  const before = applyEvent(initState("complaint-test"), { kind: "NEW_GOAL", goal_code: "GOAL_OUTROS_ASSUNTOS" });
  const text = "Meu jazigo está violado";
  const result = await planTurn({ message_id: "complaint", text, state: before, automation_mode: "BOT_ACTIVE" }, {
    interpret: (input) =>
      Promise.resolve({
        ...interpret(input),
        primary_event: { event_kind: "COMPLAINT", confidence: "HIGH", evidence: text },
        secondary_events: [],
        goal: null,
        case_reference: { kind: "CURRENT", subject_kind: "GENERIC", subject_hint: null, confidence: "HIGH" },
        facts: [{
          fact_code: "complaint_description",
          value: text,
          source: "USER_EXPLICIT",
          confidence: "HIGH",
          evidence: text,
          requires_confirmation: false,
        }],
        ambiguities: [],
        overall_confidence: "HIGH",
        needs_clarification: false,
        clarification_reason: null,
      }),
  });
  assertEquals(result.outcome, "PROPOSED");
  const complaint = result.next_state.goals.find((goal) => goal.goal_code === "GOAL_RECLAMACAO");
  assert(complaint);
  const report = activeFact(result.next_state, "complaint_description", complaint);
  assertEquals(report?.value, text);
  assertEquals(report?.authoritative, false);
  assert(result.next_state.pending_question?.fact_code !== "complaint_description");
  assertEquals(result.next_state.handoff, null);
  assertEquals(result.next_state.solicitacoes, [], "a report is not a formal request");
});
