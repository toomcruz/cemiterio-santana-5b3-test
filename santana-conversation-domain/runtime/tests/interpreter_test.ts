// 5B.4-C: mensagem -> interpretacao -> guarda -> reducer.
// Nenhuma rede, nenhum LLM, nenhum banco. Todos os casos vem de fixtures.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { interpret, normalize } from "../interpreter/deterministic.ts";
import { assertNoAuthorityEscalation, guardInterpretation } from "../interpreter/guard.ts";
import { contextFromState, toConversationEvents } from "../interpreter/bridge.ts";
import { activeFact, applyEvent, type ConversationState, focusGoal, initState } from "../../engine/engine.ts";
import { validateAgainstSchema, validateState } from "../../engine/validate.ts";

interface ExpectedFact {
  fact_code: string;
  value: string;
  source?: string;
}
interface FixtureCase {
  id: string;
  label: string;
  text: string;
  context: { has_open_goal: boolean; pending_question_fact: string | null; known_subject_hints: string[] };
  expect: {
    primary_event?: string;
    goal?: string;
    facts?: ExpectedFact[];
    needs_clarification: boolean;
    case_kind?: string;
    ambiguity?: string;
    refusal?: string;
  };
}

const fixtures = JSON.parse(
  Deno.readTextFileSync(new URL("../fixtures/messages.v1.json", import.meta.url)),
) as { messages: FixtureCase[] };

function run(fixture: FixtureCase) {
  const raw = interpret({
    message_id: fixture.id,
    text: fixture.text,
    context: {
      has_open_goal: fixture.context.has_open_goal,
      open_goal_code: null,
      pending_question_fact: fixture.context.pending_question_fact,
      known_subject_hints: fixture.context.known_subject_hints,
    },
  });
  return guardInterpretation(raw);
}

for (const fixture of fixtures.messages) {
  Deno.test(`${fixture.id} ${fixture.label}`, () => {
    const interpretation = run(fixture);
    assertNoAuthorityEscalation(interpretation);
    assertEquals(
      interpretation.needs_clarification,
      fixture.expect.needs_clarification,
      `${fixture.id} esclarecimento`,
    );

    if (fixture.expect.primary_event) {
      assertEquals(interpretation.primary_event?.event_kind, fixture.expect.primary_event, `${fixture.id} evento`);
    }
    if (fixture.expect.goal) {
      assertEquals(interpretation.goal?.goal_code, fixture.expect.goal, `${fixture.id} objetivo`);
    }
    if (fixture.expect.case_kind) {
      assertEquals(interpretation.case_reference.kind, fixture.expect.case_kind, `${fixture.id} referencia de case`);
    }
    for (const expected of fixture.expect.facts ?? []) {
      const found = interpretation.facts.find((f) => f.fact_code === expected.fact_code);
      assert(found !== undefined, `${fixture.id}: fato ausente ${expected.fact_code}`);
      assertEquals(found?.value, expected.value, `${fixture.id} valor de ${expected.fact_code}`);
      if (expected.source) assertEquals(found?.source, expected.source, `${fixture.id} origem`);
      assert(found!.evidence.length > 0, `${fixture.id}: fato sem evidencia textual`);
    }
    if (fixture.expect.ambiguity) {
      assert(
        interpretation.ambiguities.some((a) => a.code === fixture.expect.ambiguity),
        `${fixture.id}: ambiguidade ${fixture.expect.ambiguity} nao detectada`,
      );
    }
    if (fixture.expect.refusal) {
      assert(
        interpretation.refusals.some((r) => r.reason === fixture.expect.refusal),
        `${fixture.id}: recusa ${fixture.expect.refusal} nao registrada`,
      );
    }
  });
}

