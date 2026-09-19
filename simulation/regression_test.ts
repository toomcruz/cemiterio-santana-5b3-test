import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { clarificationQuestion, toConversationEvents } from "../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { isConversationClose, isConversationReturn } from "../santana-conversation-domain/runtime/interpreter/conversation_controls.ts";
import { interpret } from "../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../santana-conversation-domain/runtime/interpreter/guard.ts";
import { initState } from "../santana-conversation-domain/engine/engine.ts";

Deno.test("clarification labels do not expose canonical enum codes", () => {
  const state = initState("regression-clarification");
  const interpretation = guardInterpretation(interpret({
    message_id: "m1",
    text: "Quero localizar o jazigo.",
    context: { has_open_goal: false, open_goal_code: null, pending_question_fact: null, known_subject_hints: [], known_facts: [], active_case_id: null, active_goal_status: null, handoff_active: false, parallel_goal_codes: [], pending_action_codes: [] },
  }));
  const bridge = toConversationEvents(interpretation, state);
  const reply = clarificationQuestion(state, bridge) ?? "";
  assertStringIncludes(reply, "jazigo da família");
  assertFalse(/JAZIGO_FAMILIA|OUTRO_CEMITERIO|COMPRA_DE_JAZIGO/.test(reply));
});

Deno.test("natural close and return controls are recognized", () => {
  assert(isConversationClose("Pode encerrar por enquanto."));
  assert(isConversationClose("Quero encerrar esta conversa agora."));
  assert(isConversationReturn("Voltei ao assunto do jazigo."));
  assert(isConversationReturn("Volto para continuar o atendimento do jazigo."));
  assertFalse(isConversationClose("Não quero encerrar agora."));
});

Deno.test("natural close is a committed SOCIAL close, not an unrecorded handoff", () => {
  const context = { has_open_goal: true, open_goal_code: "GOAL_JAZIGO_SERVICOS", pending_question_fact: null, known_subject_hints: [], known_facts: [], active_case_id: "case-1", active_goal_status: "ACTIVE", handoff_active: false, parallel_goal_codes: [], pending_action_codes: [] };
  const close = guardInterpretation(interpret({ message_id: "m-close", text: "Pode encerrar por enquanto.", context }));
  assertEquals(close.primary_event?.event_kind, "SOCIAL");
  assertEquals(close.official_mapping?.transverse_states, ["CONVERSATION_CLOSING"]);
  const bridged = toConversationEvents(close, initState("regression-close"));
  assertEquals(bridged.events[0]?.kind, "SOCIAL");
  assertEquals(bridged.events[0]?.close_conversation, true);
});

Deno.test("clarification fallback remains safe for unknown options", () => {
  const reply = clarificationQuestion(initState("regression-safe"), { clarification: { reason: "test", options: ["UNKNOWN_OPTION"] }, events: [] });
  assertEquals(reply, "Para eu direcionar corretamente, você se refere a unknown_option?");
});

Deno.test("grave reference correction marker is classified as CORRECTION", () => {
  const context = {
    has_open_goal: true,
    open_goal_code: "GOAL_JAZIGO_SERVICOS",
    pending_question_fact: "grave_service_description",
    known_subject_hints: [],
    known_facts: [{ fact_code: "grave_reference", value: "quadra 2, terreno 8", confidence: "HIGH", source: "USER_EXPLICIT" }],
    active_case_id: "case-1",
    active_goal_status: "ACTIVE",
    handoff_active: false,
    parallel_goal_codes: [],
    pending_action_codes: [],
  };
  const interpretation = guardInterpretation(interpret({
    message_id: "m-correction",
    text: "A quadra que passei estava errada.",
    context,
  }));
  assertEquals(interpretation.primary_event?.event_kind, "CORRECTION");
  assertEquals(toConversationEvents(interpretation, initState("regression-correction")).events[0]?.kind, "CORRECTION");
});

Deno.test("colloquial grandmother grave request is not treated as destination ambiguity", () => {
  const interpretation = guardInterpretation(interpret({
    message_id: "m-grandmother",
    text: "Quero localizar o jazigo da minha vó.",
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
      known_facts: [],
      active_case_id: null,
      active_goal_status: null,
      handoff_active: false,
      parallel_goal_codes: [],
      pending_action_codes: [],
    },
  }));
  assertEquals(interpretation.goal?.goal_code, "GOAL_JAZIGO_SERVICOS");
  assertEquals(interpretation.ambiguities.length, 0);
});
