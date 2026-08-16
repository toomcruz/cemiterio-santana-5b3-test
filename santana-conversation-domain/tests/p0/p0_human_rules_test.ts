// 5B.4-A.1 — decisoes humanas fechadas antes da 5B.4-B.
// D1..D6 cobrem exatamente as seis decisoes; C01-C16 continuam em p0_conversation_test.ts.
// Nenhuma chamada de rede, banco, LLM ou integracao externa.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import {
  activeFact,
  applyAuthoritativeSignal,
  applyEvent,
  type ConversationEvent,
  type ConversationState,
  focusGoal,
  type GoalRecord,
  initState,
} from "../../engine/engine.ts";
import { factDef, questionsDoc } from "../../engine/catalog.ts";
import { validateState } from "../../engine/validate.ts";

function run(id: string, events: ConversationEvent[]): ConversationState {
  let state = initState(id);
  for (const event of events) {
    state = applyEvent(state, event);
    assertEquals(validateState(state), [], `estado invalido apos ${event.kind}`);
  }
  return state;
}

function signal(state: ConversationState, facts: { code: string; value: string; source?: "SYSTEM" | "DOCUMENT" }[]) {
  const next = applyAuthoritativeSignal(state, { facts });
  assertEquals(validateState(next), [], "estado invalido apos sinal autoritativo");
  return next;
}

function goalByCode(state: ConversationState, code: string): GoalRecord {
  const found = [...state.goals].reverse().find((g) => g.goal_code === code);
  if (!found) throw new Error(`goal ausente: ${code}`);
  return found;
}

function actions(state: ConversationState): string[] {
  return state.pending_actions.map((a) => a.action_code);
}

function pendingCode(state: ConversationState): string | null {
  return state.pending_question ? state.pending_question.question_code : null;
}

function rejects(fn: () => unknown, fragment: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(fragment), `mensagem inesperada: ${message}`);
    return;
  }
  throw new Error(`esperava rejeicao contendo "${fragment}"`);
}

function transporteAteJazigo(id: string): ConversationState {
  return run(id, [
    { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: `${id}_FALECIDO` },
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
    { kind: "ANSWER", facts: [{ code: "transport_destination", value: "JAZIGO_FAMILIA" }] },
    { kind: "ANSWER", facts: [{ code: "destination_grave_reference", value: "J-12" }] },
  ]);
}

Deno.test("D1 situacao do jazigo de destino e verificada obrigatoriamente antes da continuidade", () => {
  let state = transporteAteJazigo("D1");

  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "WAITING");
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status_reason, "AWAITING:ACTION_VERIFY_GRAVE_SITUATION");
  assertEquals(actions(state), ["ACTION_VERIFY_GRAVE_SITUATION"]);
  assertEquals(pendingCode(state), null, "situacao do jazigo nunca e perguntada ao municipe");

  // A palavra do municipe nao substitui a verificacao da Administracao.
  rejects(
    () => applyEvent(state, { kind: "ANSWER", facts: [{ code: "destination_grave_situation", value: "REGULAR" }] }),
    "origem USER_EXPLICIT nao permitida",
  );

  state = signal(state, [{ code: "destination_grave_situation", value: "REGULAR" }]);
  const verificado = activeFact(state, "destination_grave_situation", goalByCode(state, "GOAL_TRANSPORTE"));
  assertEquals(verificado?.confidence, "CONFIRMED");
  assertEquals(verificado?.authoritative, true);
  // Continuidade so avanca para a proxima exigencia: a autorizacao do jazigo.
  assertEquals(actions(state), ["ACTION_COLLECT_GRAVE_AUTHORIZATION"]);
});

