// Fase 4D — Tópico, reclassificação e primeira mensagem (R9).
// Contrato: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4D.
// Gaps: G17, G03, G16. Evento aditivo: RECLASSIFICATION.
// Divergência documentada: inventário G03→R8; seção 4D vigente → R9.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { validateState } from "../../engine/validate.ts";
import { applyEvent, type ConversationState, focusGoal, run } from "../../engine/engine.ts";
import { createSolicitacao } from "../../engine/solicitacao.ts";
import { DOCUMENTOS_FUTURE_KEY, hashProcessObjects } from "../../engine/sessao_processo.ts";

import { eventsDoc as _eventsDoc } from "../../engine/catalog.ts";
import { interpret } from "../../runtime/interpreter/deterministic.ts";
import { routeFirstMessage } from "../../runtime/interpreter/first_message.ts";

type ProbeState = ConversationState & Record<string, unknown>;

/**
 * Demanda inicialmente em OUTROS_ASSUNTOS, com processo não trivial:
 * case sintético da mesma demanda + fact + solicitação 4B + documentos
 * estruturais (proteção R8, sem schema 4E).
 */
function plantOutrosDemand(conversationId: string): ConversationState {
  let state = run(conversationId, [
    {
      kind: "NEW_GOAL",
      goal_code: "GOAL_OUTROS_ASSUNTOS",
      case_ref: "DEMANDA_4D",
    },
    {
      kind: "ANSWER",
      facts: [{
        code: "other_subject_description",
        value: "quero exumar meu pai",
      }],
    },
  ]);

  // OUTROS não cria case por catálogo; a mesma demanda ganha case estrutural
  // para provar identidade case_id antes/depois (sem NEW_GOAL de outro assunto).
  const caseId = "case-demanda-4d";
  state = {
    ...state,
    cases: [{
      case_id: caseId,
      subject_kind: "GENERIC",
      subject_ref: "DEMANDA_4D",
      opened_at_seq: 1,
    }],
    goals: state.goals.map((g) => ({ ...g, case_id: caseId })),
    facts: state.facts.map((f) => ({ ...f, case_id: caseId })),
  };

  const sol = createSolicitacao({
    solicitacao_id: "sol-4d-consulta",
    case_id: caseId,
    category: "CONSULTA",
    topic_code: "OUTROS_ASSUNTOS",
    overlay_of_goal_id: null,
    summary: "demanda ainda generica",
    reason: "classificacao inicial OUTROS",
    collected_fact_ids: state.facts.map((f) => f.fact_id),
    pending_question_ref: null,
    pending_action_refs: [],
    forwarding: null,
    opened_at_seq: state.seq,
    estado: "RESPONDIDA",
    confirmed_facts: [{
      code: "other_subject_description",
      value: "quero exumar meu pai",
    }],
  });
  state = {
    ...state,
    solicitacoes: [...(state.solicitacoes ?? []), sol],
  };

  // Documentos sintéticos — só superfície R8; sem modelo 4E.
  state = {
    ...state,
    [DOCUMENTOS_FUTURE_KEY]: [{ document_id: "doc-4d-1", status: "RECEIVED" }],
  } as ProbeState;

  return state;
}

Deno.test(
  "4D-R9 T08: RECLASSIFICATION preserva case/facts/docs/sols e registra origem",
  () => {
    let state = plantOutrosDemand("conv-4d-preservacao");
    validateState(state);

    assertEquals(
      state.current_topic,
      "OUTROS_ASSUNTOS",
      "G17: tópico explícito no estado após classificação inicial",
    );
    assertEquals(state.origin_topic ?? null, null);

    const caseIdBefore = state.cases[0]?.case_id;
    assert(caseIdBefore != null, "case da demanda deve existir");
    const factsBefore = structuredClone(state.facts);
    const solsBefore = structuredClone(state.solicitacoes ?? []);
    const docsBefore = structuredClone(
      (state as ProbeState)[DOCUMENTOS_FUTURE_KEY],
    );
    const goalIdBefore = state.goals[0]?.goal_id;
    assert(goalIdBefore != null, "goal da demanda deve existir");
    const factStatusesBefore = factsBefore.map((f) => ({
      fact_id: f.fact_id,
      status: f.status,
    }));
    const processHashBefore = hashProcessObjects(state);

    state = applyEvent(state, {
      kind: "RECLASSIFICATION",
      goal_code: "GOAL_EXUMACAO",
    });
    validateState(state);

    // Tópico atual alterado; origem registrada (G03 / G17).
    assertEquals(state.current_topic, "EXUMACAO");
    assertEquals(state.origin_topic, "OUTROS_ASSUNTOS");

    // Mesmo case; sem create_case.
    assertEquals(state.cases.length, 1);
    assertEquals(state.cases[0]?.case_id, caseIdBefore);

    // Mesmo goal_id (proibido reset_goal).
    assertEquals(state.goals[0]?.goal_id, goalIdBefore);
    assertEquals(focusGoal(state)?.goal_id, goalIdBefore);

    // Facts preservados byte-a-byte em identidade/status (proibido supersede_fact).
    assertEquals(state.facts, factsBefore);
    assertEquals(
      state.facts.map((f) => ({ fact_id: f.fact_id, status: f.status })),
      factStatusesBefore,
    );

    // Solicitações e documentos preservados.
    assertEquals(state.solicitacoes ?? [], solsBefore);
    assertEquals((state as ProbeState)[DOCUMENTOS_FUTURE_KEY], docsBefore);

    // Superfície de processo (R8) intacta — reclassificação não muta processo.
    assertEquals(hashProcessObjects(state), processHashBefore);

    // Evento aditivo no log.
    const last = state.event_log[state.event_log.length - 1];
    assertEquals(last?.event_kind, "RECLASSIFICATION");
  },
);

