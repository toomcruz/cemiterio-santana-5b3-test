import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { officialInformationReply } from "../official_information.ts";
import { findProcedure, PROCEDURAL_CONTEXT_VERSION, proceduralDirectReply } from "../procedure_knowledge.ts";

for (
  const phrase of [
    "quadra geral",
    "Não quero renovação de ossuário",
    "recadastro e também administração provisória",
    "roubaram o portão do jazigo",
    "traslado",
    "translado de Santana para outro cemitério",
    "Meu pai faleceu hoje",
  ]
) {
  Deno.test(`procedural aliases cannot resolve an incomplete or conflicting scope: ${phrase}`, () => {
    assertEquals(findProcedure(phrase), null);
  });
}

for (
  const phrase of [
    "Quero cancelar a exumação, como funciona?",
    "Quero falar com atendente: quais documentos para recadastro?",
    "Corrigindo: cinzas no jazigo, qual procedimento?",
    "Encerrar o atendimento da exumação, como funciona?",
    "É para outra pessoa, quais documentos para exumação?",
  ]
) {
  Deno.test(`procedural reply cannot override operational control: ${phrase}`, () => {
    assertEquals(proceduralDirectReply({ text: phrase }), null);
  });
}

for (
  const phrase of [
    "Como funciona a administração provisória?",
    "Quais documentos para o recadastro?",
    "Como funciona a exumação?",
  ]
) {
  Deno.test(`actual information lane includes context without inventing approved authority: ${phrase}`, async () => {
    const state = initState("procedure-information");
    const before = JSON.stringify(state);
    const result = await officialInformationReply({ text: phrase, state, referenceDate: "2026-09-20" });
    assert(result);
    assertEquals(result.status, "NOT_AVAILABLE");
    assertEquals(result.administration_required, true);
    assertEquals(result.contextual_source?.authority, "CONTEXT_ONLY");
    assertEquals(result.contextual_source?.version, PROCEDURAL_CONTEXT_VERSION);
    assert(result.text.length > 150);
    assert(!result.text.includes("R$"));
    assert(!result.text.includes("agendado para"));
    assertEquals(JSON.stringify(state), before);
  });
}

Deno.test("an approved answer wins over the historical procedural summary", async () => {
  const result = await officialInformationReply({
    text: "O que é ossuário?",
    state: initState("approved-first"),
    referenceDate: "2026-09-09",
  });
  assertEquals(result?.status, "AVAILABLE");
  assertEquals(result?.authority?.source_id, "SRC_DOMAIN_TOPICS_V1");
  assertEquals(result?.contextual_source, undefined);
});

Deno.test("price requiring context never receives a historical fallback tariff", async () => {
  const state = initState("no-historical-tariff");
  const result = await officialInformationReply({
    text: "Quanto custa a exumação em quadra geral?",
    state,
    referenceDate: "2026-09-20",
  });
  assert(result && result.status !== "AVAILABLE");
  assertEquals(result.contextual_source, undefined);
  assert(!result.text.includes("351,67"));
  assert(!result.text.includes("R$"));
});

Deno.test("generic concession goal cannot choose a stored procedural subtype", () => {
  const answer = proceduralDirectReply({ text: "Como funciona?", activeGoalCode: "GOAL_CONCESSAO" });
  assert(answer?.includes("procedimentos diferentes"));
  assert(!answer?.includes("180 dias"));
  assert(!answer?.includes("5 dias"));
});

Deno.test("plain declaration of an attached document is not converted into an information request", () => {
  assertEquals(
    proceduralDirectReply({ text: "Enviei a documentação da exumação", activeGoalCode: "GOAL_EXUMACAO" }),
    null,
  );
});

Deno.test("a routing hint cannot displace the existing conversation goal", () => {
  const result = interpret({
    message_id: "keep-current-goal",
    text: "Administração provisória",
    context: {
      has_open_goal: true,
      open_goal_code: "GOAL_EXUMACAO",
      pending_question_fact: "burial_reference",
      known_subject_hints: [],
    },
  });
  assert(result.goal?.goal_code !== "GOAL_CONCESSAO");
});

Deno.test("family grave ownership is not a request for transport", () => {
  const result = interpret({
    message_id: "ownership-not-direction",
    text: "Meu pai faleceu hoje e temos jazigo da família",
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
    },
  });
  assert(!result.facts.some((fact) => fact.fact_code === "transport_destination"));
});
