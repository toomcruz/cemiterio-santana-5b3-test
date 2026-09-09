import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import {
  activeFact,
  applyAuthoritativeSignal,
  applyEvent,
  contextGoal,
  type ConversationState,
  initState,
  missingFacts,
} from "../../engine/engine.ts";
import { validateState } from "../../engine/validate.ts";

function current(state: ConversationState) {
  const goal = contextGoal(state);
  if (!goal) throw new Error("objetivo aberto esperado");
  return goal;
}

function exhumation(id: string, spouse = "VIVO"): ConversationState {
  return applyEvent(initState(id), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: id,
    facts: [
      { code: "exhumation_purpose", value: "OSSUARIO" },
      { code: "surviving_spouse_status", value: spouse },
    ],
  });
}

function signal(state: ConversationState, code: string, value: string, goal_id = current(state).goal_id) {
  const next = applyAuthoritativeSignal(state, { goal_id, facts: [{ code, value }] });
  assertEquals(validateState(next), []);
  return next;
}

function rejects(fn: () => unknown, expected: string) {
  try {
    fn();
  } catch (error) {
    assert(String(error).includes(expected), String(error));
    return;
  }
  throw new Error(`esperava rejeicao: ${expected}`);
}

Deno.test("A01 recadastro coletado aguarda confirmação humana e retoma concessão na mesma decisão", () => {
  let state = applyEvent(initState("recadastro-child"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_CONCESSAO",
    case_ref: "concessao-A",
    facts: [
      { code: "concession_purpose", value: "RENOVACAO" },
      { code: "recadastro_status", value: "PENDENTE" },
    ],
  });
  const parent = state.goals[0];
  assert(parent);
  const child = current(state);
  assertEquals(child.goal_code, "GOAL_RECADASTRO");
  assertEquals(child.case_id, parent.case_id);
  state = applyEvent(state, {
    kind: "ANSWER",
    facts: [
      { code: "concession_reference", value: "concessao-A" },
      { code: "recadastro_holder_document", value: "documento informado" },
    ],
  });
  assertEquals(current(state).status, "WAITING");
  assertEquals(state.pending_actions.map((a) => a.action_code), ["ACTION_VERIFY_RECADASTRO"]);
  assertEquals(activeFact(state, "recadastro_status", current(state))?.value, "PENDENTE");
  assert(!state.facts.some((f) => f.fact_code === "recadastro_status" && f.value === "OK"));
  state = signal(state, "recadastro_status", "OK", child.goal_id);
  assertEquals(state.goals.find((g) => g.goal_id === child.goal_id)?.status, "RESOLVED");
  assertEquals(current(state).goal_id, parent.goal_id);
  assertEquals(state.pending_actions, []);
  assertEquals(state.pending_question?.fact_code, "requester_document");
});

Deno.test("A09 recadastros avulsos têm casos próprios e decisões sem alvo ambíguas são rejeitadas", () => {
  let state = applyEvent(initState("avulsos"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_RECADASTRO",
    case_ref: "jazigo-A",
    facts: [{ code: "concession_reference", value: "A" }, { code: "recadastro_holder_document", value: "Doc A" }],
  });
  const first = current(state);
  state = applyEvent(state, {
    kind: "NEW_GOAL",
    goal_code: "GOAL_RECADASTRO",
    case_ref: "jazigo-B",
    facts: [{ code: "concession_reference", value: "B" }, { code: "recadastro_holder_document", value: "Doc B" }],
  });
  const second = current(state);
  assert(first.case_id !== null && second.case_id !== null && first.case_id !== second.case_id);
  assertEquals(activeFact(state, "concession_reference", first)?.value, "A");
  assertEquals(activeFact(state, "concession_reference", second)?.value, "B");
  rejects(() => applyAuthoritativeSignal(state, { facts: [{ code: "recadastro_status", value: "OK" }] }), "ambiguo");
  state = signal(state, "recadastro_status", "OK", first.goal_id);
  assertEquals(state.goals.find((g) => g.goal_id === first.goal_id)?.status, "RESOLVED");
  assertEquals(state.goals.find((g) => g.goal_id === second.goal_id)?.status, "WAITING");
  assertEquals(activeFact(state, "recadastro_status", second), null);
});

for (const value of ["IRREGULAR", "EM_VERIFICACAO"]) {
  Deno.test(`A02 situação ${value} confirmada não libera jazigo`, () => {
    let state = applyEvent(initState(value), {
      kind: "NEW_GOAL",
      goal_code: "GOAL_TRANSPORTE",
      facts: [
        { code: "remains_status", value: "EXUMADO" },
        { code: "transport_destination", value: "JAZIGO_FAMILIA" },
        { code: "destination_grave_reference", value: "Q1 J2" },
      ],
    });
    state = signal(state, "destination_grave_situation", value);
    assertEquals(current(state).status, "WAITING");
    assertEquals(state.pending_actions[0]?.action_code, "ACTION_VERIFY_GRAVE_SITUATION");
    assert(missingFacts(state, current(state)).some((f) => f.code === "destination_grave_situation"));
  });
}