Deno.test("D2 autorizacao do jazigo e deterministica: concessionario ou Administrador Provisorio", () => {
  let state = signal(transporteAteJazigo("D2"), [{ code: "destination_grave_situation", value: "REGULAR" }]);
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status_reason, "AWAITING:ACTION_COLLECT_GRAVE_AUTHORIZATION");

  const def = factDef("destination_grave_authorization");
  assertEquals(def.ai_extractable, false);
  assertEquals(def.deterministic_rule, true);
  assertEquals(def.allowed_sources, ["DOCUMENT", "SYSTEM"]);
  assertEquals(def.allowed_values, [
    "OBTIDA_CONCESSIONARIO",
    "OBTIDA_ADMINISTRADOR_PROVISORIO",
    "PENDENTE",
    "NAO_APLICAVEL",
  ]);

  // Nenhum outro signatario e aceito, e o LLM/usuario nao pode assinar por eles.
  rejects(
    () =>
      applyAuthoritativeSignal(state, {
        facts: [{ code: "destination_grave_authorization", value: "OBTIDA_VIZINHO" }],
      }),
    "fora do dominio",
  );
  rejects(
    () =>
      applyAuthoritativeSignal(state, {
        facts: [{ code: "destination_grave_authorization", value: "OBTIDA_CONCESSIONARIO", source: "USER_EXPLICIT" }],
      }),
    "origem USER_EXPLICIT nao permitida",
  );

  state = signal(state, [{ code: "destination_grave_authorization", value: "OBTIDA_ADMINISTRADOR_PROVISORIO" }]);
  assertEquals(goalByCode(state, "GOAL_TRANSPORTE").status, "ACTIVE");
  assertEquals(actions(state), []);
  assertEquals(pendingCode(state), "Q_TRANSPORT_DATE");
});

Deno.test("D3 recadastro desconhecido abre verificacao pela Administracao, sem presumir", () => {
  let state = run("D3", [
    { kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "D3_CONCESSAO" },
    { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "TRANSFERENCIA" }] },
    { kind: "ANSWER", facts: [{ code: "recadastro_status", value: "DESCONHECIDO" }] },
  ]);

  const concessao = goalByCode(state, "GOAL_CONCESSAO");
  assertEquals(concessao.status, "WAITING");
  assertEquals(actions(state), ["ACTION_VERIFY_RECADASTRO"]);
  assertEquals(pendingCode(state), null);
  assertEquals(activeFact(state, "recadastro_status", concessao)?.value, "DESCONHECIDO");
  assert(!state.goals.some((g) => g.goal_code === "GOAL_RECADASTRO"), "nao abrir Recadastro por presuncao");
  assertEquals(activeFact(state, "recadastro_verification_required", concessao)?.value, true);

  state = signal(state, [{ code: "recadastro_status", value: "PENDENTE" }]);
  assertEquals(goalByCode(state, "GOAL_RECADASTRO").status, "ACTIVE");
  assertEquals(goalByCode(state, "GOAL_CONCESSAO").status, "SUSPENDED");
});

Deno.test("D4 recadastro_status=OK exige sinal autoritativo de conclusao", () => {
  const base = run("D4", [
    { kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "D4_CONCESSAO" },
    { kind: "ANSWER", facts: [{ code: "concession_purpose", value: "NOVA" }] },
  ]);

  // 1) Declaracao do usuario.
  const declarado = applyEvent(base, { kind: "ANSWER", facts: [{ code: "recadastro_status", value: "OK" }] });
  assertEquals(
    activeFact(declarado, "recadastro_status", goalByCode(declarado, "GOAL_CONCESSAO"))?.confidence,
    "UNCERTAIN",
  );
  assertEquals(goalByCode(declarado, "GOAL_CONCESSAO").status, "WAITING");
  assertEquals(actions(declarado), ["ACTION_VERIFY_RECADASTRO"]);

  // 2) Extracao/inferencia (mesma origem de usuario, sem sinal) tambem nao confirma.
  const inferido = applyEvent(base, { kind: "COMPLEMENT", facts: [{ code: "recadastro_status", value: "OK" }] });
  assertEquals(
    activeFact(inferido, "recadastro_status", goalByCode(inferido, "GOAL_CONCESSAO"))?.confidence,
    "UNCERTAIN",
  );

  // 3) Sinal marcado como autoritativo mas com origem de usuario e recusado.
  rejects(
    () =>
      applyAuthoritativeSignal(base, {
        facts: [{ code: "recadastro_status", value: "OK", source: "USER_CORRECTION" }],
      }),
    "sinal autoritativo exige origem",
  );

  // 4) Somente o sinal autoritativo confirma.
  const confirmado = signal(declarado, [{ code: "recadastro_status", value: "OK" }]);
  const fato = activeFact(confirmado, "recadastro_status", goalByCode(confirmado, "GOAL_CONCESSAO"));
  assertEquals(fato?.confidence, "CONFIRMED");
  assertEquals(fato?.authoritative, true);
  assertEquals(fato?.source, "SYSTEM");
  assertEquals(goalByCode(confirmado, "GOAL_CONCESSAO").status, "ACTIVE");
  assertEquals(actions(confirmado), []);
});

