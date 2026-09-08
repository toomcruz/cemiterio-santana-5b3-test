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
