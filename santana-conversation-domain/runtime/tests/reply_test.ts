import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, applyEvent, type ConversationState, initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { contextFromState, toConversationEvents } from "../interpreter/bridge.ts";
import { contextualExplanation, contextualStatus, draftReply } from "../reply.ts";
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
  assert(answered.reply_draft?.includes("esposo(a) ou companheiro(a)"));
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

Deno.test("gavetas answers the pending exhumation purpose without opening an ossuary side goal", async () => {
  const started = await planTurn({
    message_id: "exhumation-drawer-start",
    text: "Quero realizar a exumação",
    state: initState("exhumation-drawer"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const answered = await planTurn({
    message_id: "exhumation-drawer-answer",
    text: "Quero colocar nas gavetas",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(answered.outcome, "PROPOSED");
  assertEquals(answered.next_state.pending_question?.fact_code, "surviving_spouse_status");
  assertEquals(answered.next_state.goals.map((goal) => goal.goal_code), ["GOAL_EXUMACAO"]);
  assert(answered.reply_draft?.startsWith("Entendi, você quer colocar os restos no ossuário."));
});

Deno.test("short no answers the pending spouse question and advances instead of repeating it", async () => {
  const started = await planTurn({
    message_id: "spouse-short-start",
    text: "Quero realizar a exumação para colocar no ossuário",
    state: initState("spouse-short"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const answered = await planTurn({
    message_id: "spouse-short-no",
    text: "Não",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(answered.outcome, "PROPOSED");
  assert(
    answered.next_state.facts.some((fact) => fact.fact_code === "surviving_spouse_status" && fact.value === "FALECIDO"),
  );
  assert(answered.next_state.pending_question?.fact_code !== "surviving_spouse_status");
  assert(answered.reply_draft?.startsWith("Entendi."));
});

Deno.test("short yes answers the pending spouse question as alive", async () => {
  const started = await planTurn({
    message_id: "spouse-short-yes-start",
    text: "Quero realizar a exumação para colocar no ossuário",
    state: initState("spouse-short-yes"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const answered = await planTurn({
    message_id: "spouse-short-yes",
    text: "Sim",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assert(
    answered.next_state.facts.some((fact) => fact.fact_code === "surviving_spouse_status" && fact.value === "VIVO"),
  );
  assert(answered.next_state.pending_question?.fact_code !== "surviving_spouse_status");
});

async function waitingExhumationState(id: string) {
  const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };
  const started = await planTurn({
    message_id: id + "-start",
    text: "Quero realizar a exumação para colocar no ossuário",
    state: initState(id),
    automation_mode: "BOT_ACTIVE",
  }, interpreter);
  return (await planTurn({
    message_id: id + "-spouse",
    text: "Não",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, interpreter)).next_state;
}

Deno.test("greeting during a waiting exhumation reports status without changing the case facts or decisions", async () => {
  const before = await waitingExhumationState("waiting-greeting");
  let interpreted = false;
  const result = await planTurn({
    message_id: "waiting-greeting-return",
    text: "Olá",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, {
    interpret: (input) => {
      interpreted = true;
      return Promise.resolve(interpret(input));
    },
  });

  assert(interpreted, "status must not bypass the interpreter");
  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.facts, before.facts);
  assertEquals(result.next_state.goals, before.goals);
  assertEquals(result.next_state.pending_actions, before.pending_actions);
  assert(result.reply_draft?.startsWith("Olá! Seu atendimento de exumação continua ativo"));
  assert(result.reply_draft?.includes("aguarda a verificação da autorização"));
});

Deno.test("repeating exhumation during its human check resumes status instead of generic clarification", async () => {
  const before = await waitingExhumationState("waiting-repeat");
  const result = await planTurn({
    message_id: "waiting-repeat-request",
    text: "Quero realizar exumação",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.next_state.facts, before.facts);
  assertEquals(result.next_state.goals, before.goals);
  assertEquals(result.next_state.pending_actions, before.pending_actions);
  assert(result.reply_draft?.startsWith("Seu atendimento de exumação já está em andamento"));
  assert(!result.reply_draft?.includes("explique um pouco melhor"));
});

Deno.test("returning to a legacy waiting snapshot recovers the useful question without resetting the case", async () => {
  const before = await waitingExhumationState("legacy-waiting-return");
  before.pending_question = null;
  const result = await planTurn({
    message_id: "legacy-waiting-return-message",
    text: "Olá",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  assertEquals(result.next_state.pending_question?.fact_code, "burial_reference");
  assert(result.reply_draft?.includes(result.question_draft!));
  assertEquals(result.next_state.facts, before.facts);
  assertEquals(result.next_state.goals, before.goals);
  assertEquals(result.next_state.pending_actions, before.pending_actions);
  assertEquals(result.next_state.seq, before.seq + 1);
});

const waitingRegressions = [
  "Quais os valores da exumação?",
  "Corrigindo: a exumação será para cremação",
  "Quero cancelar a exumação",
  "A exumação é de José, quadra 15",
  "Gostaria de falar com um atendente sobre a exumação",
  "Exumação da minha tia também",
];

for (const [index, text] of waitingRegressions.entries()) {
  Deno.test(`waiting status preserves the interpreted intent: ${text}`, async () => {
    const before = await waitingExhumationState(`waiting-regression-${index}`);
    let interpreted = false;
    const result = await planTurn({
      message_id: `waiting-regression-${index}-reply`,
      text,
      state: before,
      automation_mode: "BOT_ACTIVE",
    }, {
      interpret: (input) => {
        interpreted = true;
        assertEquals(input.context.open_goal_code, "GOAL_EXUMACAO");
        const candidate = interpret(input);
        assertEquals(contextualStatus(before, text, candidate), null);
        return Promise.resolve(candidate);
      },
    });
    assert(interpreted);
    assert(result.outcome !== "INTERPRETATION_UNAVAILABLE");
    if (index === 0) {
      assertEquals(result.next_state, before, "a tariff question cannot open another case or authorize a service");
    } else if (index === 1) {
      const goal = result.next_state.goals.find((item) => item.goal_code === "GOAL_EXUMACAO")!;
      assertEquals(activeFact(result.next_state, "exhumation_purpose", goal)?.value, "CREMACAO");
      assert(result.reply_draft?.includes("correção"));
    } else if (index === 2) {
      assert(result.next_state.handoff !== null);
      assert(result.reply_draft?.includes("pedido de cancelamento"));
      assert(!result.reply_draft?.includes("foi cancelad"));
    } else if (index === 3) {
      const goal = result.next_state.goals.find((item) => item.goal_code === "GOAL_EXUMACAO")!;
      assertEquals(activeFact(result.next_state, "burial_reference", goal)?.value, "quadra 15");
    } else if (index === 4) {
      assertEquals(result.next_state.handoff?.goal_code, "GOAL_EXUMACAO");
      assert(result.reply_draft?.includes("pedido de encaminhamento"));
    } else if (index === 5) {
      assertEquals(result.next_state.cases.length, before.cases.length + 1);
      const newest = result.next_state.goals.at(-1)!;
      assertEquals(activeFact(result.next_state, "exhumation_purpose", newest), null);
      assertEquals(result.next_state.pending_question?.fact_code, "exhumation_purpose");
    }
  });
}

Deno.test("waiting interpreter focus ignores an old resolved information goal and isolates case facts", async () => {
  let before = await waitingExhumationState("waiting-with-history");
  before = applyEvent(before, {
    kind: "PARALLEL_QUESTION",
    goal_code: "GOAL_INFO_OSSUARIO",
    facts: [{ code: "ossuary_information_request", value: "Dúvida anterior" }],
  });
  const context = contextFromState(before);
  assertEquals(context.open_goal_code, "GOAL_EXUMACAO");
  assert(context.known_facts?.some((fact) => fact.fact_code === "exhumation_purpose" && fact.value === "OSSUARIO"));
  const another = applyEvent(before, { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO", case_ref: "other-deceased" });
  assert(!contextFromState(another).known_facts?.some((fact) => fact.fact_code === "exhumation_purpose"));
});

Deno.test("a purpose correction in waiting context needs no repeated service keyword", async () => {
  const before = await waitingExhumationState("waiting-purpose-short-correction");
  const result = await planTurn({
    message_id: "waiting-purpose-short-correction-message",
    text: "Na verdade, quero cremação",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const goal = result.next_state.goals.find((item) => item.goal_code === "GOAL_EXUMACAO")!;
  assertEquals(activeFact(result.next_state, "exhumation_purpose", goal)?.value, "CREMACAO");
  assertEquals(result.next_state.goals.length, before.goals.length);
});

Deno.test("a greeting with an additional question never becomes pure waiting status", async () => {
  const before = await waitingExhumationState("waiting-mixed-greeting");
  const text = "Olá, quais são os valores da exumação?";
  assertEquals(
    contextualStatus(
      before,
      text,
      interpret({
        message_id: "mixed-greeting",
        text,
        context: contextFromState(before),
      }),
    ),
    null,
  );
});

Deno.test("an explanation prefix does not swallow a separate official information question", () => {
  const state = applyEvent(initState("explanation-information"), { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO" });
  assertEquals(contextualExplanation(state, "Pode explicar os valores da exumação?"), null);
  assertEquals(contextualExplanation(state, "Me explica os documentos necessários"), null);
  assert(contextualExplanation(state, "Não entendi essa pergunta")?.includes("após a exumação"));
});

Deno.test("every citizen-facing catalog question has a contextual explanation", () => {
  const base = applyEvent(initState("all-question-explanations"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
  });
  const factCodes = [
    "remains_status",
    "transport_destination",
    "destination_grave_reference",
    "transport_date_preference",
    "exhumation_purpose",
    "surviving_spouse_status",
    "burial_reference",
    "recadastro_status",
    "concession_reference",
    "recadastro_holder_document",
    "concession_purpose",
    "commercial_item",
    "commercial_stage",
    "commercial_delivery_status",
    "complaint_description",
    "grave_service_description",
    "ossuary_information_request",
    "service_hours_request",
    "other_subject_description",
    "requester_document",
  ];

  for (const factCode of factCodes) {
    const state = structuredClone(base);
    state.pending_question = {
      question_code: `AUDIT_${factCode}`,
      fact_code: factCode,
      goal_id: state.goals[0]!.goal_id,
      priority_class: "NEXT_ACTION_DATA",
      asked_at_seq: state.seq,
    };
    const explanation = contextualExplanation(state, "Não entendi essa pergunta");
    assert(explanation, `missing contextual explanation for ${factCode}`);
    assert(explanation.length > 40, `contextual explanation is too short for ${factCode}`);
  }
});

Deno.test("why is this needed requests explain the pending question without changing state", async () => {
  const started = await planTurn({
    message_id: "why-needed-start",
    text: "Quero fazer uma transferência de concessão",
    state: initState("why-needed"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  const before = structuredClone(started.next_state);
  const explained = await planTurn({
    message_id: "why-needed-question",
    text: "Por que precisa disso?",
    state: started.next_state,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(explained.outcome, "CLARIFICATION");
  assertEquals(explained.next_state, before);
  assert(explained.reply_draft?.includes("concessão"));
});

Deno.test("answers in non-exhumation journeys are acknowledged before the next question", async () => {
  const started = await planTurn({
    message_id: "commercial-ack-start",
    text: "Quero um orçamento de lápide",
    state: initState("commercial-ack"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });

  assertEquals(started.outcome, "PROPOSED");
  assertEquals(started.next_state.pending_question?.fact_code, "requester_document");
  assert(started.reply_draft?.startsWith("Entendi."));
  assert(started.reply_draft?.includes("documento"));
});

Deno.test("a grave service description without complaint receives the completion instruction", async () => {
  const result = await planTurn({
    message_id: "grave-cleaning",
    text: "Quero limpeza do meu jazigo",
    state: initState("grave-cleaning"),
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  assertEquals(result.next_state.pending_question, null);
  assert(result.reply_draft?.includes("FINALIZAR"));
  assertEquals(result.next_state.handoff, null);
});

Deno.test("a negated cancellation does not request a cancellation or handoff", async () => {
  const before = await waitingExhumationState("negated-cancellation");
  const result = await planTurn({
    message_id: "negated-cancellation-message",
    text: "Não quero cancelar a exumação",
    state: before,
    automation_mode: "BOT_ACTIVE",
  }, { interpret: (input) => Promise.resolve(interpret(input)) });
  assertEquals(result.next_state.handoff, null);
  assert(!result.reply_draft?.includes("pedido de cancelamento"));
});

Deno.test("a new goal for the current person reuses the pinned case rather than a bare kinship hint", () => {
  const before = applyEvent(initState("current-person-new-goal"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "meu pai:first-message",
  });
  const candidate = interpret({
    message_id: "current-person-second-goal",
    text: "Quero transportar meu pai",
    context: contextFromState(before),
  });
  const bridge = toConversationEvents({
    ...candidate,
    primary_event: { event_kind: "NEW_GOAL", confidence: "HIGH", evidence: "Quero transportar meu pai" },
    case_reference: { kind: "CURRENT", subject_kind: "DECEASED", subject_hint: "meu pai", confidence: "HIGH" },
    needs_clarification: false,
  }, before);
  assertEquals(bridge.events[0]?.case_ref, "meu pai:first-message");
  const after = bridge.events.reduce(applyEvent, before);
  assertEquals(after.cases.length, 1);
  assertEquals(after.goals.at(-1)?.case_id, before.goals[0]?.case_id);
});

for (
  const goalCode of [
    "GOAL_RECADASTRO",
    "GOAL_COMERCIAL",
    "GOAL_CONCESSAO",
    "GOAL_TRANSPORTE",
    "GOAL_RECLAMACAO",
    "GOAL_INFO_HORARIO",
    "GOAL_INFO_OSSUARIO",
    "GOAL_OUTROS_ASSUNTOS",
  ]
) {
  Deno.test(`completed collection has an honest next-step reply: ${goalCode}`, () => {
    const state: ConversationState = initState(`completion-${goalCode}`);
    const template = applyEvent(initState("template"), { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO" }).goals[0]!;
    state.goals.push({
      ...template,
      goal_code: goalCode,
      status: "RESOLVED",
      closed_at_seq: 1,
      informational: goalCode.startsWith("GOAL_INFO_"),
    });
    const reply = draftReply({ outcome: "PROPOSED", question_draft: null, interpretation: null, next_state: state });
    assert(reply !== null);
    assert(reply.includes("equipe"));
    assert(!reply.includes("protocolo"));
    assert(!reply.includes("serviço foi realizado"));
    if (goalCode.startsWith("GOAL_INFO_")) assert(reply.includes("Ainda não há uma resposta oficial confirmada"));
  });
}

Deno.test("an old completed information goal cannot produce a new completion claim", () => {
  const state = applyEvent(initState("old-completion"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_INFO_HORARIO",
    facts: [{ code: "service_hours_request", value: "Horário?" }],
  });
  assertEquals(
    draftReply({
      outcome: "PROPOSED",
      question_draft: null,
      interpretation: null,
      next_state: state,
      previous_state: state,
    }),
    null,
  );
});
