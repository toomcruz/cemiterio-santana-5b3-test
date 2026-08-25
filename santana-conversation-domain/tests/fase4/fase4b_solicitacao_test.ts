// Fase 4B — solicitação e assunto real (R7).
// Contrato: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4B.
// Gate FAIL: dois casos distintos produzem o mesmo estado observável.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { validateState } from "../../engine/validate.ts";
import { type ConversationState, initState } from "../../engine/engine.ts";
import {
  CATEGORY_CYCLES,
  composeAssunto,
  createSolicitacao,
  observableSolicitacaoState,
  type SolicitacaoCategory,
  type SolicitacaoInput,
} from "../../engine/solicitacao.ts";

const CATEGORIES: SolicitacaoCategory[] = [
  "VENDA",
  "ACOMPANHAMENTO",
  "RECLAMACAO",
  "SOLICITACAO_TAXA",
  "SOLICITACAO_AGENDAMENTO",
  "CONSULTA",
  "ENCAMINHAMENTO_ADMINISTRACAO",
];

function fixtureFor(category: SolicitacaoCategory): SolicitacaoInput {
  const base = {
    solicitacao_id: `sol-${category.toLowerCase()}`,
    case_id: category === "CONSULTA" ? null : `case-${category.toLowerCase()}`,
    topic_code: topicFor(category),
    overlay_of_goal_id: category === "RECLAMACAO" ? "goal-base-comercial" : null,
    summary: `resumo-${category}`,
    reason: `motivo-${category}`,
    collected_fact_ids: [],
    pending_question_ref: null,
    pending_action_refs: [],
    forwarding: category === "ENCAMINHAMENTO_ADMINISTRACAO"
      ? { destinatario: "ADMINISTRACAO", executor: "HUMAN" as const }
      : null,
    opened_at_seq: 1,
    confirmed_facts: factsFor(category),
  };

  const estado = CATEGORY_CYCLES[category][0];
  assert(estado !== undefined, `ciclo vazio para ${category}`);
  return {
    ...base,
    category,
    estado,
  };
}

function topicFor(category: SolicitacaoCategory): string {
  switch (category) {
    case "VENDA":
    case "ACOMPANHAMENTO":
    case "RECLAMACAO":
      return "COMERCIAL";
    case "SOLICITACAO_TAXA":
      return "CONCESSAO";
    case "SOLICITACAO_AGENDAMENTO":
      return "EXUMACAO";
    case "CONSULTA":
      return "OUTROS_ASSUNTOS";
    case "ENCAMINHAMENTO_ADMINISTRACAO":
      return "RECADASTRO";
    default: {
      const _exhaustive: never = category;
      throw new Error(`categoria sem topico: ${_exhaustive}`);
    }
  }
}

function factsFor(category: SolicitacaoCategory): { code: string; value: string }[] {
  switch (category) {
    case "VENDA":
      return [
        { code: "commercial_item", value: "LAPIDE" },
        { code: "commercial_stage", value: "ORCAMENTO" },
      ];
    case "ACOMPANHAMENTO":
      return [
        { code: "commercial_item", value: "LAPIDE" },
        { code: "commercial_stage", value: "PEDIDO_PAGO" },
        { code: "commercial_delivery_status", value: "PENDENTE" },
      ];
    case "RECLAMACAO":
      return [
        { code: "commercial_item", value: "LAPIDE" },
        { code: "commercial_stage", value: "PEDIDO_PAGO" },
        { code: "commercial_delivery_status", value: "PENDENTE" },
      ];
    case "SOLICITACAO_TAXA":
      return [{ code: "other_subject_description", value: "taxa de concessao" }];
    case "SOLICITACAO_AGENDAMENTO":
      return [{ code: "other_subject_description", value: "agendamento de exumacao" }];
    case "CONSULTA":
      return [{ code: "other_subject_description", value: "horario de visitacao" }];
    case "ENCAMINHAMENTO_ADMINISTRACAO":
      return [{ code: "other_subject_description", value: "verificar recadastro" }];
    default: {
      const _exhaustive: never = category;
      throw new Error(`categoria sem fatos: ${_exhaustive}`);
    }
  }
}

Deno.test("4B-R7: composição G12 — lápide comprada e não instalada", () => {
  const result = composeAssunto([
    { code: "commercial_item", value: "LAPIDE" },
    { code: "commercial_stage", value: "PEDIDO_PAGO" },
    { code: "commercial_delivery_status", value: "PENDENTE" },
  ]);
  assertEquals(result.label, "Lapide comprada e nao instalada");
  assertEquals(result.fell_back, false);
});

Deno.test("4B-R7: composição G12 — dúvida sobre assunto informado", () => {
  const result = composeAssunto([
    { code: "other_subject_description", value: "horario de visitacao" },
  ]);
  assertEquals(result.label, "Duvida sobre horario de visitacao");
  assertEquals(result.fell_back, false);
});

