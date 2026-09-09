import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { activeFact, applyEvent, contextGoal, type ConversationState, initState } from "../../engine/engine.ts";
import { registerReceivedDocumento } from "../../engine/documento.ts";
import { validateState } from "../../engine/validate.ts";
import {
  actionOptions,
  applyOperatorCommand,
  type OperatorCommand,
  parseOperatorCommand,
  withOperationalRequests,
} from "../official_operations.ts";
import { currentCatalogHash } from "../server_transition.ts";
import { processOfficialOperator } from "../../../edge-functions/_shared/official-operator.ts";
import { OfficialSupabaseRest } from "../../../edge-functions/_shared/official-rest.ts";
import { HttpProblem } from "../../../edge-functions/_shared/http.ts";

const CONVERSATION = "33333333-3333-4333-a333-333333333333";
const COMMAND = "44444444-4444-4444-a444-444444444444";
const ACTOR = "55555555-5555-4555-a555-555555555555";
const NOW = "2026-09-09T20:00:00.000Z";
const CANARY = "+5511999991234";

function command(overrides: Partial<OperatorCommand> = {}): OperatorCommand {
  return {
    command_id: COMMAND,
    conversation_id: CONVERSATION,
    expected_revision: 7,
    type: "RESOLVE_ACTION",
    goal_id: "g001",
    action_code: "ACTION_COLLECT_EXHUMATION_AUTHORIZATION",
    fact_code: "exhumation_authorization",
    value: "OBTIDA_RESPONSAVEL_JAZIGO",
    note: "Conferência humana registrada",
    ...overrides,
  };
}

function exhumation(identified = true, spouse = "FALECIDO") {
  let state = applyEvent(initState(CONVERSATION), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "pessoa-A",
    facts: [
      { code: "exhumation_purpose", value: "OSSUARIO" },
      { code: "surviving_spouse_status", value: spouse },
    ],
  });
  if (identified) {
    state = applyEvent(state, {
      kind: "ANSWER",
      facts: [
        { code: "burial_reference", value: "Pessoa A, Q1 J2" },
        { code: "requester_document", value: "Identificação A" },
      ],
    });
  }
  return state;
}

function received(state: ConversationState, caseId = state.goals[0]!.case_id): ConversationState {
  const next = structuredClone(state);
  next.documentos = [registerReceivedDocumento({
    documento_id: "doc-1",
    case_id: caseId,
    tipo: "other",
    recebido_em: NOW,
  })];
  return next;
}

Deno.test("operations parser rejeita envelope inválido antes de qualquer decisão", async () => {
  for (
    const invalid of [
      null,
      [],
      {},
      command({ note: " " }),
      command({ expected_revision: -1 }),
      command({ expected_revision: 1.5 }),
      command({ command_id: "não-uuid" }),
      { ...command(), type: "APPROVE_ANYTHING" },
    ]
  ) {
    await assertRejects(() => parseOperatorCommand(invalid), /INVALID_COMMAND/);
  }
  assertEquals(
    parseOperatorCommand({ ...command(), actor_id: "inventado", note: "  Análise humana  " }).note,
    "Análise humana",
  );
  assert(!("actor_id" in parseOperatorCommand({ ...command(), actor_id: "inventado" })));
});

Deno.test("operations rejeita outra conversa, ação inexistente e decisão fora do catálogo", async () => {
  const state = exhumation();
  await assertRejects(
    () => applyOperatorCommand(state, command({ conversation_id: COMMAND }), NOW),
    /CONVERSATION_MISMATCH/,
  );
  await assertRejects(
    () => applyOperatorCommand(state, command({ goal_id: "g999" }), NOW),
    /ACTION_DECISION_NOT_ALLOWED/,
  );
  await assertRejects(
    () => applyOperatorCommand(state, command({ action_code: "ACTION_VERIFY_RECADASTRO" }), NOW),
    /ACTION_DECISION_NOT_ALLOWED/,
  );
  await assertRejects(
    () => applyOperatorCommand(state, command({ value: "DISPENSADA_PELO_ROBO" }), NOW),
    /ACTION_DECISION_NOT_ALLOWED/,
  );
});

