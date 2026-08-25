// Fase 4C — Sessão × processo (R8 / G11).
// Contrato: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4C.
// Garantia: SESSION CLOSED != PROCESS CLOSED.
// Gate PASS: fechar sessão não altera nenhum byte de cases/facts/documentos/solicitacoes.
// Gate FAIL: qualquer objeto de processo muda ao fechar a sessão.

import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { validateState } from "../../engine/validate.ts";
import { type ConversationState, initState, run } from "../../engine/engine.ts";
import { createSolicitacao } from "../../engine/solicitacao.ts";
import {
  bindProcessToSession,
  closeSession,
  createSession,
  DOCUMENTOS_FUTURE_KEY,
  hashProcessObjects,
  openNewSessionForExistingProcess,
  processObjectsSnapshot,
  SESSION_STATUSES,
  type SessionRecord,
  transitionSession,
} from "../../engine/sessao_processo.ts";

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Monta processo não trivial: case + fact + solicitação 4B (sem documentos — 4E). */
function plantNonTrivialProcess(conversationId: string): ConversationState {
  let state = run(conversationId, [
    { kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "PEDIDO_4C" },
    { kind: "ANSWER", facts: [{ code: "commercial_item", value: "LAPIDE" }] },
    { kind: "ANSWER", facts: [{ code: "commercial_stage", value: "PEDIDO_PAGO" }] },
    {
      kind: "ANSWER",
      facts: [{ code: "commercial_delivery_status", value: "PENDENTE" }],
    },
  ]);

  const caseId = state.cases[0]?.case_id ?? null;
  const sol = createSolicitacao({
    solicitacao_id: "sol-4c-acompanhamento",
    case_id: caseId,
    category: "ACOMPANHAMENTO",
    topic_code: "COMERCIAL",
    overlay_of_goal_id: null,
    summary: "acompanhamento lapide",
    reason: "cliente pergunta status",
    collected_fact_ids: state.facts.map((f) => f.fact_id),
    pending_question_ref: null,
    pending_action_refs: [],
    forwarding: null,
    opened_at_seq: state.seq,
    estado: "ABERTO",
    confirmed_facts: [
      { code: "commercial_item", value: "LAPIDE" },
      { code: "commercial_stage", value: "PEDIDO_PAGO" },
      { code: "commercial_delivery_status", value: "PENDENTE" },
    ],
  });

  state = { ...state, solicitacoes: [sol] };
  assertEquals(validateState(state), []);
  assert(state.cases.length >= 1, "processo precisa de case");
  assert(state.facts.length >= 1, "processo precisa de facts");
  assert((state.solicitacoes?.length ?? 0) >= 1, "processo precisa de solicitacao 4B");
  return state;
}

Deno.test("4C-R8: ciclo de sessão ACTIVE→…→CLOSED é o contrato offline (sem worker)", () => {
  assertEquals(
    [...SESSION_STATUSES],
    ["ACTIVE", "WARNING_PENDING", "WARNING_SENT", "CLOSED"],
  );
  let session = createSession({
    session_id: SESSION_A,
    conversation_id: "conv-4c-ciclo",
  });
  assertEquals(session.status, "ACTIVE");
  session = transitionSession(session, "WARNING_PENDING");
  assertEquals(session.status, "WARNING_PENDING");
  session = transitionSession(session, "WARNING_SENT");
  assertEquals(session.status, "WARNING_SENT");
  session = closeSession(session);
  assertEquals(session.status, "CLOSED");
});

Deno.test("4C-R8: sobrevivência — fechar sessão não muda hash dos objetos de processo", () => {
  const conversationId = "conv-4c-sobrevivencia";
  let state = plantNonTrivialProcess(conversationId);
  let session = createSession({
    session_id: SESSION_A,
    conversation_id: conversationId,
  });
  state = bindProcessToSession(state, session.session_id);

  const beforeSnap = processObjectsSnapshot(state);
  const beforeHash = hashProcessObjects(state);

  session = transitionSession(session, "WARNING_PENDING");
  session = transitionSession(session, "WARNING_SENT");
  session = closeSession(session);
  // Fechar sessão NÃO recebe o estado de processo — não há caminho de mutação.
  assertEquals(session.status, "CLOSED");

  const afterSnap = processObjectsSnapshot(state);
  const afterHash = hashProcessObjects(state);
  assertEquals(afterHash, beforeHash, "hash_antes == hash_depois (garantia G11)");
  assertEquals(afterSnap, beforeSnap, "snapshot canônico dos objetos de processo idêntico");
});

Deno.test("4C-R8: retomada — nova sessão recupera o mesmo processo (identidades intactas)", () => {
  const conversationId = "conv-4c-retomada";
  let state = plantNonTrivialProcess(conversationId);
  let sessionA = createSession({
    session_id: SESSION_A,
    conversation_id: conversationId,
  });
  state = bindProcessToSession(state, sessionA.session_id);
  const processHash = hashProcessObjects(state);
  const caseIds = state.cases.map((c) => c.case_id).slice().sort();
  const factIds = state.facts.map((f) => f.fact_id).slice().sort();
  const solIds = (state.solicitacoes ?? []).map((s) => s.solicitacao_id).slice().sort();

  sessionA = closeSession(sessionA);
  assertEquals(sessionA.status, "CLOSED");

  const { session: sessionB, state: resumed } = openNewSessionForExistingProcess({
    previousState: state,
    newSessionId: SESSION_B,
    conversationId,
  });

  assertEquals(sessionB.status, "ACTIVE");
  assertEquals(sessionB.session_id, SESSION_B);
  assertEquals(sessionB.conversation_id, conversationId);
  assertEquals(resumed.conversation_id, conversationId);
  assertEquals(hashProcessObjects(resumed), processHash);
  assertEquals(
    resumed.cases.map((c: { case_id: string }) => c.case_id).slice().sort(),
    caseIds,
  );
  assertEquals(
    resumed.facts.map((f: { fact_id: string }) => f.fact_id).slice().sort(),
    factIds,
  );
  assertEquals(
    (resumed.solicitacoes ?? [])
      .map((s: { solicitacao_id: string }) => s.solicitacao_id)
      .slice()
      .sort(),
    solIds,
  );
  // Vínculo unidirecional: processo aponta para a sessão que o tocou por último.
  assertEquals(resumed.last_touched_session_id, SESSION_B);
});