Deno.test("4B-R7: composição G12 — fail-closed cai para rótulo genérico", () => {
  const result = composeAssunto([]);
  assertEquals(result.label, "Solicitacao sem assunto composto");
  assertEquals(result.fell_back, true);
});

Deno.test("4B-R7: schema aceita solicitação aditiva no estado", () => {
  const state = attachSolicitacao(initState("conv-4b-schema"), fixtureFor("VENDA"));
  assertEquals(validateState(state), []);
});

Deno.test("4B-R7: validateState rejeita category×estado fora do ciclo próprio", () => {
  // createSolicitacao e validateState devem concordar (fail-closed estrutural).
  const probes: Array<{
    name: string;
    patch: Partial<ReturnType<typeof createSolicitacao>>;
    create: () => void;
  }> = [
    {
      name: "VENDA+PAGA",
      patch: { category: "VENDA", estado: "PAGA" as never, overlay_of_goal_id: null },
      create: () => createSolicitacao({ ...fixtureFor("VENDA"), estado: "PAGA" as never }),
    },
    {
      name: "SOLICITACAO_TAXA+CONTATO_FEITO",
      patch: {
        category: "SOLICITACAO_TAXA",
        estado: "CONTATO_FEITO" as never,
        overlay_of_goal_id: null,
      },
      create: () =>
        createSolicitacao({
          ...fixtureFor("SOLICITACAO_TAXA"),
          estado: "CONTATO_FEITO" as never,
        }),
    },
    {
      name: "CONSULTA+CONFIRMADA_POR_HUMANO",
      patch: {
        category: "CONSULTA",
        estado: "CONFIRMADA_POR_HUMANO" as never,
        overlay_of_goal_id: null,
      },
      create: () =>
        createSolicitacao({
          ...fixtureFor("CONSULTA"),
          estado: "CONFIRMADA_POR_HUMANO" as never,
        }),
    },
    {
      name: "RECLAMACAO sem overlay",
      patch: {
        category: "RECLAMACAO",
        estado: "OVERLAY_ABERTO",
        overlay_of_goal_id: null,
      },
      create: () =>
        createSolicitacao({
          ...fixtureFor("RECLAMACAO"),
          overlay_of_goal_id: null,
        }),
    },
  ];

  for (const probe of probes) {
    let createRejected = false;
    try {
      probe.create();
    } catch {
      createRejected = true;
    }
    assert(createRejected, `${probe.name}: createSolicitacao deveria rejeitar`);

    const valid = createSolicitacao(fixtureFor("VENDA"));
    const state = initState(`conv-neg-${probe.name}`);
    state.solicitacoes = [{ ...valid, ...probe.patch }];
    const errs = validateState(state);
    assert(
      errs.length > 0,
      `${probe.name}: validateState aceitou combinação inválida (divergência do engine)`,
    );
  }
});

Deno.test("4B-R7: não-colapso — sete categorias com estados observáveis distintos", () => {
  const observables = new Map<string, SolicitacaoCategory>();
  for (const category of CATEGORIES) {
    const sol = createSolicitacao(fixtureFor(category));
    const key = observableSolicitacaoState(sol);
    const prior = observables.get(key);
    assert(
      prior === undefined,
      `colapso entre ${prior} e ${category}: estado observável idêntico (${key})`,
    );
    observables.set(key, category);
  }
  assertEquals(observables.size, 7);
});

Deno.test("4B-R7: cada categoria usa apenas o próprio ciclo de estado", () => {
  for (const category of CATEGORIES) {
    const cycle = CATEGORY_CYCLES[category];
    assert(cycle.length >= 2, `${category} precisa de ciclo próprio`);
    for (const other of CATEGORIES) {
      if (other === category) continue;
      // Ciclos podem compartilhar palavras (ex.: ABERTO), mas o par
      // (categoria, estado) deve permanecer distinguível no observável.
      const estadoA = cycle[0];
      const estadoB = CATEGORY_CYCLES[other][0];
      assert(estadoA !== undefined && estadoB !== undefined, "ciclo inicial ausente");
      const a = createSolicitacao({ ...fixtureFor(category), estado: estadoA });
      const b = createSolicitacao({ ...fixtureFor(other), estado: estadoB });
      assert(
        observableSolicitacaoState(a) !== observableSolicitacaoState(b),
        `par ${category}/${other} colapsou no estado inicial`,
      );
    }
  }
});