Deno.test("operations aprovação exige identidade de sepultamento e solicitante", async () => {
  const unidentified = exhumation(false);
  await assertRejects(() => applyOperatorCommand(unidentified, command(), NOW), /CASE_IDENTITY_REQUIRED/);
  const onlyBurial = applyEvent(unidentified, {
    kind: "ANSWER",
    facts: [{ code: "burial_reference", value: "Pessoa A Q1" }],
  });
  await assertRejects(() => applyOperatorCommand(onlyBurial, command(), NOW), /CASE_IDENTITY_REQUIRED/);
  const next = applyOperatorCommand(exhumation(), command(), NOW);
  assertEquals(next.goals[0]?.status, "RESOLVED");
  assertEquals(next.pending_actions, []);
  assertEquals(validateState(next), []);
});

Deno.test("operations identidade vazia ou de tipo indevido não libera autorização", async () => {
  for (const value of ["   ", true]) {
    const state = applyEvent(exhumation(false), {
      kind: "ANSWER",
      facts: [
        { code: "burial_reference", value },
        { code: "requester_document", value: "Doc A" },
      ],
    });
    await assertRejects(() => applyOperatorCommand(state, command(), NOW), /CASE_IDENTITY_REQUIRED/);
  }
});

Deno.test("operations PENDENTE e assinatura incompatível permanecem bloqueados", () => {
  const pending = applyOperatorCommand(exhumation(), command({ value: "PENDENTE" }), NOW);
  assertEquals(pending.goals[0]?.status, "WAITING");
  assertEquals(pending.pending_actions.length, 1);
  const mismatch = applyOperatorCommand(exhumation(true, "VIVO"), command(), NOW);
  assertEquals(mismatch.goals[0]?.status, "WAITING");
  assertEquals(mismatch.pending_actions.length, 1);
  const corrected = applyOperatorCommand(mismatch, command({ value: "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO" }), NOW);
  assertEquals(corrected.goals[0]?.status, "RESOLVED");
});

Deno.test("operations decisão num caso não autoriza outro falecido", () => {
  let state = exhumation();
  state = applyEvent(state, {
    kind: "NEW_GOAL",
    goal_code: "GOAL_EXUMACAO",
    case_ref: "pessoa-B",
    facts: [
      { code: "exhumation_purpose", value: "OSSUARIO" },
      { code: "surviving_spouse_status", value: "VIVO" },
      { code: "burial_reference", value: "Pessoa B, Q2 J3" },
      { code: "requester_document", value: "Identificação B" },
    ],
  });
  const next = applyOperatorCommand(state, command(), NOW);
  assertEquals(next.goals[0]?.status, "RESOLVED");
  assertEquals(next.goals[1]?.status, "WAITING");
  assertEquals(activeFact(next, "exhumation_authorization", next.goals[1]!), null);
});

Deno.test("operations recadastro somente avança após a decisão humana", () => {
  const state = applyEvent(initState(CONVERSATION), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_RECADASTRO",
    facts: [
      { code: "concession_reference", value: "C-1" },
      { code: "recadastro_holder_document", value: "Doc titular" },
    ],
  });
  const action = actionOptions(state)[0];
  assertEquals(action?.action_code, "ACTION_VERIFY_RECADASTRO");
  const next = applyOperatorCommand(
    state,
    command({ action_code: "ACTION_VERIFY_RECADASTRO", fact_code: "recadastro_status", value: "OK" }),
    NOW,
  );
  assertEquals(next.goals[0]?.status, "RESOLVED");
  assertEquals(activeFact(next, "recadastro_status", next.goals[0]!)?.authoritative, true);
});

Deno.test("operations aceite documental classifica somente documento e nunca autoriza exumação", () => {
  const state = received(exhumation(false));
  const next = applyOperatorCommand(
    state,
    command({
      type: "REVIEW_DOCUMENT",
      document_id: "doc-1",
      document_status: "ACEITO",
      fact_code: "requester_document",
    }),
    NOW,
  );
  assertEquals(next.documentos?.[0]?.estado, "ACEITO");
  assertEquals(activeFact(next, "requester_document", next.goals[0]!)?.source, "DOCUMENT");
  assertEquals(activeFact(next, "exhumation_authorization", next.goals[0]!), null);
  assertEquals(next.goals[0]?.status, "WAITING");
  assertEquals(validateState(next), []);
});