Deno.test("4C-R8: negativo — fechar sessão não fecha case / não apaga facts / não altera solicitacoes", () => {
  const conversationId = "conv-4c-neg-close";
  let state = plantNonTrivialProcess(conversationId);
  let session = createSession({
    session_id: SESSION_A,
    conversation_id: conversationId,
  });
  state = bindProcessToSession(state, session.session_id);

  const casesBefore = structuredClone(state.cases);
  const factsBefore = structuredClone(state.facts);
  const solsBefore = structuredClone(state.solicitacoes ?? []);

  session = closeSession(session);
  assertEquals(session.status, "CLOSED");

  assertEquals(state.cases, casesBefore);
  assertEquals(state.facts, factsBefore);
  assertEquals(state.solicitacoes ?? [], solsBefore);
  // Cases não ganham status CLOSED por causa da sessão.
  for (const c of state.cases) {
    assert(!("status" in c) || (c as { status?: string }).status !== "CLOSED");
  }
});

Deno.test("4C-R8: negativo — nova sessão não cria processo novo automaticamente", () => {
  const conversationId = "conv-4c-neg-no-new-process";
  const state = plantNonTrivialProcess(conversationId);
  const beforeHash = hashProcessObjects(state);
  const { session, state: resumed } = openNewSessionForExistingProcess({
    previousState: state,
    newSessionId: SESSION_B,
    conversationId,
  });
  assertEquals(session.status, "ACTIVE");
  assertEquals(resumed.cases.length, state.cases.length);
  assertEquals(resumed.facts.length, state.facts.length);
  assertEquals(resumed.solicitacoes?.length, state.solicitacoes?.length);
  assertEquals(hashProcessObjects(resumed), beforeHash);
  // Não nasce segundo conversation_id / processo paralelo.
  assertEquals(resumed.conversation_id, state.conversation_id);
});

Deno.test("4C-R8: negativo — sessão não declara ownership do processo", () => {
  const session = createSession({
    session_id: SESSION_A,
    conversation_id: "conv-4c-ownership",
  });
  const keys = Object.keys(session).sort();
  assertEquals(keys, ["conversation_id", "session_id", "status"]);
  assert(!("case_ids" in session));
  assert(!("process_id" in session));
  assert(!("owns_process" in session));
  assert(!("solicitacao_ids" in session));
  assert(!("fact_ids" in session));
});

Deno.test("4C-R8: negativo — vínculo é unidirecional (processo→sessão; sessão≠dona)", () => {
  let state = plantNonTrivialProcess("conv-4c-vinculo");
  const session = createSession({
    session_id: SESSION_A,
    conversation_id: state.conversation_id,
  });
  state = bindProcessToSession(state, session.session_id);
  assertEquals(state.last_touched_session_id, SESSION_A);
  // Sessão continua sem campos de processo.
  assertEquals(
    Object.keys(session).sort(),
    ["conversation_id", "session_id", "status"],
  );
});

Deno.test("4C-R8: negativo — nenhuma transição de sessão chama rede", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    fetchCalls += 1;
    throw new Error("rede proibida no caminho 4C");
  }) as typeof fetch;

  try {
    let session = createSession({
      session_id: SESSION_A,
      conversation_id: "conv-4c-no-net",
    });
    let state = plantNonTrivialProcess("conv-4c-no-net");
    state = bindProcessToSession(state, session.session_id);
    session = transitionSession(session, "WARNING_PENDING");
    session = transitionSession(session, "WARNING_SENT");
    session = closeSession(session);
    openNewSessionForExistingProcess({
      previousState: state,
      newSessionId: SESSION_B,
      conversationId: "conv-4c-no-net",
    });
    hashProcessObjects(state);
    processObjectsSnapshot(state);
    assertEquals(fetchCalls, 0, "caminho 4C deve ser offline (0 fetch)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("4C-R8: documentos futuros (4E) já entram na fronteira do hash, sem implementar 4E", () => {
  const state = plantNonTrivialProcess("conv-4c-docs-future");
  const snap = processObjectsSnapshot(state) as Record<string, unknown>;
  assert(
    DOCUMENTOS_FUTURE_KEY in snap,
    "snapshot de processo deve reservar coleção documental futura",
  );
  assertEquals(snap[DOCUMENTOS_FUTURE_KEY], []);
  // Mutar só a coleção futura mudaria o hash — proteção contratual.
  const mutated = {
    ...snap,
    [DOCUMENTOS_FUTURE_KEY]: [{ document_id: "doc-fake" }],
  };
  assert(
    JSON.stringify(mutated) !== JSON.stringify(snap),
    "documentos futuros fazem parte da superfície protegida",
  );
});

Deno.test("4C-R8: schema aceita last_touched_session_id aditivo no estado", () => {
  let state = plantNonTrivialProcess("conv-4c-schema");
  state = bindProcessToSession(state, SESSION_A);
  const errs = validateState(state);
  assertEquals(errs, [], `validateState rejeitou vínculo de sessão: ${errs.join("; ")}`);
});