Deno.test("D5 EXUMADO satisfaz a dependencia no case, sem proibicao global nem permanente", () => {
  let state = run("D5", [
    { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "D5_FALECIDO_A" },
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "EXUMADO" }] },
  ]);
  assertEquals(state.forbidden_goals, [], "nenhuma proibicao global de Exumacao");
  assert(!state.goals.some((g) => g.goal_code === "GOAL_EXUMACAO"), "dependencia inaplicavel neste case");

  // Outro case, na mesma conversa, recalcula do zero.
  state = applyEvent(state, { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "D5_FALECIDO_B" });
  const caseB = focusGoal(state)?.case_id ?? null;
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] });
  const exumacaoB = goalByCode(state, "GOAL_EXUMACAO");
  assertEquals(exumacaoB.status, "ACTIVE");
  assertEquals(exumacaoB.case_id, caseB);
  assertEquals(state.cases.length, 2);

  // Correcao no mesmo case reabre a dependencia antes satisfeita.
  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "remains_status", value: "EXUMADO" }] });
  const fechada = goalByCode(state, "GOAL_EXUMACAO");
  assertEquals(fechada.status, "ABANDONED");
  assertEquals(fechada.status_reason, "DEPENDENCY_SATISFIED");
  state = applyEvent(state, { kind: "CORRECTION", facts: [{ code: "remains_status", value: "SEPULTADO" }] });
  const reaberta = goalByCode(state, "GOAL_EXUMACAO");
  assertEquals(reaberta.status, "ACTIVE");
  assertEquals(reaberta.case_id, caseB);
  assert(reaberta.goal_id !== fechada.goal_id, "dependencia recalculada abre um novo subfluxo");
});

Deno.test("D6 autorizacao da exumacao: assinaturas definidas por regra, nunca pelo LLM", () => {
  const def = factDef("exhumation_authorization");
  assertEquals(def.ai_extractable, false);
  assertEquals(def.deterministic_rule, true);
  assertEquals(def.authoritative_only, true);
  assert(
    !questionsDoc.questions.some((q) => q.fact_code === "exhumation_authorization"),
    "autorizacao nao e perguntada ao usuario",
  );

  // Conjuge/companheiro vivo: ele assina e o responsavel pelo jazigo tambem.
  let vivo = run("D6_VIVO", [
    { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "D6_A" },
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
    { kind: "ANSWER", facts: [{ code: "surviving_spouse_status", value: "VIVO" }] },
  ]);
  const exumacao = goalByCode(vivo, "GOAL_EXUMACAO");
  const signatario = activeFact(vivo, "required_authorization_signatory", exumacao);
  assertEquals(signatario?.value, "CONJUGE_E_RESPONSAVEL_JAZIGO");
  assertEquals(signatario?.source, "DERIVED_RULE");
  assertEquals(goalByCode(vivo, "GOAL_EXUMACAO").status, "WAITING");
  assertEquals(actions(vivo), ["ACTION_COLLECT_EXHUMATION_AUTHORIZATION"]);

  // Nem usuario nem extracao podem dispensar ou declarar a autorizacao.
  rejects(
    () =>
      applyEvent(vivo, {
        kind: "ANSWER",
        facts: [{ code: "exhumation_authorization", value: "OBTIDA_RESPONSAVEL_JAZIGO" }],
      }),
    "origem USER_EXPLICIT nao permitida",
  );

  vivo = signal(vivo, [{
    code: "exhumation_authorization",
    value: "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO",
    source: "DOCUMENT",
  }]);
  assertEquals(goalByCode(vivo, "GOAL_EXUMACAO").status, "ACTIVE");
  assertEquals(pendingCode(vivo), "Q_BURIAL_REFERENCE");

  // Sem conjuge sobrevivente: assina o responsavel pelo jazigo.
  const semConjuge = run("D6_SEM", [
    { kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "D6_B" },
    { kind: "ANSWER", facts: [{ code: "remains_status", value: "SEPULTADO" }] },
    { kind: "ANSWER", facts: [{ code: "surviving_spouse_status", value: "INEXISTENTE" }] },
  ]);
  assertEquals(
    activeFact(semConjuge, "required_authorization_signatory", goalByCode(semConjuge, "GOAL_EXUMACAO"))?.value,
    "RESPONSAVEL_JAZIGO",
  );
});
