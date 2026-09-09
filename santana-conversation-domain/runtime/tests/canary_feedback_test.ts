import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { applyEvent, initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { contextFromState } from "../interpreter/bridge.ts";
import { ControlledLlmAdapter } from "../adapter/adapter.ts";
import { planTurn } from "../turn.ts";
import { officialInformationReply } from "../official_information.ts";
import { isConversationClose, isConversationReturn, isGreeting } from "../interpreter/conversation_controls.ts";

function legacyWaiting() {
  let state = applyEvent(initState("canary-feedback"), { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "exhumation_purpose", value: "OSSUARIO" }] });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "surviving_spouse_status", value: "FALECIDO" }] });
  state.pending_question = null; // Shape of the existing conversation before the observed test.
  return state;
}
const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };

for (const text of ["Preços da exumação", "Valores", "Horário", "Documentos necessários para exumação"]) {
  Deno.test(`canary feedback nominal information: ${text}`, async () => {
    const state = legacyWaiting();
    const before = structuredClone(state);
    const reply = await officialInformationReply({ text, state, referenceDate: "2026-09-09" });
    assert(reply !== null);
    assert(!reply.text.includes("Diga qual dessas ações"));
    if (/Preços|Valores/.test(text)) {
      assertEquals(reply.information_type, "PRECO");
      assert(reply.status !== "AVAILABLE");
      assert(!/R\$|\d+,\d{2}/.test(reply.text));
    }
    assertEquals(state, before);
  });
}
for (const text of ["Olá, quero continuar meu atendimento", "Ooooi", "Quero retomar meu pedido"]) {
  Deno.test(`canary feedback resumes legacy collection: ${text}`, async () => {
    const state = legacyWaiting();
    const result = await planTurn({ text, message_id: text, state, automation_mode: "BOT_ACTIVE" }, interpreter);
    assertEquals(result.outcome, "PROPOSED");
    assertEquals(result.next_state.pending_question?.fact_code, "burial_reference");
    assertEquals(result.next_state.facts, state.facts);
    assertEquals(result.next_state.cases, state.cases);
    assertEquals(result.next_state.handoff, null);
    assert(!result.reply_draft?.includes("Diga qual dessas ações"));
  });
}
for (const text of ["Encerrar", "Encarrar atendimento?", "Quero encerrar meu atendimento"]) {
  Deno.test(`canary feedback closes automatic exchange without cancelling service: ${text}`, async () => {
    const state = legacyWaiting();
    const result = await planTurn({ text, message_id: text, state, automation_mode: "BOT_ACTIVE" }, interpreter);
    assertEquals(result.outcome, "PROPOSED");
    assert(result.next_state.handoff !== null);
    assertEquals(result.next_state.goals[0]?.status, "WAITING");
    assertEquals(result.next_state.facts, state.facts);
    assert(result.reply_draft?.includes("respostas automáticas ficam pausadas"));
    assert(result.reply_draft?.includes("não cancela"));
    const later = await planTurn({
      text: "Preços da exumação",
      message_id: "later",
      state: result.next_state,
      automation_mode: "HUMAN_ACTIVE",
    }, interpreter);
    assertEquals(later.reply_draft, null);
    assertEquals(later.next_state, result.next_state);
  });
}
Deno.test("canary feedback explicit return survives an unhelpful LLM interpretation", async () => {
  const state = legacyWaiting();
  const input = {
    message_id: "return-llm",
    text: "Olá, quero continuar meu atendimento",
    context: contextFromState(state),
  };
  const candidate = {
    ...interpret(input),
    primary_event: null,
    overall_confidence: "LOW",
    needs_clarification: true,
    clarification_reason: "Não identificado",
  };
  const adapter = new ControlledLlmAdapter({
    enabled: true,
    provider: {
      name: "fixture",
      model: "fixture",
      createRequest: () => ({ url: "https://invalid.test", headers: {}, body: "" }),
      extractText: (body) => body,
    },
    network: () => Promise.resolve({ status: 200, body: JSON.stringify(candidate) }),
  });
  const result = await planTurn({ ...input, state, automation_mode: "BOT_ACTIVE" }, adapter);
  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.pending_question?.fact_code, "burial_reference");
});
Deno.test("canary feedback controls do not swallow negations, other cases or mixed questions", async () => {
  for (
    const text of [
      "Não quero encerrar",
      "Quero encerrar a exumação e iniciar outra",
      "Olá, quais os preços?",
      "Quero continuar o atendimento do outro falecido",
    ]
  ) {
    assert(!isGreeting(text));
    assert(!isConversationReturn(text));
    assert(!isConversationClose(text));
  }
  for (const text of ["Preços da exumação, mas quero cancelar", "Documento 123456", "Já enviei os documentos"]) {
    assertEquals(await officialInformationReply({ text, state: legacyWaiting() }), null);
  }
});