Deno.test("GUARD: interpretacao nunca produz fato autoritativo", () => {
  const forbidden = [
    "a autorização do jazigo já está obtida",
    "a família já autorizou a exumação",
    "o jazigo está regular no cadastro",
  ];
  for (const text of forbidden) {
    const interpretation = guardInterpretation(interpret({
      message_id: "GUARD",
      text,
      context: { has_open_goal: true, open_goal_code: null, pending_question_fact: null, known_subject_hints: [] },
    }));
    assertNoAuthorityEscalation(interpretation);
    assertEquals(
      interpretation.facts.some((f) =>
        ["exhumation_authorization", "destination_grave_authorization", "destination_grave_situation"].includes(
          f.fact_code,
        )
      ),
      false,
      `fato autoritativo vazou de: ${text}`,
    );
  }
});

Deno.test("GUARD: fato fora do catalogo e origem proibida sao descartados", () => {
  const base = interpret({
    message_id: "GUARD2",
    text: "ja foi exumado",
    context: { has_open_goal: true, open_goal_code: null, pending_question_fact: null, known_subject_hints: [] },
  });
  const poisoned = {
    ...base,
    facts: [
      ...base.facts,
      {
        fact_code: "preco_da_lapide",
        value: "1200",
        source: "USER_EXPLICIT" as const,
        confidence: "HIGH" as const,
        evidence: "inventado",
        requires_confirmation: false,
      },
      {
        fact_code: "remains_status",
        value: "EXUMADO",
        source: "SYSTEM" as unknown as "USER_EXPLICIT",
        confidence: "HIGH" as const,
        evidence: "escalada",
        requires_confirmation: false,
      },
      {
        fact_code: "transport_destination",
        value: "PARA_A_LUA",
        source: "USER_EXPLICIT" as const,
        confidence: "HIGH" as const,
        evidence: "fora do dominio",
        requires_confirmation: false,
      },
    ],
  };
  const guarded = guardInterpretation(poisoned);
  assertNoAuthorityEscalation(guarded);
  assertEquals(guarded.facts.length, 1);
  assertEquals(guarded.facts[0]?.fact_code, "remains_status");
  const reasons = guarded.refusals.map((r) => r.reason).sort();
  assertEquals(reasons, ["FORBIDDEN_SOURCE", "UNKNOWN_CODE", "VALUE_OUT_OF_DOMAIN"]);
});

Deno.test("BRIDGE: esclarecimento nao vira evento", () => {
  const interpretation = guardInterpretation(interpret({
    message_id: "AMB",
    text: "queria resolver a situação do jazigo",
    context: { has_open_goal: false, open_goal_code: null, pending_question_fact: null, known_subject_hints: [] },
  }));
  const bridged = toConversationEvents(interpretation);
  assertEquals(bridged.events, []);
  assert(bridged.clarification !== null, "ambiguidade bloqueadora deve pedir esclarecimento");
});

Deno.test("E2E: mensagem inicial abre objetivo e grava os dois fatos", () => {
  let state: ConversationState = initState("E2E");
  const interpretation = guardInterpretation(interpret({
    message_id: "M01",
    text: "Meu pai já foi tirado do túmulo e quero levar para outro cemitério",
    context: contextFromState(state),
  }));
  const bridged = toConversationEvents(interpretation);
  for (const event of bridged.events) {
    state = applyEvent(state, event);
    assertEquals(validateState(state), [], "estado invalido apos evento vindo da linguagem");
  }
  const goal = focusGoal(state);
  assertEquals(goal?.goal_code, "GOAL_TRANSPORTE");
  assertEquals(activeFact(state, "remains_status", goal)?.value, "EXUMADO");
  assertEquals(activeFact(state, "transport_destination", goal)?.value, "OUTRO_CEMITERIO");
  assert(!state.goals.some((g) => g.goal_code === "GOAL_EXUMACAO"), "restos ja exumados nao abrem Exumacao");
});