Deno.test("operations rejeição documental não confirma nenhum requisito", () => {
  const state = received(exhumation(false));
  const next = applyOperatorCommand(
    state,
    command({
      type: "REVIEW_DOCUMENT",
      document_id: "doc-1",
      document_status: "ILEGÍVEL_INADEQUADO",
      goal_id: undefined,
      fact_code: undefined,
    }),
    NOW,
  );
  assertEquals(next.documentos?.[0]?.estado, "ILEGÍVEL_INADEQUADO");
  assertEquals(next.facts, state.facts);
  assertEquals(next.pending_actions, state.pending_actions);
});

Deno.test("operations arquivo já aceito pode ser classificado depois preservando aceite", () => {
  const original = received(exhumation(false));
  const accepted = applyOperatorCommand(
    original,
    command({
      type: "REVIEW_DOCUMENT",
      document_id: "doc-1",
      document_status: "ACEITO",
      goal_id: undefined,
      fact_code: undefined,
    }),
    NOW,
  );
  assertEquals(accepted.documentos?.[0]?.estado, "ACEITO");
  const classified = applyOperatorCommand(
    accepted,
    command({
      type: "REVIEW_DOCUMENT",
      document_id: "doc-1",
      document_status: "ACEITO",
      fact_code: "requester_document",
    }),
    "2026-09-09T21:00:00Z",
  );
  assertEquals(classified.documentos?.[0]?.aceito_em, NOW);
  assertEquals(classified.documentos?.[0]?.tipo, "requester_document");
  assertEquals(activeFact(classified, "exhumation_authorization", classified.goals[0]!), null);
  assertEquals(activeFact(classified, "requester_document", classified.goals[0]!)?.source, "DOCUMENT");
});

Deno.test("operations RESUME exige versão do controle humano", async () => {
  await assertRejects(() => parseOperatorCommand(command({ type: "RESUME" })), /INVALID_CONTROL_VERSION/);
  const parsed = parseOperatorCommand(
    command({ type: "RESUME", expected_control_version: "2026-09-09T20:00:00.123456Z" }),
  );
  assertEquals(parsed.expected_control_version, "2026-09-09T20:00:00.123456Z");
});

Deno.test("operations documento de outro caso, inexistente ou classificado como autorização é recusado", async () => {
  const state = received(exhumation(false), "case999");
  const review = command({
    type: "REVIEW_DOCUMENT",
    document_id: "doc-1",
    document_status: "ACEITO",
    fact_code: "requester_document",
  });
  await assertRejects(() => applyOperatorCommand(state, review, NOW), /DOCUMENT_CLASSIFICATION_NOT_ALLOWED/);
  await assertRejects(
    () => applyOperatorCommand(state, { ...review, document_id: "missing" }, NOW),
    /DOCUMENT_REVIEW_NOT_ALLOWED/,
  );
  await assertRejects(
    () => applyOperatorCommand(received(exhumation()), { ...review, fact_code: "exhumation_authorization" }, NOW),
    /DOCUMENT_CLASSIFICATION_NOT_ALLOWED/,
  );
  assertEquals(state.documentos?.[0]?.estado, "RECEBIDO", "rejeição não modifica estado anterior");
});

Deno.test("operations RESUME conserva casos, fatos e decisões e recupera coleta", () => {
  const state = applyEvent(exhumation(false), { kind: "HUMAN_REQUEST" });
  state.pending_question = null;
  const next = applyOperatorCommand(state, command({ type: "RESUME" }), NOW);
  assertEquals(next.handoff, null);
  assertEquals(next.cases, state.cases);
  assertEquals(next.facts, state.facts);
  assertEquals(next.pending_actions, state.pending_actions);
  assertEquals(next.pending_question?.fact_code, "burial_reference");
});

