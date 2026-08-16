// P0 conversacional determinista C01-C16. Gate: 16/16 PASS.
// Nenhuma chamada de rede, banco, LLM ou integracao externa.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import {
  activeFact,
  activeFacts,
  applyEvent,
  buildHandoff,
  type ConversationEvent,
  type ConversationState,
  focusGoal,
  type GoalRecord,
  initState,
} from "../../engine/engine.ts";
import { validateState } from "../../engine/validate.ts";

function run(id: string, events: ConversationEvent[]): ConversationState {
  let state = initState(id);
  for (const event of events) {
    state = applyEvent(state, event);
    assertEquals(validateState(state), [], `estado invalido apos ${event.kind}`);
  }
  return state;
}

function goalByCode(state: ConversationState, code: string): GoalRecord {
  const found = [...state.goals].reverse().find((g) => g.goal_code === code);
  if (!found) throw new Error(`goal ausente: ${code}`);
  return found;
}

function pendingCode(state: ConversationState): string | null {
  return state.pending_question ? state.pending_question.question_code : null;
}

const transporteAberto: ConversationEvent = {
  kind: "NEW_GOAL",
  goal_code: "GOAL_TRANSPORTE",
  case_ref: "FALECIDO_A",
};

Deno.test("C01 Transporte -> sepultado -> Exumacao -> retorno", () => {
  let state = run("C01", [transporteAberto]);
  assertEquals(pendingCode(state), "Q_REMAINS_STATUS");

  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] });
  const exumacao = goalByCode(state, "GOAL_EXUMACAO");
  assertEquals(exumacao.status, "ACTIVE");
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "SUSPENDED");
  assertEquals(activeFact(state, "exumacao_required", exumacao)?.value, true);
  assertEquals(activeFact(state, "exhumation_purpose", exumacao)?.source, "DERIVED_RULE");
  assertEquals(pendingCode(state), "Q_EXHUMATION_AUTHORIZATION");

  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "exhumation_authorization", value: "OBTIDA" }] });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "burial_reference", value: "Quadra 3 / Jazigo 18" }] });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "requester_document", value: "DOC-1" }] });

  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "RESOLVED");
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "ACTIVE");
  assertEquals(pendingCode(state), "Q_TRANSPORT_DESTINATION");
});

Deno.test("C02 Transporte -> ja exumado -> pula Exumacao", () => {
  const state = run("C02", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
  ]);
  assert(!state.goals.some((g) => g.goal_code === "GOAL_EXUMACAO"), "Exumacao nao deve ser aberta");
  assert(state.forbidden_goals.includes("GOAL_EXUMACAO"), "Exumacao deve ficar proibida");
  assertEquals(activeFact(state, "exumacao_required", focusGoal(state))?.value, false);
  assertEquals(pendingCode(state), "Q_TRANSPORT_DESTINATION");
});

Deno.test("C03 Correcao sepultado -> exumado", () => {
  let state = run("C03", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
  ]);
  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "ACTIVE");

  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "remains_status", value: "EXUMADO" }] });

  const antigo = state.facts.find((f) => f.fact_code === "remains_status" && f.value === "SEPULTADO");
  assertEquals(antigo?.status, "SUPERSEDED");
  assertEquals(antigo?.supersession_reason, "USER_CORRECTION");
  const derivado = state.facts.find((f) => f.fact_code === "exumacao_required" && f.value === true);
  assertEquals(derivado?.status, "SUPERSEDED");
  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "ABANDONED");
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "ACTIVE");
  assertEquals(pendingCode(state), "Q_TRANSPORT_DESTINATION");
});

Deno.test("C04 Mudanca de destino recalcula apenas dependencias afetadas", () => {
  let state = run("C04", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
    { kind: "ANSWER", facts: [{ code: "transport_destination", value: "JAZIGO_FAMILIA" }] },
    { kind: "ANSWER", facts: [{ code: "destination_grave_reference", value: "J-12" }] },
  ]);
  assertEquals(pendingCode(state), "Q_DESTINATION_GRAVE_SITUATION");

  state = applyEvent(state, {
    kind: "CHANGE_OF_MIND",
    facts: [{ code: "transport_destination", value: "OUTRO_CEMITERIO" }],
  });

  const jazigo = state.facts.find((f) => f.fact_code === "destination_grave_reference");
  assertEquals(jazigo?.status, "SUPERSEDED");
  assertEquals(jazigo?.supersession_reason, "DEPENDENCY_INVALIDATED");
  assertEquals(activeFact(state, "remains_status", focusGoal(state))?.value, "EXUMADO");
  assertEquals(pendingCode(state), "Q_TRANSPORT_DATE");
});