/** Planta solicitação crua no estado — para validar schema sem passar pelo engine. */
function plantSolicitacao(
  state: ConversationState,
  patch: {
    category: SolicitacaoCategory;
    estado: string;
    overlay_of_goal_id: string | null;
  },
): ConversationState {
  const skeletonCat: SolicitacaoCategory = patch.category === "RECLAMACAO" ? "RECLAMACAO" : "VENDA";
  const skeleton = createSolicitacao(fixtureFor(skeletonCat));
  return {
    ...state,
    solicitacoes: [{
      ...skeleton,
      category: patch.category,
      estado: patch.estado as typeof skeleton.estado,
      overlay_of_goal_id: patch.overlay_of_goal_id,
    }],
  };
}

function createAccepted(input: SolicitacaoInput): boolean {
  try {
    createSolicitacao(input);
    return true;
  } catch {
    return false;
  }
}

function schemaAccepted(record: ReturnType<typeof createSolicitacao>): boolean {
  const state = initState(`parity-${record.solicitacao_id}`);
  state.solicitacoes = [record];
  return validateState(state).length === 0;
}

Deno.test("4B-R7: paridade exaustiva engine×schema — ciclo próprio aceito", () => {
  for (const category of CATEGORIES) {
    for (const estado of CATEGORY_CYCLES[category]) {
      const input = { ...fixtureFor(category), estado };
      assert(
        createAccepted(input),
        `${category}+${estado}: createSolicitacao deveria ACEITAR`,
      );
      const record = createSolicitacao(input);
      assert(
        schemaAccepted(record),
        `${category}+${estado}: validateState deveria ACEITAR (paridade)`,
      );
    }
  }
});

Deno.test("4B-R7: paridade exaustiva engine×schema — estado fora do ciclo rejeitado", () => {
  const allEstados = new Set<string>();
  for (const category of CATEGORIES) {
    for (const estado of CATEGORY_CYCLES[category]) allEstados.add(estado);
  }
  // Token fantasma do drift schema (não autoritativo) — deve ser rejeitado nos dois.
  allEstados.add("OVERLAY_EM_ANDAMENTO");

  for (const category of CATEGORIES) {
    const own = new Set<string>(CATEGORY_CYCLES[category]);
    for (const estado of allEstados) {
      if (own.has(estado)) continue;
      const input = { ...fixtureFor(category), estado: estado as never };
      assert(
        !createAccepted(input),
        `${category}+${estado}: createSolicitacao deveria REJEITAR`,
      );
      const planted = plantSolicitacao(initState(`neg-${category}-${estado}`), {
        category,
        estado,
        overlay_of_goal_id: category === "RECLAMACAO" ? "goal-base" : null,
      });
      assert(
        validateState(planted).length > 0,
        `${category}+${estado}: validateState deveria REJEITAR (paridade)`,
      );
    }
  }
});

Deno.test("4B-R7: paridade overlay — exclusivo de RECLAMACAO", () => {
  // RECLAMACAO sem overlay → ambos rejeitam
  assert(
    !createAccepted({ ...fixtureFor("RECLAMACAO"), overlay_of_goal_id: null }),
    "RECLAMACAO sem overlay: create deveria REJEITAR",
  );
  assert(
    validateState(
      plantSolicitacao(initState("ov-rec-null"), {
        category: "RECLAMACAO",
        estado: "OVERLAY_ABERTO",
        overlay_of_goal_id: null,
      }),
    ).length > 0,
    "RECLAMACAO sem overlay: schema deveria REJEITAR",
  );

  // RECLAMACAO com overlay → ambos aceitam
  const withOv = fixtureFor("RECLAMACAO");
  assert(createAccepted(withOv), "RECLAMACAO com overlay: create deveria ACEITAR");
  assert(
    schemaAccepted(createSolicitacao(withOv)),
    "RECLAMACAO com overlay: schema deveria ACEITAR",
  );

  // Não-RECLAMACAO com overlay → ambos rejeitam (overlay exclusivo)
  for (const category of CATEGORIES) {
    if (category === "RECLAMACAO") continue;
    const input = { ...fixtureFor(category), overlay_of_goal_id: "goal-x" };
    assert(
      !createAccepted(input),
      `${category}+overlay: createSolicitacao deveria REJEITAR`,
    );
    const estado0 = CATEGORY_CYCLES[category][0];
    assert(estado0 !== undefined, `${category}: ciclo vazio`);
    const planted = plantSolicitacao(initState(`ov-${category}`), {
      category,
      estado: estado0,
      overlay_of_goal_id: "goal-x",
    });
    assert(
      validateState(planted).length > 0,
      `${category}+overlay: validateState deveria REJEITAR (paridade)`,
    );
  }
});

function attachSolicitacao(state: ConversationState, input: SolicitacaoInput): ConversationState {
  const solicitacao = createSolicitacao(input);
  return {
    ...state,
    solicitacoes: [...(state.solicitacoes ?? []), solicitacao],
  };
}