Deno.test("operations solicitações têm UUID estável e repetição não duplica", async () => {
  const base = exhumation(false);
  const first = await withOperationalRequests(base);
  const second = await withOperationalRequests(first);
  const sameInput = await withOperationalRequests(base);
  assertEquals(first.solicitacoes?.length, 1);
  assertEquals(first.solicitacoes, second.solicitacoes);
  assertEquals(first.solicitacoes?.[0]?.solicitacao_id, sameInput.solicitacoes?.[0]?.solicitacao_id);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(first.solicitacoes![0]!.solicitacao_id),
  );
  assertEquals(validateState(first), []);
  assertEquals(base.solicitacoes, []);
});

Deno.test("operations perguntas informativas não abrem protocolo", async () => {
  let state = applyEvent(initState(CONVERSATION), {
    kind: "NEW_GOAL",
    goal_code: "GOAL_INFO_HORARIO",
    facts: [{ code: "service_hours_request", value: "Qual horário?" }],
  });
  state = applyEvent(state, {
    kind: "PARALLEL_QUESTION",
    goal_code: "GOAL_INFO_OSSUARIO",
    facts: [{ code: "ossuary_information_request", value: "O que é ossuário?" }],
  });
  assertEquals((await withOperationalRequests(state)).solicitacoes, []);
});

Deno.test("operations handoff do segundo caso não formaliza primeiro caso do mesmo tipo", async () => {
  let state = initState(CONVERSATION);
  for (const name of ["primeiro", "segundo"]) {
    state = applyEvent(state, {
      kind: "NEW_GOAL",
      goal_code: "GOAL_JAZIGO_SERVICOS",
      case_ref: name,
      facts: [{ code: "grave_service_description", value: `serviço ${name}` }],
    });
  }
  state = applyEvent(state, { kind: "HUMAN_REQUEST" });
  const next = await withOperationalRequests(state);
  assertEquals(next.solicitacoes?.length, 1);
  assertEquals(next.solicitacoes?.[0]?.case_id, state.handoff?.case_id);
  assertEquals(next.solicitacoes?.[0]?.goal_id, contextGoal(state)?.goal_id);
});

Deno.test("operations solicitação existente atualiza referências de fatos sem duplicação", async () => {
  let state = await withOperationalRequests(exhumation(false));
  const id = state.solicitacoes![0]!.solicitacao_id;
  state = applyEvent(state, { kind: "ANSWER", facts: [{ code: "burial_reference", value: "Pessoa A, Q1" }] });
  state = await withOperationalRequests(state);
  const fact = activeFact(state, "burial_reference", state.goals[0]!)!;
  assertEquals(state.solicitacoes?.length, 1);
  assertEquals(state.solicitacoes?.[0]?.solicitacao_id, id);
  assert(
    state.solicitacoes?.[0]?.collected_fact_ids.includes(fact.fact_id),
    "solicitação deve apontar para coleta nova",
  );
});

async function operatorHarness(
  state: ConversationState,
  options: { revision?: number; replayed?: boolean; phone?: string; authenticated?: boolean; automationMode?: string } =
    {},
) {
  const calls: { route: string; body: Record<string, unknown> }[] = [];
  const hash = await currentCatalogHash();
  const fetcher: typeof fetch = (input, init) => {
    const route = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ route, body });
    if (route === "/auth/v1/user") {
      return Promise.resolve(
        new Response(JSON.stringify({ id: ACTOR }), { status: options.authenticated === false ? 401 : 200 }),
      );
    }
    if (route.endsWith("support_runtime_operator_snapshot")) {
      return Promise.resolve(Response.json({
        state,
        revision: options.revision ?? 7,
        catalog_hash: hash,
        automation_mode: options.automationMode ?? "bot",
        phone_e164: options.phone ?? CANARY,
        requests: [],
      }));
    }
    if (route.endsWith("support_runtime_operator_replay")) {
      return Promise.resolve(Response.json({ replayed: options.replayed === true, revision: 8 }));
    }
    if (route.endsWith("support_runtime_commit_operator")) {
      return Promise.resolve(Response.json({ replayed: false, revision: 8 }));
    }
    return Promise.reject(new Error(`unexpected transport route ${route}`));
  };
  const rest = new OfficialSupabaseRest({
    url: "https://supabase.invalid",
    serviceRoleKey: "fixture-service",
    fetcher,
  });
  const request = new Request("https://runtime.invalid", { headers: { authorization: "Bearer fixture-user" } });
  const invoke = (cmd = command()) =>
    processOfficialOperator({ kind: "OPERATOR_COMMAND", command: cmd }, request, rest, CANARY);
  return { calls, rest, request, invoke };
}