Deno.test("C05 Concessao com Recadastro OK", () => {
  let state = run("C05", [{ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "CONCESSAO_1" }]);
  assertEquals(pendingCode(state), "Q_CONCESSION_PURPOSE");
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "TRANSFERENCIA" }] });
  assertEquals(pendingCode(state), "Q_RECADASTRO_STATUS");
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "recadastro_status", value: "OK" }] });

  assert(!state.goals.some((g) => g.goal_code === "GOAL_RECADASTRO"), "Recadastro nao deve ser aberto");
  assertEquals(goalByCode(state, "GOAL_CONCESSAO").status, "ACTIVE");
  assertEquals(pendingCode(state), "Q_CONCESSION_REFERENCE");
});

Deno.test("C06 Concessao sem Recadastro suspende e retorna", () => {
  let state = run("C06", [
    { kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "CONCESSAO_2" },
    { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "TRANSFERENCIA" }] },
    { kind: "ANSWER", facts: [{ code: "recadastro_status", value: "PENDENTE" }] },
  ]);
  assertEquals(goalByCode(state, "GOAL_CONCESSAO").status, "SUSPENDED");
  assertEquals(goalByCode(state, "GOAL_RECADASTRO").status, "ACTIVE");
  assertEquals(activeFact(state, "recadastro_required", goalByCode(state, "GOAL_CONCESSAO"))?.value, true);

  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "concession_reference", value: "CONC-77" }] });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "recadastro_holder_document", value: "DOC-9" }] });

  assertEquals(goalByCode(state, "GOAL_RECADASTRO").status, "RESOLVED");
  assertEquals(goalByCode(state, "GOAL_CONCESSAO").status, "ACTIVE");
  assertEquals(activeFact(state, "recadastro_status", goalByCode(state, "GOAL_CONCESSAO"))?.value, "OK");
  assertEquals(pendingCode(state), "Q_REQUESTER_DOCUMENT");
});

Deno.test("C07 Recadastro desconhecido bloqueia sem presumir", () => {
  const state = run("C07", [
    { kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "CONCESSAO_3" },
    { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "RENOVACAO" }] },
    { kind: "ANSWER", facts: [{ code: "recadastro_status", value: "DESCONHECIDO" }] },
  ]);
  assertEquals(goalByCode(state, "GOAL_CONCESSAO").status, "WAITING");
  assert(!state.goals.some((g) => g.goal_code === "GOAL_RECADASTRO"), "nao abrir Recadastro por presuncao");
  assertEquals(state.pending_actions.map((a) => a.action_code), ["ACTION_VERIFY_RECADASTRO"]);
  assertEquals(pendingCode(state), null);
});

Deno.test("C08 Exumacao + pergunta paralela sobre ossuario", () => {
  let state = run("C08", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
  ]);
  const perguntaOriginal = state.pending_question;
  assertEquals(perguntaOriginal?.question_code, "Q_EXHUMATION_AUTHORIZATION");

  state = applyEvent(state, {
    kind: "PARALLEL_QUESTION",
    goal_code: "GOAL_INFO_OSSUARIO",
    facts: [{ code: "ossuary_information_request", value: "Quanto custa o ossuario?" }],
  });

  assertEquals(goalByCode(state, "GOAL_INFO_OSSUARIO").status, "RESOLVED");
  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "ACTIVE");
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "SUSPENDED");
  assertEquals(state.pending_question?.question_code, "Q_EXHUMATION_AUTHORIZATION");
  assertEquals(state.pending_question?.asked_at_seq, perguntaOriginal?.asked_at_seq);
});