Deno.test("E2E: alegacao de recadastro pelo municipe nao vira OK autoritativo", () => {
  let state: ConversationState = initState("E2E-REC");
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "E2E_CONC" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "TRANSFERENCIA" }] });

  const interpretation = guardInterpretation(interpret({
    message_id: "M18",
    text: "já fiz o recadastro sim",
    context: contextFromState(state),
  }));
  const bridged = toConversationEvents(interpretation);
  for (const event of bridged.events) state = applyEvent(state, event);

  const concessao = state.goals.find((g) => g.goal_code === "GOAL_CONCESSAO");
  const fact = activeFact(state, "recadastro_status", concessao ?? null);
  assertEquals(fact?.value, "OK");
  assertEquals(fact?.confidence, "UNCERTAIN", "alegacao do usuario nunca confirma");
  assertEquals(fact?.authoritative, false);
  assertEquals(concessao?.status, "WAITING");
  assertEquals(state.pending_actions.map((a) => a.action_code), ["ACTION_VERIFY_RECADASTRO"]);
});

Deno.test("E2E: correcao vinda da linguagem supera o fato anterior", () => {
  let state: ConversationState = initState("E2E-COR");
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "meu pai" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] });

  const interpretation = guardInterpretation(interpret({
    message_id: "M05",
    text: "na verdade me enganei, ele ainda está sepultado",
    context: contextFromState(state, ["meu pai"]),
  }));
  assertEquals(interpretation.primary_event?.event_kind, "CORRECTION");
  for (const event of toConversationEvents(interpretation).events) state = applyEvent(state, event);

  const superseded = state.facts.find((f) => f.fact_code === "remains_status" && f.value === "EXUMADO");
  assertEquals(superseded?.status, "SUPERSEDED");
  assertEquals(superseded?.supersession_reason, "USER_CORRECTION");
  assertEquals(focusGoal(state)?.goal_code, "GOAL_EXUMACAO", "sepultado reabre a dependencia de exumacao");
});

Deno.test("E2E: pergunta paralela preserva a pergunta corrente", () => {
  let state: ConversationState = initState("E2E-PAR");
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "meu pai" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] });
  const pendingBefore = state.pending_question;

  const interpretation = guardInterpretation(interpret({
    message_id: "M07",
    text: "aproveitando, até que horas vocês atendem?",
    context: contextFromState(state, ["meu pai"]),
  }));
  assertEquals(interpretation.primary_event?.event_kind, "PARALLEL_QUESTION");
  for (const event of toConversationEvents(interpretation).events) state = applyEvent(state, event);

  assertEquals(state.pending_question?.question_code, pendingBefore?.question_code);
  assertEquals(state.pending_question?.asked_at_seq, pendingBefore?.asked_at_seq);
  assertEquals(state.goals.find((g) => g.goal_code === "GOAL_INFO_HORARIO")?.status, "RESOLVED");
});

Deno.test("E2E: novo falecido abre outro case sem misturar fatos", () => {
  let state: ConversationState = initState("E2E-CASE");
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "meu pai" });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] });

  const interpretation = guardInterpretation(interpret({
    message_id: "M09",
    text: "minha mãe também faleceu e quero fazer o translado dela",
    context: contextFromState(state, ["meu pai"]),
  }));
  assertEquals(interpretation.case_reference.kind, "NEW");
  for (const event of toConversationEvents(interpretation).events) state = applyEvent(state, event);

  assertEquals(state.cases.length, 2);
  const novo = focusGoal(state);
  assertEquals(activeFact(state, "remains_status", novo), null, "o novo case nasce sem os fatos do anterior");
});

Deno.test("NORMALIZE: acentos, pontuacao e caixa nao mudam a interpretacao", () => {
  assertEquals(normalize("Já FOI exumado!!!"), "ja foi exumado");
});

Deno.test("CONTRATO: toda interpretacao conforma com interpretation.schema.json", () => {
  const schema = JSON.parse(
    Deno.readTextFileSync(new URL("../interpretation.schema.json", import.meta.url)),
  ) as Record<string, unknown>;
  for (const fixture of fixtures.messages) {
    const interpretation = run(fixture);
    assertEquals(
      validateAgainstSchema(schema, schema, interpretation as unknown, `interpretation[${fixture.id}]`),
      [],
      `${fixture.id} fora do contrato`,
    );
  }
});