Deno.test(
  "4D-R9 T09: RECLASSIFICATION não reusa NEW_GOAL/CORRECTION/CHANGE_OF_MIND/UNCERTAIN",
  () => {
    const base = plantOutrosDemand("conv-4d-nao-reuso");
    const caseId = base.cases[0]?.case_id;
    const goalId = base.goals[0]?.goal_id;
    assert(caseId != null && goalId != null);

    // Contraste: NEW_GOAL com subject diferente cria novo goal (+ case se creates_case).
    const viaNewGoal = applyEvent(structuredClone(base), {
      kind: "NEW_GOAL",
      goal_code: "GOAL_EXUMACAO",
      case_ref: "OUTRO_SUJEITO",
    });
    assert(
      viaNewGoal.goals.length > base.goals.length,
      "NEW_GOAL empurra goal novo",
    );
    assert(
      viaNewGoal.goals.some((g) => g.goal_id !== goalId),
      "NEW_GOAL não reutiliza goal_id",
    );
    assert(
      viaNewGoal.cases.length > base.cases.length,
      "NEW_GOAL dispara create_case_when_subject_differs",
    );

    // RECLASSIFICATION: sem create_case, sem novo goal_id.
    const viaReclass = applyEvent(structuredClone(base), {
      kind: "RECLASSIFICATION",
      goal_code: "GOAL_EXUMACAO",
    });
    assertEquals(viaReclass.cases.length, base.cases.length);
    assertEquals(viaReclass.cases[0]?.case_id, caseId);
    assertEquals(viaReclass.goals.length, base.goals.length);
    assertEquals(viaReclass.goals[0]?.goal_id, goalId);
    assertEquals(viaReclass.current_topic, "EXUMACAO");
    assertEquals(viaReclass.origin_topic, "OUTROS_ASSUNTOS");

    // Não reusa CORRECTION / CHANGE_OF_MIND (supersede) nem UNCERTAIN.
    for (const f of viaReclass.facts) {
      assertEquals(f.status, "ACTIVE");
      assertEquals(f.confidence, "CONFIRMED");
      assertEquals(f.superseded_by, null);
    }
    assertEquals(viaReclass.facts.length, base.facts.length);

    // Catálogo: 10 eventos originais intactos + RECLASSIFICATION aditivo.
    const eventsDoc = _eventsDoc;
    const kinds = eventsDoc.events.map((e: { event_kind: string }) => e.event_kind);
    assertEquals(kinds.slice(0, 10), [
      "ANSWER",
      "CORRECTION",
      "COMPLEMENT",
      "PARALLEL_QUESTION",
      "CHANGE_OF_MIND",
      "NEW_GOAL",
      "COMPLAINT",
      "HUMAN_REQUEST",
      "SOCIAL",
      "UNCERTAIN",
    ]);
    assertEquals(kinds[10], "RECLASSIFICATION");
    const newGoal = eventsDoc.events.find((e: { event_kind: string }) => e.event_kind === "NEW_GOAL");
    assert(
      (newGoal?.effects as string[]).includes(
        "create_case_when_subject_differs",
      ),
      "NEW_GOAL mantém create_case_when_subject_differs",
    );
    const reclass = eventsDoc.events.find((e: { event_kind: string }) => e.event_kind === "RECLASSIFICATION");
    assert(reclass != null, "RECLASSIFICATION deve existir no catálogo");
    assertEquals(
      (reclass.forbidden ?? []).includes("create_case"),
      true,
    );
    assert(
      !(reclass.effects ?? []).includes(
        "create_case_when_subject_differs",
      ),
    );
  },
);

Deno.test("4D-R9 G16-A: primeira mensagem específica → intenção especializada (sem menu genérico)", () => {
  const interpretation = interpret({
    message_id: "M02",
    text: "quero fazer a exumacao do meu pai, ele ainda esta enterado",
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
    },
  });
  const route = routeFirstMessage(interpretation);
  assertEquals(route.kind, "SPECIALIZED");
  if (route.kind === "SPECIALIZED") {
    assertEquals(route.goal_code, "GOAL_EXUMACAO");
    assertEquals(route.topic_code, "EXUMACAO");
  }
  assert(route.kind !== "GENERIC_MENU", "não substituir por menu genérico");
});

Deno.test("4D-R9 G16-B: primeira mensagem ambígua → desambiguação/menu permitido", () => {
  const interpretation = interpret({
    message_id: "M11",
    text: "queria resolver a situação do jazigo",
    context: {
      has_open_goal: false,
      open_goal_code: null,
      pending_question_fact: null,
      known_subject_hints: [],
    },
  });
  const route = routeFirstMessage(interpretation);
  assertEquals(route.kind, "DISAMBIGUATION");
});

Deno.test(
  "4D-R9 G16-C: mensagem específica não degrada para OUTROS_ASSUNTOS sem menu",
  () => {
    const interpretation = interpret({
      message_id: "M13",
      text: "quero um orçamento de lápide",
      context: {
        has_open_goal: false,
        open_goal_code: null,
        pending_question_fact: null,
        known_subject_hints: [],
      },
    });
    const route = routeFirstMessage(interpretation);
    assertEquals(route.kind, "SPECIALIZED");
    if (route.kind === "SPECIALIZED") {
      assertEquals(route.goal_code, "GOAL_COMERCIAL");
      assert(route.topic_code !== "OUTROS_ASSUNTOS");
    }
  },
);