for (const value of ["PENDENTE", "NAO_APLICAVEL"]) {
  Deno.test(`A02 autorização ${value} não libera jazigo da família`, () => {
    let state = applyEvent(initState(value), {
      kind: "NEW_GOAL",
      goal_code: "GOAL_TRANSPORTE",
      facts: [
        { code: "remains_status", value: "EXUMADO" },
        { code: "transport_destination", value: "JAZIGO_FAMILIA" },
        { code: "destination_grave_reference", value: "Q1 J2" },
      ],
    });
    state = signal(state, "destination_grave_situation", "REGULAR");
    state = signal(state, "destination_grave_authorization", value);
    assertEquals(current(state).status, "WAITING");
    assertEquals(state.pending_actions[0]?.action_code, "ACTION_COLLECT_GRAVE_AUTHORIZATION");
  });
}

for (const value of ["PENDENTE", "OBTIDA_RESPONSAVEL_JAZIGO"]) {
  Deno.test(`A02/D6 ${value} não autoriza exumação quando cônjuge está vivo`, () => {
    const state = signal(exhumation(value), "exhumation_authorization", value);
    assertEquals(current(state).status, "WAITING");
    assertEquals(state.pending_actions[0]?.action_code, "ACTION_COLLECT_EXHUMATION_AUTHORIZATION");
  });
}

Deno.test("A10 cônjuge desconhecido mantém ação única, não inventa assinante e aceita verificação", () => {
  let state = exhumation("unknown", "DESCONHECIDO");
  assertEquals(current(state).status, "WAITING");
  assertEquals(activeFact(state, "required_authorization_signatory", current(state)), null);
  assertEquals(state.pending_actions.length, 1);
  assertEquals(state.pending_question?.fact_code, "burial_reference");
  state = signal(state, "surviving_spouse_status", "FALECIDO");
  assertEquals(activeFact(state, "required_authorization_signatory", current(state))?.value, "RESPONSAVEL_JAZIGO");
  assertEquals(state.pending_actions.length, 1);
  state = signal(state, "exhumation_authorization", "OBTIDA_RESPONSAVEL_JAZIGO");
  assertEquals(current(state).status, "ACTIVE");
  assertEquals(state.pending_actions, []);
  assertEquals(state.pending_question?.fact_code, "burial_reference");
});

Deno.test("A09/A10 correção invalida assinatura e autorização somente no caso corrigido", () => {
  let state = signal(exhumation("case-A"), "exhumation_authorization", "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO");
  const first = current(state);
  state = applyEvent(state, {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "case-B",
    facts: [
      { code: "exhumation_purpose", value: "OSSUARIO" },
      { code: "surviving_spouse_status", value: "VIVO" },
    ],
  });
  state = signal(state, "exhumation_authorization", "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO", state.goals.at(-1)!.goal_id);
  const second = current(state);
  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "surviving_spouse_status", value: "FALECIDO" }] });
  assertEquals(activeFact(state, "required_authorization_signatory", second)?.value, "RESPONSAVEL_JAZIGO");
  assertEquals(activeFact(state, "exhumation_authorization", second), null);
  assertEquals(activeFact(state, "exhumation_authorization", first)?.value, "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO");
  assertEquals(activeFact(state, "required_authorization_signatory", first)?.value, "CONJUGE_E_RESPONSAVEL_JAZIGO");
});

Deno.test("A10 contradição sobre cônjuge não produz novo assinante confirmado", () => {
  const base = signal(exhumation("conflict"), "exhumation_authorization", "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO");
  const state = applyEvent(base, {
    kind: "ANSWER",
    facts: [{ code: "surviving_spouse_status", value: "FALECIDO" }],
  });
  assertEquals(state.pending_question?.question_code, "Q_CONFLICT_CONFIRM");
  assertEquals(state.pending_actions, []);
  assertEquals(activeFact(state, "required_authorization_signatory", current(state)), null);
  assertEquals(activeFact(state, "exhumation_authorization", current(state)), null);
});

Deno.test("A01/A09 correção da concessão reabre a mesma verificação de recadastro", () => {
  let state = applyEvent(initState("reverify"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_CONCESSAO",
    facts: [
      { code: "concession_purpose", value: "RENOVACAO" },
      { code: "recadastro_status", value: "PENDENTE" },
    ],
  });
  state = applyEvent(state, {
    kind: "ANSWER",
    facts: [
      { code: "concession_reference", value: "A" },
      { code: "recadastro_holder_document", value: "Doc A" },
    ],
  });
  const child = current(state);
  state = signal(state, "recadastro_status", "OK", child.goal_id);
  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "concession_reference", value: "B" }] });
  assertEquals(current(state).goal_id, child.goal_id);
  assertEquals(current(state).status, "WAITING");
  assertEquals(activeFact(state, "recadastro_status", current(state)), null);
  assertEquals(state.goals.length, 2);
  assertEquals(state.cases.length, 1);
  assertEquals(state.pending_actions.map((a) => a.action_code), ["ACTION_VERIFY_RECADASTRO"]);
});