Deno.test("C09 Exumacao + pergunta paralela sobre horario", () => {
  let state = run("C09", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
  ]);
  const perguntaOriginal = state.pending_question;
  state = applyEvent(state, {
    kind: "PARALLEL_QUESTION",
    goal_code: "GOAL_INFO_HORARIO",
    facts: [{ code: "service_hours_request", value: "Ate que horas atendem?" }],
  });
  assertEquals(goalByCode(state, "GOAL_INFO_HORARIO").status, "RESOLVED");
  assertEquals(state.pending_question?.question_code, perguntaOriginal?.question_code);
  assertEquals(goalByCode(state, "GOAL_INFO_HORARIO").case_id, goalByCode(state, "GOAL_TRANSPORTE").case_id);
  assertEquals(state.cases.length, 1);
});

Deno.test("C10 Lapide para comprar", () => {
  let state = run("C10", [{ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "PEDIDO_1" }]);
  assertEquals(pendingCode(state), "Q_COMMERCIAL_ITEM");
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "commercial_item", value: "LAPIDE" }] });
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "commercial_stage", value: "ORCAMENTO" }] });

  assertEquals(activeFact(state, "commercial_delivery_status", focusGoal(state)), null);
  assertEquals(pendingCode(state), "Q_REQUESTER_DOCUMENT");
  assert(!state.goals.some((g) => g.goal_code === "GOAL_RECLAMACAO"), "orcamento nao gera reclamacao");
});

Deno.test("C11 Lapide paga e nao instalada -> overlay de Reclamacao", () => {
  let state = run("C11", [
    { kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "PEDIDO_2" },
    { kind: "ANSWER", facts: [{ code: "commercial_item", value: "LAPIDE" }] },
    { kind: "ANSWER", facts: [{ code: "commercial_stage", value: "PEDIDO_PAGO" }] },
    { kind: "ANSWER", facts: [{ code: "commercial_delivery_status", value: "PENDENTE" }] },
  ]);
  const base = goalByCode(state, "GOAL_COMERCIAL");
  state = applyEvent(state, { kind: "COMPLAINT" });

  const overlay = goalByCode(state, "GOAL_RECLAMACAO");
  assertEquals(overlay.overlay_of, base.goal_id);
  assertEquals(overlay.case_id, base.case_id);
  assertEquals(goalByCode(state, "GOAL_COMERCIAL").status, "ACTIVE");
  assertEquals(pendingCode(state), "Q_COMPLAINT_DESCRIPTION");
  assert(!JSON.stringify(state).toLowerCase().includes("severity"), "nenhuma classificacao automatica de gravidade");
  assert(!JSON.stringify(state).toLowerCase().includes("gravidade"), "nenhuma classificacao automatica de gravidade");
});

Deno.test("C12 Segundo falecido cria novo case sem misturar fatos", () => {
  let state = run("C12", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
    { kind: "ANSWER", facts: [{ code: "transport_destination", value: "OUTRO_CEMITERIO" }] },
  ]);
  const caseA = goalByCode(state, "GOAL_TRANSPORTE").case_id;

  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "FALECIDO_B" });
  const goalB = focusGoal(state);
  assert(goalB !== null && goalB.case_id !== caseA, "segundo falecido exige novo case");
  assertEquals(state.cases.length, 2);
  assertEquals(activeFact(state, "remains_status", goalB), null);
  assertEquals(pendingCode(state), "Q_REMAINS_STATUS");
  assertEquals(state.facts.filter((f) => f.fact_code === "remains_status" && f.status === "ACTIVE").length, 1);
});

Deno.test("C13 Duas respostas em uma mesma mensagem", () => {
  let state = run("C13", [{ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "PEDIDO_3" }]);
  assertEquals(pendingCode(state), "Q_COMMERCIAL_ITEM");
  state = applyEvent(state, {
    kind: "ANSWER",
    facts: [
      { code: "commercial_item", value: "JAZIGO" },
      { code: "commercial_stage", value: "ORCAMENTO" },
    ],
  });
  const goal = focusGoal(state);
  assertEquals(activeFact(state, "commercial_item", goal)?.value, "JAZIGO");
  assertEquals(activeFact(state, "commercial_stage", goal)?.value, "ORCAMENTO");
  assertEquals(pendingCode(state), "Q_REQUESTER_DOCUMENT");
});