Deno.test("operations Edge revisão divergente impede redução e gravação", async () => {
  const harness = await operatorHarness(exhumation(), { revision: 8 });
  try {
    await harness.invoke();
    throw new Error("expected conflict");
  } catch (error) {
    assert(error instanceof HttpProblem);
    assertEquals(error.code, "RUNTIME_REVISION_CONFLICT");
  }
  assert(!harness.calls.some((call) => call.route.endsWith("support_runtime_commit_operator")));
});

Deno.test("operations Edge replay com revisão antiga não reaplica nem grava novamente", async () => {
  const resolved = applyOperatorCommand(exhumation(), command(), NOW);
  const harness = await operatorHarness(resolved, { revision: 8, replayed: true });
  const result = await harness.invoke();
  assert("accepted" in result);
  assert("replayed" in result);
  assertEquals(result.accepted, true);
  assertEquals(result.replayed, true);
  assert(!harness.calls.some((call) => call.route.endsWith("support_runtime_commit_operator")));
});

Deno.test("operations Edge aplica reducer real e envia decisão consistente à gravação atômica", async () => {
  const harness = await operatorHarness(exhumation());
  await harness.invoke();
  const commit = harness.calls.find((call) => call.route.endsWith("support_runtime_commit_operator"))!.body;
  const next = commit.p_state as ConversationState;
  assertEquals(next.goals[0]?.status, "RESOLVED");
  assertEquals(next.pending_actions, []);
  assertEquals(next.solicitacoes?.length, 1);
  assertEquals(validateState(next), []);
  assertEquals(commit.p_actor_id, ACTOR);
  assertEquals(commit.p_expected_revision, 7);
});

Deno.test("operations Edge exige sessão válida e restringe comandos ao canário", async () => {
  for (const options of [{ authenticated: false }, { phone: "+5511999999999" }]) {
    const harness = await operatorHarness(exhumation(), options);
    try {
      await harness.invoke();
      throw new Error("expected rejection");
    } catch (error) {
      assert(error instanceof HttpProblem);
      assert(["USER_SESSION_INVALID", "CANARY_PHONE_BLOCKED"].includes(error.code));
    }
    assert(!harness.calls.some((call) => call.route.endsWith("support_runtime_commit_operator")));
  }
});

Deno.test("operations Edge decisão em atendimento humano preserva pausa sem resposta automática", async () => {
  const harness = await operatorHarness(exhumation(), { automationMode: "human" });
  await harness.invoke();
  const commit = harness.calls.find((call) => call.route.endsWith("support_runtime_commit_operator"))!.body;
  assertEquals(commit.p_reply_body, null);
  assertEquals((commit.p_projection as Record<string, unknown>).automation_mode, "human");
});

Deno.test("operations snapshot entrega referências operacionais sem expor fatos ou conteúdo documental", async () => {
  const harness = await operatorHarness(received(exhumation()));
  const result = await processOfficialOperator(
    { kind: "OPERATOR_SNAPSHOT", conversation_id: CONVERSATION },
    harness.request,
    harness.rest,
    CANARY,
  );
  assert("goals" in result && "documents" in result);
  assertEquals(result.commands_enabled, true);
  assert(!("state" in result) && !("facts" in result));
  assert(!JSON.stringify(result).includes("Identificação A"));
  assertEquals(result.documents?.[0]?.document_id, "doc-1");
  assert(harness.calls.every((call) => !call.route.endsWith("support_runtime_commit_operator")));
});
