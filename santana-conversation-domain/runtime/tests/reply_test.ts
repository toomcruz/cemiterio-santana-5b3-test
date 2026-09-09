import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn } from "../turn.ts";

Deno.test("jazigo violation receives a useful follow-up instead of a repeated menu", async () => {
  const result = await planTurn({
    message_id: "reply-grave-violation",
    text: "Meu jazigo está violado",
    state: initState("reply-grave-violation"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assert(result.reply_draft?.includes("ocorrência relatada"));
  assert(result.reply_draft?.includes("foto"));
  assert(result.reply_draft?.includes("FINALIZAR"));
  assert(!result.reply_draft?.includes("escolha uma opção"));
  assertEquals(result.next_state.handoff, null);
});

Deno.test("focused catalog question is the response draft when facts are still missing", async () => {
  const result = await planTurn({
    message_id: "reply-grave-start",
    text: "Quero falar do meu jazigo",
    state: initState("reply-grave-start"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.reply_draft, result.question_draft);
  assert(result.reply_draft?.includes("jazigo"));
});

Deno.test("human and provider-unavailable modes produce no sendable reply", async () => {
  const human = await planTurn({
    message_id: "reply-human",
    text: "olá",
    state: initState("reply-human"),
    automation_mode: "HUMAN_ACTIVE",
  }, {
    interpret: () => {
      throw new Error("human mode must not interpret");
    },
  });
  const unavailable = await planTurn({
    message_id: "reply-unavailable",
    text: "olá",
    state: initState("reply-unavailable"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: () => Promise.reject(new Error("offline")) });
  assertEquals(human.reply_draft, null);
  assertEquals(unavailable.reply_draft, null);
});

Deno.test("initial greeting uses the service menu instead of a generic clarification", async () => {
  const result = await planTurn({
    message_id: "hello-menu",
    text: "Olá",
    state: initState("hello-menu"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  assert(result.reply_draft?.includes("recadastro"));
  assert(!result.reply_draft?.includes("explicar um pouco melhor"));
});

Deno.test("bereavement statement receives a sensitive prompt without inventing a goal", async () => {
  const result = await planTurn({
    message_id: "bereavement",
    text: "Meu pai faleceu",
    state: initState("bereavement"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.reply_draft?.startsWith("Sinto muito pela sua perda"));
  assert(result.reply_draft?.includes("exumação"));
  assertEquals(result.next_state.goals, []);
});

Deno.test("exhumation asks a self-explanatory purpose question", async () => {
  const result = await planTurn({
    message_id: "exhumation-start",
    text: "Quero realizar a exumação",
    state: initState("exhumation-start"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.pending_question?.fact_code, "exhumation_purpose");
  assert(result.reply_draft?.includes("transportar os restos"));
  assert(result.reply_draft?.includes("ossuário"));
  assert(result.reply_draft?.includes("cremação"));
});

Deno.test("como assim explains the pending exhumation question without losing context", async () => {
  const started = await planTurn({
    message_id: "exhumation-explain-start",
    text: "Quero realizar a exumação",
    state: initState("exhumation-explain"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const explained = await planTurn({
    message_id: "exhumation-explain-follow-up",
    text: "Como assim?",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(explained.outcome, "CLARIFICATION");
  assertEquals(explained.next_state, started.next_state);
  assertEquals(explained.next_state.pending_question?.fact_code, "exhumation_purpose");
  assert(explained.reply_draft?.includes("após a exumação"));
  assert(explained.reply_draft?.includes("Qual dessas opções"));
});

Deno.test("exhumation purpose answer advances to the next question", async () => {
  const started = await planTurn({
    message_id: "exhumation-answer-start",
    text: "Quero realizar a exumação",
    state: initState("exhumation-answer"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const answered = await planTurn({
    message_id: "exhumation-answer-purpose",
    text: "Para colocar no ossuário",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(answered.outcome, "PROPOSED");
  assertEquals(answered.next_state.pending_question?.fact_code, "surviving_spouse_status");
  assert(answered.reply_draft?.includes("esposo ou companheiro"));
});

Deno.test("ossuary outside an exhumation question is not stored as an exhumation purpose", () => {
  const result = interpret({
    message_id: "ossuary-other-context",
    text: "Quero informações sobre o ossuário",
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
      known_facts: [],
    },
  });

  assert(!result.facts.some((fact) => fact.fact_code === "exhumation_purpose"));
});
