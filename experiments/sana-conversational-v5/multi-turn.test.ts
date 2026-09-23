/** Multi-turn LAB evidence. Canonical reducer is real; every model response is scripted. */
import { initState, type ConversationState } from "../../santana-conversation-domain/engine/engine.ts";
import { interpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../../santana-conversation-domain/runtime/interpreter/guard.ts";
import { contextFromState } from "../../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { officialBridge } from "./official-adapter.ts";
import { contextPack, runPreview, type Knowledge, type Message, type Plan } from "./core.ts";

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    conversationId: "multi-turn-fixture",
    sessionId: "multi-turn-session",
    role: "user",
    text,
  };
}

function interpreted(state: ConversationState, message: Message) {
  return guardInterpretation(interpret({
    message_id: message.id,
    text: message.text,
    context: contextFromState(state),
  }));
}

function request(
  state: ConversationState,
  message: Message,
  history: Message[],
) {
  return {
    mode: "simulation" as const,
    state,
    message,
    correlationId: `fixture-${message.id}`,
    referenceDate: "2026-09-23",
    history,
    automaticRepliesAllowed: true,
  };
}

function plan(
  action: Plan["action"],
  interpretation: Record<string, unknown> | null,
  questions: Plan["questions"] = [],
  askFollowup = false,
): Plan {
  return { action, interpretation, questions, askFollowup };
}

function scriptedModel(...outputs: unknown[]) {
  const pending = [...outputs];
  let calls = 0;
  return {
    name: "scripted-not-gemini",
    get calls() { return calls; },
    async generate(_system: string, _data: unknown, _signal: AbortSignal) {
      calls++;
      const next = pending.shift();
      assert(next !== undefined, "no unplanned model call");
      return structuredClone(next);
    },
  };
}

function summarize(state: ConversationState) {
  const snapshot = officialBridge().snapshot(state);
  const pendingGoal = state.goals.find((goal) => goal.goal_id === state.pending_question?.goal_id);
  return {
    seq: snapshot.seq,
    goals: state.goals.map((goal) => ({
      goal_code: goal.goal_code,
      case_id: goal.case_id,
      status: goal.status,
    })),
    activeFacts: snapshot.facts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      caseId: fact.caseId,
    })),
    pending: snapshot.pending ? {
      key: snapshot.pending.key,
      goalId: state.pending_question?.goal_id ?? null,
      caseId: pendingGoal?.case_id ?? null,
    } : null,
  };
}