Deno.test("C14 Informacao fornecida antes de ser perguntada nao e reperguntada", () => {
  let state = run("C14", [
    transporteAberto,
    { kind: "COMPLEMENT", facts: [{ code: "transport_destination", value: "OUTRO_CEMITERIO" }] },
  ]);
  assertEquals(pendingCode(state), "Q_REMAINS_STATUS");
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] });
  assertEquals(pendingCode(state), "Q_TRANSPORT_DATE");
  assertEquals(activeFact(state, "transport_destination", focusGoal(state))?.source, "USER_EXPLICIT");
});

Deno.test("C15 Contradicao de fato anterior vira conflito bloqueador", () => {
  let state = run("C15", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
  ]);
  state = applyEvent(state, { kind: "COMPLEMENT", facts: [{ code: "remains_status", value: "SEPULTADO" }] });

  const conflitantes = activeFacts(state, "remains_status", focusGoal(state));
  assertEquals(conflitantes.length, 2);
  assertEquals(conflitantes.map((f) => f.confidence), ["CONFLICTING", "CONFLICTING"]);
  assertEquals(pendingCode(state), "Q_CONFLICT_CONFIRM");
  assertEquals(state.pending_question?.priority_class, "BLOCKING_UNCERTAINTY");

  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "remains_status", value: "SEPULTADO" }] });
  const resolvido = activeFacts(state, "remains_status", goalByCode(state, "GOAL_TRANSPORTE"));
  assertEquals(resolvido.length, 1);
  assertEquals(resolvido[0]?.value, "SEPULTADO");
  assertEquals(resolvido[0]?.confidence, "CONFIRMED");
});

Deno.test("C16 Abandono de subfluxo + novo objetivo", () => {
  let state = run("C16", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
  ]);
  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "ACTIVE");

  state = applyEvent(state, {
    kind: "NEW_GOAL",
    goal_code: "GOAL_COMERCIAL",
    case_ref: "PEDIDO_4",
    abandon_current: true,
  });

  assertEquals(goalByCode(state, "GOAL_EXUMACAO").status, "ABANDONED");
  const transporte = goalByCode(state, "GOAL_TRANSPORTE");
  assertEquals(transporte.status, "SUSPENDED");
  assertEquals(transporte.status_reason, "BLOCKED_BY_ABANDONED_SUBFLOW");
  assertEquals(focusGoal(state)?.goal_code, "GOAL_COMERCIAL");
  assertEquals(pendingCode(state), "Q_COMMERCIAL_ITEM");

  const handoff = buildHandoff(state);
  assertEquals(handoff.goal_code, "GOAL_COMERCIAL");
  assertEquals(handoff.current_question, "Q_COMMERCIAL_ITEM");
  assert(handoff.essential_context.goal_stack.includes("GOAL_TRANSPORTE:SUSPENDED"), "handoff mantem contexto");
});

Deno.test("HANDOFF: modelo de estado para atendimento humano", () => {
  let state = run("HANDOFF", [
    transporteAberto,
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
  ]);
  state = applyEvent(state, { kind: "HUMAN_REQUEST" });
  const handoff = state.handoff;
  assert(handoff !== null, "handoff deve ser construido");
  assertEquals(handoff?.goal_code, "GOAL_EXUMACAO");
  assertEquals(handoff?.current_step, "GOAL_EXUMACAO:ACTIVE");
  assert(
    (handoff?.confirmed_facts ?? []).some((f) => f.fact_code === "remains_status"),
    "fatos confirmados no handoff",
  );
  assert((handoff?.pending_facts ?? []).includes("exhumation_authorization"), "pendencias no handoff");
  assert(handoff?.essential_context.goal_stack.includes("GOAL_TRANSPORTE:SUSPENDED"), "pilha de objetivos no handoff");
});

Deno.test("SOCIAL nao altera estado operacional", () => {
  const base = run("SOCIAL", [transporteAberto]);
  const depois = applyEvent(base, { kind: "SOCIAL", note: "bom dia" });
  assertEquals(depois.facts, base.facts);
  assertEquals(depois.goals, base.goals);
  assertEquals(depois.pending_question, base.pending_question);
});
