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

Deno.test("jazigo without a description asks a focused question instead of returning to the menu", async () => {
  const result = await planTurn({
    message_id: "grave-start",
    text: "Estou falando do meu jazigo",
    state: initState("grave-start"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assert(result.next_state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS"));
  assertEquals(result.next_state.pending_question?.fact_code, "grave_service_description");
  assert(result.question_draft?.includes("jazigo"));
  assertEquals(result.next_state.handoff, null);
});

Deno.test("generic problem in a jazigo is not mistaken for a complete occurrence description", async () => {
  const result = await planTurn({
    message_id: "grave-generic-problem",
    text: "Estou com um problema no jazigo",
    state: initState("grave-generic-problem"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.pending_question?.fact_code, "grave_service_description");
  assert(result.reply_draft?.includes("descrever"));
  assert(!result.reply_draft?.includes("escolha uma opção"));
});

Deno.test("unknown holder preserves the active jazigo triage and does not repeat a menu", async () => {
  const started = await planTurn({
    message_id: "grave-unknown-start",
    text: "Estou falando do meu jazigo",
    state: initState("grave-unknown"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const result = await planTurn({
    message_id: "grave-unknown-holder",
    text: "Não sei quem é o titular",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.next_state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS"));
  assertEquals(result.next_state.pending_question?.fact_code, "grave_service_description");
  assert(result.question_draft?.includes("jazigo"));
  assertEquals(result.next_state.handoff, null);
});

Deno.test("violated grave creates the official base and complaint overlay in one turn", async () => {
  const text = "Meu jazigo está violado";
  const result = await planTurn({
    message_id: "grave-violation",
    text,
    state: initState("grave-violation"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  const base = result.next_state.goals.find((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS");
  const complaint = result.next_state.goals.find((goal) => goal.goal_code === "GOAL_RECLAMACAO");
  assert(base);
  assert(complaint);
  assertEquals(complaint.overlay_of, base.goal_id);
  assertEquals(activeFact(result.next_state, "grave_service_description", base)?.value, text);
  assertEquals(activeFact(result.next_state, "complaint_description", complaint)?.value, text);
  assertEquals(base.status, "ACTIVE", "the operational case stays open for evidence and an explicit handoff");
  assertEquals(complaint.status, "RESOLVED", "the semantic overlay may be complete without closing the base case");
  assertEquals(result.next_state.handoff, null);
  assertEquals(result.next_state.solicitacoes, [], "report is not a formal request without confirmation");
});

Deno.test("an open jazigo occurrence accepts a later explicit FINALIZAR without returning to the menu", async () => {
  const started = await planTurn({
    message_id: "grave-finalize-start",
    text: "Meu jazigo está violado",
    state: initState("grave-finalize"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  const result = await planTurn({
    message_id: "grave-finalize-request",
    text: "FINALIZAR",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.interpretation?.primary_event?.event_kind, "HUMAN_REQUEST");
  assert(result.next_state.handoff !== null);
  assert(result.next_state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS" && goal.status === "ACTIVE"));
  assert(result.reply_draft?.includes("pedido de encaminhamento"));
  assert(!result.reply_draft?.includes("escolha uma opção"));
});

Deno.test("an unclassified continuation of an open jazigo occurrence stays in context and offers explicit completion", async () => {
  const started = await planTurn({
    message_id: "grave-continuation-start",
    text: "Meu jazigo está violado",
    state: initState("grave-continuation"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  const result = await planTurn({
    message_id: "grave-continuation-more",
    text: "Também aconteceu no domingo e estou muito preocupada",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.next_state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS" && goal.status === "ACTIVE"));
  assert(result.reply_draft?.includes("continuar explicando"));
  assert(result.reply_draft?.includes("FINALIZAR"));
  assert(!result.reply_draft?.includes("escolha uma opção"));
  assertEquals(result.next_state.handoff, null);
});

Deno.test("jazigo reference and later damage detail are preserved without reopening a second complaint", async () => {
  const first = await planTurn({
    message_id: "grave-reference-start",
    text: "Meu jazigo está violado",
    state: initState("grave-reference"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const referenced = await planTurn({
    message_id: "grave-reference-location",
    text: "Quadra 3, jazigo 18",
    state: first.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const detailed = await planTurn({
    message_id: "grave-reference-detail",
    text: "A tampa quebrou e entrou água",
    state: referenced.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  const base = detailed.next_state.goals.find((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS");
  assert(base);
  assertEquals(activeFact(detailed.next_state, "grave_reference", base)?.value, "Quadra 3, jazigo 18");
  assertEquals(
    detailed.next_state.goals.filter((goal) => goal.goal_code === "GOAL_RECLAMACAO").length,
    1,
    "later details must reuse the same occurrence overlay",
  );
  assertEquals(activeFact(detailed.next_state, "grave_service_description", base)?.confidence, "CONFIRMED");
  assert(detailed.next_state.facts.filter((fact) => fact.fact_code === "grave_service_description" && fact.status === "ACTIVE").length >= 2);
  assert(detailed.reply_draft?.includes("FINALIZAR"));
});

Deno.test("handoff context excludes facts from another jazigo case", () => {
  let state = applyEvent(initState("handoff-case-isolation"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_JAZIGO_SERVICOS",
    case_ref: "grave-a",
  });
  state = applyEvent(state, { kind: "COMPLEMENT", facts: [{ code: "grave_service_description", value: "Ocorrência A" }] });
  state = applyEvent(state, {
    kind: "NEW_GOAL",
    goal_code: "GOAL_JAZIGO_SERVICOS",
    case_ref: "grave-b",
  });
  state = applyEvent(state, { kind: "COMPLEMENT", facts: [{ code: "grave_service_description", value: "Ocorrência B" }] });
  state = applyEvent(state, { kind: "HUMAN_REQUEST" });

  const confirmed = state.handoff?.confirmed_facts.map((fact) => String(fact.value)) ?? [];
  assert(confirmed.includes("Ocorrência B"));
  assert(!confirmed.includes("Ocorrência A"));
});