Deno.test("multi-turn: answer first, apply correction, then pause with state preserved", async () => {
  const bridge = officialBridge();
  const initial = initState("multi-turn-fixture");

  const first = userMessage("turn-1", "Quero exumar meu pai. A companheira está viva.");
  const firstInterpretation = interpreted(initial, first);
  const firstOperational = await bridge.preview(initial, first, firstInterpretation as unknown as Record<string, unknown>);
  assert(firstOperational.outcome === "PROPOSED", "turn 1 accepted by canonical reducer");
  const firstPending = bridge.snapshot(firstOperational.state).pending;
  assert(firstPending !== null, "reducer exposes one remaining question");

  const firstModel = scriptedModel(
    plan("CONTINUE", firstInterpretation as unknown as Record<string, unknown>, [], true),
    { parts: [{ kind: "question", text: firstPending.text, sourceIds: [] }] },
  );
  const turn1 = await runPreview(request(initial, first, []), { bridge, model: firstModel });
  const state1 = turn1.stateCandidate as ConversationState;
  assert(turn1.status === "DRAFT", "turn 1 returns a draft");
  assert(state1.cases.length === 1 && state1.goals[0]?.goal_code === "GOAL_EXUMACAO", "turn 1 creates one scoped case and goal");
  assert(bridge.snapshot(state1).facts.some((fact) => fact.key === "surviving_spouse_status" && fact.value === "VIVO"), "turn 1 preserves the stated relationship fact");

  const second = userMessage("turn-2", "Na verdade, ele não tinha companheira e quais documentos preciso levar?");
  const correctionBase = interpreted(state1, second);
  const correctionInterpretation = guardInterpretation({
    ...correctionBase,
    facts: [
      ...correctionBase.facts.filter((fact) => fact.fact_code !== "surviving_spouse_status"),
      {
        fact_code: "surviving_spouse_status",
        value: "INEXISTENTE",
        source: "USER_CORRECTION",
        confidence: "HIGH",
        evidence: "não tinha companheira",
        requires_confirmation: false,
      },
    ],
  });
  const secondOperational = await bridge.preview(state1, second, correctionInterpretation as unknown as Record<string, unknown>);
  assert(secondOperational.outcome === "PROPOSED", "turn 2 correction accepted by canonical reducer");
  const state2Expected = secondOperational.state;
  const activeSpouseFacts = bridge.snapshot(state2Expected).facts.filter((fact) => fact.key === "surviving_spouse_status");
  assert(activeSpouseFacts.length === 1 && activeSpouseFacts[0]?.value === "INEXISTENTE", "correction supersedes old active value in the same case");
  const pendingAfterCorrection = bridge.snapshot(state2Expected).pending;
  assert(pendingAfterCorrection !== null && pendingAfterCorrection.key !== "surviving_spouse_status", "only an unanswered fact remains pending");

  const fictionalKnowledge: Knowledge = {
    id: "fixture:not-official:documents",
    version: "fixture-only-v1",
    kind: "DOCUMENTOS",
    status: "AVAILABLE",
    text: "[DADO FICTÍCIO DE TESTE — NÃO É REGRA OFICIAL] Lista simulada apenas para provar a ordem da resposta.",
  };
  bridge.lookup = async () => fictionalKnowledge;
  const secondModel = scriptedModel(
    plan("CONTINUE", correctionInterpretation as unknown as Record<string, unknown>, [{ kind: "DOCUMENTOS", evidence: "quais documentos preciso levar" }], true),
    {
      parts: [
        { kind: "information", text: fictionalKnowledge.text, sourceIds: [fictionalKnowledge.id] },
        { kind: "question", text: pendingAfterCorrection.text, sourceIds: [] },
      ],
    },
  );
  const history = [
    first,
    { ...first, id: "reply-1", role: "assistant" as const, text: turn1.text ?? "" },
  ];
  const turn2 = await runPreview(request(state1, second, history), { bridge, model: secondModel });
  const state2 = turn2.stateCandidate as ConversationState;
  assert(turn2.status === "DRAFT", "turn 2 returns a draft");
  assert(turn2.text?.includes(fictionalKnowledge.text), "explicitly fictional fixture is recoverable for composition");
  assert(turn2.text!.indexOf(fictionalKnowledge.text) < turn2.text!.indexOf(pendingAfterCorrection.text), "answers the parallel question before resuming collection");
  assert(!/companheira\?/i.test(turn2.text!), "does not repeat the corrected relationship question");
  assert(bridge.snapshot(state2).facts.some((fact) => fact.key === "surviving_spouse_status" && fact.value === "INEXISTENTE"), "correction survives into next turn");

  const third = userMessage("turn-3", "Vou verificar e volto depois.");
  const beforePause = JSON.stringify(state2);
  const pauseModel = scriptedModel(
    plan("PAUSE", null, [], false),
    { parts: [{ kind: "ack", text: "Tudo bem, sem pressa.", sourceIds: [] }] },
  );
  const history2 = [
    ...history,
    second,
    { ...second, id: "reply-2", role: "assistant" as const, text: turn2.text ?? "" },
  ];
  const turn3 = await runPreview(request(state2, third, history2), { bridge, model: pauseModel });
  const state3 = turn3.stateCandidate as ConversationState;
  assert(turn3.status === "DRAFT" && turn3.text === "Tudo bem, sem pressa.", "pause is acknowledged without forcing continuation");
  assert(JSON.stringify(state3) === beforePause, "pause preserves all state and pending information");

  const fourth = userMessage("turn-4", "Agora é sobre meu tio, quero exumar.");
  const fourthInterpretation = interpreted(state3, fourth);
  const fourthOperational = await bridge.preview(state3, fourth, fourthInterpretation as unknown as Record<string, unknown>);
  assert(fourthOperational.outcome === "PROPOSED", "new person is accepted as a separate case");
  const fourthPending = bridge.snapshot(fourthOperational.state).pending;
  assert(fourthPending !== null, "new case receives its own pending fact");
  const fourthModel = scriptedModel(
    plan("CONTINUE", fourthInterpretation as unknown as Record<string, unknown>, [], true),
    { parts: [{ kind: "question", text: fourthPending.text, sourceIds: [] }] },
  );
  const history3 = [
    ...history2,
    third,
    { ...third, id: "reply-3", role: "assistant" as const, text: turn3.text ?? "" },
  ];
  const turn4 = await runPreview(request(state3, fourth, history3), { bridge, model: fourthModel });
  const state4 = turn4.stateCandidate as ConversationState;
  const turn4Context = contextPack(bridge.snapshot(state4), fourth, history3);
  assert(state4.cases.length === 2, "second deceased person gets a second case");
  assert(state4.goals.length === 2 && state4.goals[1]?.case_id !== state4.goals[0]?.case_id, "goals remain bound to separate cases");
  assert(turn4Context.facts.every((fact) => fact.caseId === state4.goals[1]?.case_id), "first person's facts are excluded from second person's model context");

  console.log("MULTITURN_EVIDENCE", JSON.stringify([
    { input: first.text, previous: summarize(initial), decision: turn1.telemetry.action, modelCalls: turn1.telemetry.modelCalls, response: turn1.text, next: summarize(state1), result: "PASS" },
    { input: second.text, previous: summarize(state1), decision: turn2.telemetry.action, modelCalls: turn2.telemetry.modelCalls, response: turn2.text, next: summarize(state2), result: "PASS" },
    { input: third.text, previous: summarize(state2), decision: turn3.telemetry.action, modelCalls: turn3.telemetry.modelCalls, response: turn3.text, next: summarize(state3), result: "PASS" },
    { input: fourth.text, previous: summarize(state3), decision: turn4.telemetry.action, modelCalls: turn4.telemetry.modelCalls, response: turn4.text, next: summarize(state4), result: "PASS" },
  ], null, 2));
  console.log("SECOND_CASE_CONTEXT", JSON.stringify({ factKeys: turn4Context.facts.map((fact) => fact.key), result: "PASS" }));
});

