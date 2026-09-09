import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { applyEvent, initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn } from "../turn.ts";

const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };

function waitingForBurialReference(id: string) {
  let state = applyEvent(initState(id), { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "exhumation_purpose", value: "OSSUARIO" }] });
  return applyEvent(state, { kind: "ANSWER", facts: [{ code: "surviving_spouse_status", value: "FALECIDO" }] });
}

Deno.test("restart request offers a safe new attendance without erasing the current protocol", async () => {
  const before = waitingForBurialReference("restart-safe");
  const result = await planTurn({
    message_id: "restart-safe-message",
    text: "Quero começar novamente o atendimento",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assertEquals(result.outcome, "CLARIFICATION");
  assertEquals(result.next_state, before);
  assert(result.reply_draft?.includes("serão preservados"));
  assert(result.reply_draft?.includes("NOVO ATENDIMENTO DE RECADASTRO"));
});

Deno.test("greeting during collection acknowledges the citizen before the short pending question", async () => {
  const before = waitingForBurialReference("greeting-active");
  const result = await planTurn({
    message_id: "greeting-active-message",
    text: "Boa noite",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assert(result.reply_draft?.startsWith("Boa noite! Seu atendimento de exumação continua ativo"));
  assert(result.reply_draft?.includes("nome do falecido"));
  assertEquals(result.next_state.facts, before.facts);
});

Deno.test("unrelated text repairs the exchange instead of mechanically repeating only the question", async () => {
  const before = waitingForBurialReference("repair-unknown");
  const result = await planTurn({
    message_id: "repair-unknown-message",
    text: "kkkkoooooo",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.reply_draft?.startsWith("Não consegui relacionar essa mensagem"));
  assert(result.reply_draft?.includes("NÃO SEI"));
  assertEquals(result.next_state, before);
});

Deno.test("not knowing a burial reference accepts partial knowledge and offers a safe escape", async () => {
  const before = waitingForBurialReference("repair-unknown-burial");
  const result = await planTurn({
    message_id: "repair-unknown-burial-message",
    text: "Não sei",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assert(result.reply_draft?.startsWith("Tudo bem."));
  assert(result.reply_draft?.includes("apenas o que souber"));
  assert(result.reply_draft?.includes("NÃO TENHO ESSA INFORMAÇÃO"));
  assertEquals(result.next_state, before);
});

Deno.test("another service name asks whether to open it separately instead of swallowing the current case", async () => {
  const before = waitingForBurialReference("possible-switch");
  const result = await planTurn({
    message_id: "possible-switch-message",
    text: "Recadastro",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assertEquals(result.outcome, "CLARIFICATION");
  assert(result.reply_draft?.includes("novo atendimento de recadastro"));
  assert(result.reply_draft?.includes("continuar o atendimento de exumação"));
  assertEquals(result.next_state, before);
});

Deno.test("explicitly named new attendance opens a separate goal and preserves the prior exhumation", async () => {
  const before = waitingForBurialReference("new-named-attendance");
  const result = await planTurn({
    message_id: "new-named-attendance-message",
    text: "Novo atendimento de recadastro",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, interpreter);

  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.goals.filter((goal) => goal.goal_code === "GOAL_EXUMACAO").length, 1);
  assertEquals(result.next_state.goals.filter((goal) => goal.goal_code === "GOAL_RECADASTRO").length, 1);
  assertEquals(result.next_state.pending_question?.fact_code, "concession_reference");
});