Deno.test("A09 decisão explícita não pode gravar fato de outro tipo de caso", () => {
  const state = exhumation("wrong-goal");
  rejects(() =>
    applyAuthoritativeSignal(state, {
      goal_id: current(state).goal_id,
      facts: [{ code: "recadastro_status", value: "OK" }],
    }), "nao pertence");
});

Deno.test("A09 mesma referência textual não funde concessão com falecido", () => {
  let state = applyEvent(initState("subject-types"), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_RECADASTRO",
    case_ref: "referencia-1",
    facts: [{ code: "concession_reference", value: "C1" }],
  });
  const concession = current(state);
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_EXUMACAO", case_ref: "referencia-1" });
  const deceased = current(state);
  assert(concession.case_id !== deceased.case_id);
  assertEquals(state.cases.length, 2);
  assertEquals(activeFact(state, "concession_reference", deceased), null);
});

Deno.test("A04 autorização pendente permite identificar caso e coletar documento sem liberar execução", () => {
  let state = exhumation("waiting-collection", "FALECIDO");
  const goal = current(state);
  assertEquals(goal.status, "WAITING");
  assertEquals(state.pending_question?.fact_code, "burial_reference");
  const action = state.pending_actions[0];
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "burial_reference", value: "Pessoa A, Q1 J2" }] });
  assertEquals(current(state).goal_id, goal.goal_id);
  assertEquals(current(state).status, "WAITING");
  assertEquals(state.pending_question?.fact_code, "requester_document");
  assertEquals(state.pending_actions, [action]);
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "requester_document", value: "Doc A" }] });
  assertEquals(current(state).status, "WAITING");
  assertEquals(state.pending_question, null);
  assertEquals(state.pending_actions, [action]);
  assertEquals(activeFact(state, "exhumation_authorization", current(state)), null);
  state = signal(state, "exhumation_authorization", "OBTIDA_RESPONSAVEL_JAZIGO", goal.goal_id);
  assertEquals(state.goals.find((g) => g.goal_id === goal.goal_id)?.status, "RESOLVED");
  assertEquals(state.pending_actions, []);
});

Deno.test("A04 dados em espera com cônjuge desconhecido não resolvem assinatura nem repetem desconhecimento", () => {
  let state = exhumation("unknown-collection", "DESCONHECIDO");
  state = applyEvent(state, {
    kind: "ANSWER",
    facts: [
      { code: "burial_reference", value: "Pessoa B, Q2 J3" },
      { code: "requester_document", value: "Doc B" },
    ],
  });
  assertEquals(current(state).status, "WAITING");
  assertEquals(state.pending_question, null);
  assertEquals(state.pending_actions.length, 1);
  assertEquals(activeFact(state, "required_authorization_signatory", current(state)), null);
});

Deno.test("A07 handoff após duas coletas concluídas inclui somente o último caso", () => {
  let state = initState("completed-handoff");
  for (const id of ["primeiro", "segundo"]) {
    state = applyEvent(state, {
      kind: "NEW_GOAL",
      goal_code: "GOAL_COMERCIAL",
      case_ref: id,
      facts: [
        { code: "commercial_item", value: "LAPIDE" },
        { code: "commercial_stage", value: "ORCAMENTO" },
        { code: "requester_document", value: `Doc ${id}` },
      ],
    });
  }
  assert(state.goals.every((g) => g.status === "RESOLVED"));
  state = applyEvent(state, { kind: "HUMAN_REQUEST" });
  assertEquals(state.handoff?.case_id, state.goals.at(-1)?.case_id);
  assertEquals(state.handoff?.goal_code, "GOAL_COMERCIAL");
  assert(state.handoff?.confirmed_facts.some((f) => f.value === "Doc segundo"));
  assert(!state.handoff?.confirmed_facts.some((f) => f.value === "Doc primeiro"));
});

Deno.test("A04 saudação recupera coleta em snapshot antigo WAITING sem alterar autorização", () => {
  const old = exhumation("legacy-waiting", "FALECIDO");
  old.pending_question = null;
  const next = applyEvent(old, { kind: "SOCIAL" });
  assertEquals(next.pending_question?.fact_code, "burial_reference");
  assertEquals(next.goals, old.goals);
  assertEquals(next.facts, old.facts);
  assertEquals(next.pending_actions, old.pending_actions);
});