Deno.test("clarifies a genuine ambiguity when no reducer question is pending", async () => {
  const bridge = officialBridge();
  const state = initState("multi-turn-fixture");
  const message = userMessage("ambiguous-turn", "Meu pai ficou lá. O que eu faço?");
  const model = scriptedModel(
    plan("CLARIFY", null, [], true),
    { parts: [{ kind: "question", text: "Você se refere ao local onde ele foi sepultado?", sourceIds: [] }] },
  );
  const result = await runPreview(request(state, message, []), { bridge, model });
  assert(result.status === "DRAFT", "CLARIFY works without pending reducer state");
  assert(bridge.snapshot(result.stateCandidate as ConversationState).pending === null, "no fake reducer question was introduced");
  assert(result.text === "Você se refere ao local onde ele foi sepultado?", "one focused clarification is returned");
  console.log("CLARIFICATION_EVIDENCE", JSON.stringify({
    input: message.text,
    previous: summarize(state),
    decision: result.telemetry.action,
    modelCalls: result.telemetry.modelCalls,
    response: result.text,
    next: summarize(result.stateCandidate as ConversationState),
    result: "PASS",
  }));
});

Deno.test("knowledge gaps and conflicts remain explicit and fictional fixtures stay non-official", async () => {
  for (const [status, text] of [
    ["NOT_AVAILABLE", "[TESTE FICTÍCIO — NÃO OFICIAL] Lacuna simulada: fonte não disponível."],
    ["CONFLICT", "[TESTE FICTÍCIO — NÃO OFICIAL] Conflito simulado: duas versões sem autoridade definida."],
  ] as const) {
    const bridge = officialBridge();
    const fixture: Knowledge = {
      id: `fixture:not-official:${status.toLowerCase()}`,
      version: "fixture-only-v1",
      kind: "DOCUMENTOS",
      status,
      text,
    };
    bridge.lookup = async () => fixture;
    const state = initState("multi-turn-fixture");
    const message = userMessage(`knowledge-${status.toLowerCase()}`, "Quais documentos?");
    const model = scriptedModel(
      plan("ANSWER", null, [{ kind: "DOCUMENTOS", evidence: "Quais documentos?" }], false),
      { parts: [{ kind: "ack", text: "Não vou afirmar uma lista sem fonte definida.", sourceIds: [] }] },
    );
    const result = await runPreview(request(state, message, []), { bridge, model });
    assert(result.status === "DRAFT" && result.text?.includes(text), `${status} remains explicit`);
    assert(!result.text?.includes("Certidão de óbito"), `${status} does not invent official documents`);
    assert(JSON.stringify(result.stateCandidate) === JSON.stringify(state), "information lookup does not alter case state");
    console.log("KNOWLEDGE_FIXTURE_EVIDENCE", JSON.stringify({
      status,
      input: message.text,
      previous: summarize(state),
      decision: result.telemetry.action,
      modelCalls: result.telemetry.modelCalls,
      response: result.text,
      next: summarize(result.stateCandidate as ConversationState),
      result: "PASS",
    }));
  }
});
