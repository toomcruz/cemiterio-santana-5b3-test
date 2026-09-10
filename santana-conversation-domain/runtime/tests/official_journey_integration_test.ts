/** Offline official-service integration: no network, database or WhatsApp delivery. */
import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, activeFactsForGoalCase, type ConversationState, initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { applyOperatorCommand, operatorReply, withOperationalRequests } from "../official_operations.ts";
import {
  panelProjection,
  processOfficialTurn,
  type RuntimeCommit,
  type RuntimeInbound,
  type RuntimeLease,
  type RuntimeReceivedDocument,
  type RuntimeStore,
} from "../official_turn_service.ts";
import { canonicalJson, sha256 } from "../server_transition.ts";

const CONVERSATION_ID = "91111111-2222-4333-8444-555555555555";
const ALLOWED = { automatic_replies_allowed: true } as const;

/** Models the revision/idempotency/outbox boundary, never the database schema. */
class TransactionalMemoryStore implements RuntimeStore {
  state: ConversationState = initState(CONVERSATION_ID);
  revision = 0;
  catalogHash: string | null = null;
  automation: RuntimeLease["automation_mode"] = "BOT_ACTIVE";
  commits: RuntimeCommit[] = [];
  committedInbound = new Set<string>();
  outbox = new Map<string, string>();
  nextDocument: RuntimeReceivedDocument | null = null;

  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    this.catalogHash ??= input.catalog_hash;
    const received = this.nextDocument;
    this.nextDocument = null;
    return Promise.resolve({
      duplicate: this.committedInbound.has(input.external_message_id),
      conversation_id: CONVERSATION_ID,
      inbound_message_id: input.external_message_id,
      revision: this.revision,
      automation_mode: this.automation,
      catalog_hash: this.catalogHash,
      state: structuredClone(this.state),
      received_document: received,
    });
  }

  async commitTurn(input: RuntimeCommit) {
    if (this.committedInbound.has(input.inbound_message_id)) {
      return { replayed: true, revision: this.revision, outbox_id: null };
    }
    assertEquals(input.expected_revision, this.revision, "revision must still belong to this turn");
    assertEquals(
      input.state_hash,
      await sha256(canonicalJson(input.state)),
      "committed hash must cover the final state",
    );
    this.state = structuredClone(input.state);
    this.revision += 1;
    this.automation = input.projection.automation_mode === "human" ? "HUMAN_ACTIVE" : "BOT_ACTIVE";
    this.committedInbound.add(input.inbound_message_id);
    this.commits.push(structuredClone(input));
    const id = input.reply_body === null ? null : `outbox-${input.inbound_message_id}`;
    if (id) this.outbox.set(id, input.reply_body!);
    return { replayed: false, revision: this.revision, outbox_id: id };
  }

  get lastCommit(): RuntimeCommit {
    return this.commits.at(-1)!;
  }
}

function input(id: string, body: string, messageType: RuntimeInbound["message_type"] = "text"): RuntimeInbound {
  return {
    external_message_id: id,
    phone_e164: "+5511000000000",
    contact_name: "Synthetic offline test",
    body,
    message_type: messageType,
  };
}

const interpreter = { interpret: (message: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(message)) };

function turn(store: TransactionalMemoryStore, id: string, body: string) {
  return processOfficialTurn(input(id, body), store, interpreter, ALLOWED);
}

async function collectedPurposeAndSpouse(prefix: string) {
  const store = new TransactionalMemoryStore();
  await turn(store, `${prefix}-start`, "Quero realizar exumação");
  assertEquals(store.state.goals[0]?.goal_code, "GOAL_EXUMACAO");
  assertEquals(store.lastCommit.projection.subject, "exumacao");
  assertEquals(store.state.pending_question?.fact_code, "exhumation_purpose");
  assertEquals(store.lastCommit.projection.queue_status, "waiting_citizen");
  assertEquals(store.state.solicitacoes?.length, 0);
  await turn(store, `${prefix}-purpose`, "Quero colocar nas gavetas");
  assertEquals(store.state.pending_question?.fact_code, "surviving_spouse_status");
  await turn(store, `${prefix}-spouse`, "Não");
  assertEquals(
    activeFact(store.state, "required_authorization_signatory", store.state.goals[0]!)?.value,
    "RESPONSAVEL_JAZIGO",
  );
  assertEquals(store.state.goals[0]?.status, "WAITING");
  assertEquals(store.state.pending_question?.fact_code, "burial_reference");
  assertEquals(store.state.pending_actions[0]?.action_code, "ACTION_COLLECT_EXHUMATION_AUTHORIZATION");
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.lastCommit.projection.flow_state.waiting_for, "citizen");
  return store;
}

Deno.test("official recadastro journey preserves documents and reaches administrative verification without claiming operational completion", async () => {
  const store = new TransactionalMemoryStore();
  const started = await turn(store, "recadastro-start", "Preciso atualizar o cadastro do jazigo");
  assertEquals(started.kind, "COMMITTED");
  assertEquals(started.event_kind, "NEW_GOAL");
  assertEquals(store.state.goals[0]?.goal_code, "GOAL_RECADASTRO");
  assertEquals(store.state.pending_question?.fact_code, "concession_reference");
  assertEquals(store.lastCommit.projection.subject, "recadastro");
  assertEquals(store.lastCommit.projection.queue_status, "waiting_citizen");
  assertEquals(store.state.solicitacoes?.length, 0);

  const unknown = await turn(store, "recadastro-unknown-reference", "Não sei");
  assertEquals(unknown.kind, "COMMITTED");
  assert(unknown.reply_body?.includes("pode informar apenas o que souber"));
  assertEquals(store.state.pending_question?.fact_code, "concession_reference");
  assertEquals(activeFact(store.state, "concession_reference", store.state.goals[0]!), null);

  const corrected = await turn(store, "recadastro-reference", "Corrigindo: quadra 4, jazigo 18");
  assert(corrected.reply_body?.includes("correção"));
  assertEquals(activeFact(store.state, "concession_reference", store.state.goals[0]!)?.value, "quadra 4, jazigo 18");
  assertEquals(store.state.pending_question?.fact_code, "recadastro_holder_document");

  store.nextDocument = {
    documento_id: "document-recadastro-illegible",
    tipo: "application/pdf",
    descricao: "documento-titular-ilegivel.pdf",
    recebido_em: "2026-09-10T10:00:00.000Z",
  };
  const received = await processOfficialTurn(
    input("recadastro-file-illegible", "[Arquivo recebido: documento-titular-ilegivel.pdf]", "document"),
    store,
    interpreter,
    ALLOWED,
  );
  assert(received.reply_body?.startsWith("Arquivo recebido e preservado."));
  assert(received.reply_body?.includes("aguardando conferência"));
  assertEquals(store.state.documentos?.[0]?.tipo, "recadastro_holder_document");
  assertEquals(store.state.documentos?.[0]?.estado, "RECEBIDO");
  assertEquals(store.lastCommit.projection.queue_status, "inbox");
  assertEquals(store.lastCommit.projection.flow_state.waiting_for, "team");
  assertEquals(activeFact(store.state, "recadastro_holder_document", store.state.goals[0]!), null);

  const illegibleCommand = {
    command_id: "94444444-4444-4444-8444-444444444444",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "REVIEW_DOCUMENT" as const,
    goal_id: store.state.goals[0]!.goal_id,
    document_id: "document-recadastro-illegible",
    document_status: "ILEGÍVEL_INADEQUADO" as const,
    note: "Documento sintético ilegível no teste offline",
  };
  store.state = await withOperationalRequests(
    applyOperatorCommand(store.state, illegibleCommand, "2026-09-10T10:01:00.000Z"),
  );
  store.revision += 1;
  assertEquals(store.state.documentos?.[0]?.estado, "ILEGÍVEL_INADEQUADO");
  assertEquals(store.state.pending_question?.fact_code, "recadastro_holder_document");
  assert(operatorReply(store.state, illegibleCommand).includes("novo envio"));

  store.nextDocument = {
    documento_id: "document-recadastro-readable",
    tipo: "image/jpeg",
    descricao: "documento-titular-legivel.jpg",
    recebido_em: "2026-09-10T10:02:00.000Z",
  };
  await processOfficialTurn(
    input("recadastro-file-readable", "[Imagem recebida: documento-titular-legivel.jpg]", "image"),
    store,
    interpreter,
    ALLOWED,
  );
  assertEquals(store.state.documentos?.length, 2);
  assertEquals(store.state.documentos?.[0]?.estado, "ILEGÍVEL_INADEQUADO");
  assertEquals(store.state.documentos?.[1]?.estado, "RECEBIDO");

  const acceptedCommand = {
    command_id: "95555555-5555-4555-8555-555555555555",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "REVIEW_DOCUMENT" as const,
    goal_id: store.state.goals[0]!.goal_id,
    document_id: "document-recadastro-readable",
    document_status: "ACEITO" as const,
    fact_code: "recadastro_holder_document",
    note: "Documento sintético legível conferido no teste offline",
  };
  store.state = await withOperationalRequests(
    applyOperatorCommand(store.state, acceptedCommand, "2026-09-10T10:03:00.000Z"),
  );
  store.revision += 1;
  const goal = store.state.goals[0]!;
  const request = store.state.solicitacoes?.[0];
  assertEquals(activeFact(store.state, "recadastro_holder_document", goal)?.source, "DOCUMENT");
  assertEquals(activeFact(store.state, "recadastro_holder_document", goal)?.authoritative, true);
  assertEquals(goal.status, "WAITING");
  assertEquals(store.state.pending_question, null);
  assertEquals(store.state.pending_actions[0]?.action_code, "ACTION_VERIFY_RECADASTRO");
  assertEquals(store.state.pending_actions[0]?.goal_id, goal.goal_id);
  assertEquals(request?.goal_id, goal.goal_id);
  assert(/^[0-9a-f-]{36}$/.test(request?.solicitacao_id ?? ""), "the administrative request is the stable protocol");
  assertEquals(request?.pending_action_refs, ["ACTION_VERIFY_RECADASTRO"]);
  assert(request?.collected_fact_ids.includes(activeFact(store.state, "concession_reference", goal)!.fact_id));
  assert(request?.collected_fact_ids.includes(activeFact(store.state, "recadastro_holder_document", goal)!.fact_id));
  assertEquals(panelProjection(store.state).flow_state.conversation_collection_status, "COMPLETED");
  assertEquals(panelProjection(store.state).flow_state.administrative_authorization_status, "PENDING");
  assertEquals(panelProjection(store.state).flow_state.operational_process_status, "NOT_COMPLETED");

  const returning = await turn(store, "recadastro-return", "Qual é o andamento do meu recadastro?");
  assert(returning.reply_body?.includes("aguarda"));
  assert(!returning.reply_body?.includes("concluído"));
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.state.solicitacoes?.[0]?.solicitacao_id, request?.solicitacao_id);

  const duplicateCommitCount = store.commits.length;
  const duplicateOutboxCount = store.outbox.size;
  const duplicate = await turn(store, "recadastro-return", "Qual é o andamento do meu recadastro?");
  assertEquals(duplicate.kind, "DUPLICATE");
  assertEquals(duplicate.reply_body, null);
  assertEquals(store.commits.length, duplicateCommitCount);
  assertEquals(store.outbox.size, duplicateOutboxCount);

  const verificationCommand = {
    command_id: "96666666-6666-4666-8666-666666666666",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "RESOLVE_ACTION" as const,
    goal_id: goal.goal_id,
    action_code: "ACTION_VERIFY_RECADASTRO",
    fact_code: "recadastro_status",
    value: "OK",
    note: "Recadastro sintético verificado pela Administração no teste offline",
  };
  store.state = await withOperationalRequests(
    applyOperatorCommand(store.state, verificationCommand, "2026-09-10T10:04:00.000Z"),
  );
  store.revision += 1;
  const finalProjection = panelProjection(store.state);
  const finalReply = operatorReply(store.state, verificationCommand);
  assertEquals(store.state.goals[0]?.status, "RESOLVED");
  assertEquals(activeFact(store.state, "recadastro_status", goal)?.value, "OK");
  assertEquals(activeFact(store.state, "recadastro_status", goal)?.authoritative, true);
  assert(finalReply.includes("verificação"));
  assert(finalReply.includes("não confirma execução nem agendamento"));
  assertEquals(finalProjection.flow_state.conversation_collection_status, "COMPLETED");
  assertEquals(finalProjection.flow_state.administrative_authorization_status, "VERIFIED");
  assertEquals(finalProjection.flow_state.operational_process_status, "NOT_COMPLETED");
  assertEquals(finalProjection.stage, "pendencias");
  assertEquals(finalProjection.queue_status, "inbox");
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.state.solicitacoes?.[0]?.estado, "ABERTO");
  assertEquals(store.state.solicitacoes?.[0]?.pending_action_refs, []);

  const resumed = await turn(store, "recadastro-after-decision", "Olá, como ficou meu atendimento?");
  assertEquals(resumed.kind, "COMMITTED");
  assert(!resumed.reply_body?.includes("recadastro foi concluído"));
  assert(!resumed.reply_body?.includes("serviço foi executado"));
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.state.solicitacoes?.[0]?.solicitacao_id, request?.solicitacao_id);
  assertEquals(store.commits.length, store.committedInbound.size);
  assertEquals(store.outbox.size, store.commits.filter((commit) => commit.reply_body !== null).length);
});

Deno.test("simultaneous recadastro cases keep references, documents, requests and operator decisions isolated", async () => {
  const store = new TransactionalMemoryStore();
  await turn(store, "recadastro-a-start", "Quero fazer o recadastro");
  await turn(store, "recadastro-a-reference", "Quadra 1, jazigo 10");
  const firstGoal = store.state.goals[0]!;
  store.nextDocument = {
    documento_id: "document-recadastro-a",
    tipo: "application/pdf",
    descricao: "titular-a.pdf",
    recebido_em: "2026-09-10T11:00:00.000Z",
  };
  await processOfficialTurn(
    input("recadastro-a-file", "[Arquivo recebido: titular-a.pdf]", "document"),
    store,
    interpreter,
    ALLOWED,
  );
  store.state = await withOperationalRequests(applyOperatorCommand(store.state, {
    command_id: "97777777-7777-4777-8777-777777777777",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "REVIEW_DOCUMENT",
    goal_id: firstGoal.goal_id,
    document_id: "document-recadastro-a",
    document_status: "ACEITO",
    fact_code: "recadastro_holder_document",
    note: "Documento A conferido no teste offline",
  }, "2026-09-10T11:01:00.000Z"));
  store.revision += 1;
  assertEquals(store.state.goals[0]?.status, "WAITING");

  await turn(store, "recadastro-b-start", "NOVO ATENDIMENTO DE RECADASTRO");
  await turn(store, "recadastro-b-reference", "Quadra 2, jazigo 20");
  const secondGoal = store.state.goals[1]!;
  assert(secondGoal.case_id !== firstGoal.case_id);
  assertEquals(activeFact(store.state, "concession_reference", firstGoal)?.value, "Quadra 1, jazigo 10");
  assertEquals(activeFact(store.state, "concession_reference", secondGoal)?.value, "Quadra 2, jazigo 20");
  store.nextDocument = {
    documento_id: "document-recadastro-b",
    tipo: "application/pdf",
    descricao: "titular-b.pdf",
    recebido_em: "2026-09-10T11:02:00.000Z",
  };
  await processOfficialTurn(
    input("recadastro-b-file", "[Arquivo recebido: titular-b.pdf]", "document"),
    store,
    interpreter,
    ALLOWED,
  );
  store.state = await withOperationalRequests(applyOperatorCommand(store.state, {
    command_id: "98888888-8888-4888-8888-888888888888",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "REVIEW_DOCUMENT",
    goal_id: secondGoal.goal_id,
    document_id: "document-recadastro-b",
    document_status: "ACEITO",
    fact_code: "recadastro_holder_document",
    note: "Documento B conferido no teste offline",
  }, "2026-09-10T11:03:00.000Z"));
  store.revision += 1;

  assertEquals(
    store.state.pending_actions.filter((action) => action.action_code === "ACTION_VERIFY_RECADASTRO").length,
    2,
  );
  assertEquals(store.state.solicitacoes?.length, 2);
  assertEquals(
    store.state.documentos?.find((document) => document.documento_id === "document-recadastro-a")?.case_id,
    firstGoal.case_id,
  );
  assertEquals(
    store.state.documentos?.find((document) => document.documento_id === "document-recadastro-b")?.case_id,
    secondGoal.case_id,
  );

  store.state = await withOperationalRequests(applyOperatorCommand(store.state, {
    command_id: "99999999-9999-4999-8999-999999999999",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "RESOLVE_ACTION",
    goal_id: secondGoal.goal_id,
    action_code: "ACTION_VERIFY_RECADASTRO",
    fact_code: "recadastro_status",
    value: "OK",
    note: "Somente o recadastro B foi verificado no teste offline",
  }, "2026-09-10T11:04:00.000Z"));
  store.revision += 1;

  assertEquals(store.state.goals.find((goal) => goal.goal_id === firstGoal.goal_id)?.status, "WAITING");
  assertEquals(store.state.goals.find((goal) => goal.goal_id === secondGoal.goal_id)?.status, "RESOLVED");
  assertEquals(activeFact(store.state, "recadastro_status", firstGoal), null);
  assertEquals(activeFact(store.state, "recadastro_status", secondGoal)?.value, "OK");
  assertEquals(store.state.pending_actions.length, 1);
  assertEquals(store.state.pending_actions[0]?.goal_id, firstGoal.goal_id);
  assertEquals(
    store.state.solicitacoes?.find((request) => request.goal_id === firstGoal.goal_id)?.pending_action_refs,
    ["ACTION_VERIFY_RECADASTRO"],
  );
  assertEquals(
    store.state.solicitacoes?.find((request) => request.goal_id === secondGoal.goal_id)?.pending_action_refs,
    [],
  );
});

Deno.test("official exhumation journey reaches administrative authorization without claiming operational completion", async () => {
  const store = await collectedPurposeAndSpouse("journey");
  const requestId = store.state.solicitacoes![0]!.solicitacao_id;
  await turn(store, "journey-reference", "Quadra 15, jazigo 63");
  assertEquals(store.state.pending_question?.fact_code, "requester_document");
  assertEquals(store.lastCommit.projection.queue_status, "waiting_citizen");

  store.nextDocument = {
    documento_id: "document-journey-identity",
    tipo: "application/pdf",
    descricao: "identificacao-teste.pdf",
    recebido_em: "2026-09-09T18:00:00.000Z",
  };
  const received = await processOfficialTurn(
    input("journey-file", "[Arquivo recebido: identificacao-teste.pdf]", "document"),
    store,
    interpreter,
    ALLOWED,
  );
  assert(received.reply_body?.startsWith("Arquivo recebido e preservado."));
  assert(received.reply_body?.includes("aguardando conferência"));
  assert(!received.reply_body?.includes("Qual o seu documento"));
  assertEquals(store.state.documentos?.[0]?.estado, "RECEBIDO");
  assertEquals(store.state.documentos?.[0]?.tipo, "requester_document");
  assertEquals(store.lastCommit.projection.queue_status, "inbox");
  assertEquals(store.lastCommit.projection.flow_state.waiting_for, "team");
  assertEquals(activeFact(store.state, "requester_document", store.state.goals[0]!), null);
  assertEquals(activeFact(store.state, "exhumation_authorization", store.state.goals[0]!), null);

  const beforeReview = await turn(store, "journey-file-return", "Olá");
  assert(beforeReview.reply_body?.includes("aguardando conferência"));
  assert(!beforeReview.reply_body?.includes("Qual o seu documento"));
  assertEquals(store.lastCommit.projection.queue_status, "inbox");

  // Administrative review is a separate, explicit operation. Receipt alone
  // never supplies the authoritative validation or exhumation authorization.
  const reviewed = applyOperatorCommand(store.state, {
    command_id: "92222222-2222-4333-8444-555555555555",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "REVIEW_DOCUMENT",
    goal_id: store.state.goals[0]!.goal_id,
    document_id: "document-journey-identity",
    document_status: "ACEITO",
    fact_code: "requester_document",
    note: "Documento sintético conferido apenas no teste offline",
  }, "2026-09-09T18:01:00.000Z");
  store.state = await withOperationalRequests(reviewed);
  store.revision += 1;
  assertEquals(store.state.documentos?.[0]?.estado, "ACEITO");
  assertEquals(store.state.pending_question, null);
  assertEquals(panelProjection(store.state).queue_status, "inbox");
  assertEquals(panelProjection(store.state).flow_state.waiting_for, "team");
  assertEquals(panelProjection(store.state).flow_state.conversation_collection_status, "COMPLETED");
  assertEquals(panelProjection(store.state).flow_state.administrative_authorization_status, "PENDING");
  assertEquals(panelProjection(store.state).flow_state.operational_process_status, "NOT_COMPLETED");

  const returning = await turn(store, "journey-return", "Olá");
  assert(returning.reply_body?.includes("aguarda a verificação da autorização"));
  assertEquals(store.lastCommit.projection.flow_state.current_goal, "GOAL_EXUMACAO");
  assertEquals(store.lastCommit.projection.flow_state.active_goal_status, "WAITING");
  assertEquals(store.lastCommit.projection.queue_status, "inbox");
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.state.solicitacoes?.[0]?.solicitacao_id, requestId);
  for (const fact of activeFactsForGoalCase(store.state, store.state.goals[0]!)) {
    assert(
      store.state.solicitacoes![0]!.collected_fact_ids.includes(fact.fact_id),
      "request context must include later data",
    );
  }
  assertEquals(activeFact(store.state, "exhumation_authorization", store.state.goals[0]!), null);
  assert(!returning.reply_body?.includes("agendad"));

  const authorizedCommand = {
    command_id: "93333333-3333-4333-8444-555555555555",
    conversation_id: CONVERSATION_ID,
    expected_revision: store.revision,
    type: "RESOLVE_ACTION" as const,
    goal_id: store.state.goals[0]!.goal_id,
    action_code: "ACTION_COLLECT_EXHUMATION_AUTHORIZATION",
    fact_code: "exhumation_authorization",
    value: "OBTIDA_RESPONSAVEL_JAZIGO",
    note: "Autorização administrativa sintética registrada no teste offline",
  };
  store.state = await withOperationalRequests(
    applyOperatorCommand(store.state, authorizedCommand, "2026-09-09T18:02:00.000Z"),
  );
  store.revision += 1;

  const finalReply = operatorReply(store.state, authorizedCommand);
  const projection = panelProjection(store.state);
  assert(finalReply.includes("autorização administrativa"));
  assert(finalReply.includes("não significa que a exumação foi executada"));
  assertEquals(store.state.goals[0]?.status, "RESOLVED");
  assertEquals(activeFact(store.state, "exhumation_authorization", store.state.goals[0]!)?.authoritative, true);
  assertEquals(projection.flow_state.conversation_collection_status, "COMPLETED");
  assertEquals(projection.flow_state.administrative_authorization_status, "AUTHORIZED");
  assertEquals(projection.flow_state.operational_process_status, "NOT_COMPLETED");
  assertEquals(projection.stage, "pendencias");
  assertEquals(projection.queue_status, "inbox");
  assertEquals(store.state.solicitacoes?.length, 1);
  assertEquals(store.state.solicitacoes?.[0]?.estado, "ABERTO");
  assertEquals(store.state.solicitacoes?.[0]?.pending_action_refs, []);
});

Deno.test("official price information preserves the waiting case, facts, question and single request", async () => {
  const store = await collectedPurposeAndSpouse("price");
  const before = structuredClone(store.state);
  const result = await processOfficialTurn(input("price-question", "Quais são os valores da exumação?"), store, {
    interpret: () => Promise.reject(new Error("pure official information must not reach the language interpreter")),
  }, ALLOWED);
  assertEquals(result.kind, "COMMITTED");
  assertEquals(result.event_kind, "PARALLEL_QUESTION");
  assert(result.reply_body?.includes("modalidade"));
  assert(result.reply_body?.includes("Administração"));
  assert(!result.reply_body?.includes("R$"));
  assertEquals(store.state.cases, before.cases);
  assertEquals(store.state.goals, before.goals);
  assertEquals(store.state.facts, before.facts);
  assertEquals(store.state.pending_question, before.pending_question);
  assertEquals(store.state.pending_actions, before.pending_actions);
  assertEquals(
    store.state.solicitacoes?.map((item) => item.solicitacao_id),
    before.solicitacoes?.map((item) => item.solicitacao_id),
  );
  assertEquals(store.lastCommit.projection.queue_status, "waiting_citizen");
  assertEquals(store.lastCommit.projection.flow_state.current_goal, "GOAL_EXUMACAO");
});

Deno.test("available official information answers the side question without completing or replacing the operational goal", async () => {
  const store = await collectedPurposeAndSpouse("available");
  const before = structuredClone(store.state);
  const result = await turn(store, "available-question", "Quem assina a autorização da exumação?");
  assertEquals(result.event_kind, "PARALLEL_QUESTION");
  assert(result.reply_body?.startsWith("Sem conjuge sobrevivente"));
  assertEquals(store.state.pending_question, before.pending_question);
  assertEquals(store.state.goals, before.goals);
  assertEquals(store.state.facts, before.facts);
  assertEquals(store.state.pending_actions, before.pending_actions);
  assertEquals(store.lastCommit.projection.flow_state.waiting_for, "citizen");
  assert(store.state.event_log.at(-1)?.note?.includes(":AVAILABLE"));
});

for (
  const [id, text, expectedPhrase] of [
    ["cancel", "Quero cancelar a exumação, quanto custa?", "pedido de cancelamento"],
    ["human", "Gostaria de falar com um atendente sobre o preço da exumação", "pedido de encaminhamento"],
  ]
) {
  Deno.test(`official mixed ${id} request reaches human ownership without being consumed by the information lane`, async () => {
    const store = await collectedPurposeAndSpouse(id!);
    await turn(store, `${id}-reference`, "Quadra 15, jazigo 63");
    store.nextDocument = {
      documento_id: `${id}-document`,
      tipo: "application/pdf",
      descricao: "teste.pdf",
      recebido_em: "2026-09-09T18:00:00.000Z",
    };
    await processOfficialTurn(
      input(`${id}-file`, "[Arquivo recebido: teste.pdf]", "document"),
      store,
      interpreter,
      ALLOWED,
    );
    assertEquals(store.lastCommit.projection.flow_state.waiting_for, "team");
    const before = structuredClone(store.state);
    const result = await turn(store, `${id}-request`, text!);
    assertEquals(result.event_kind, "HUMAN_REQUEST");
    assert(result.reply_body?.includes(expectedPhrase!));
    assert(!result.reply_body?.includes("foi cancelad"));
    assertEquals(store.state.handoff?.case_id, before.goals[0]?.case_id);
    assertEquals(store.state.handoff?.goal_code, "GOAL_EXUMACAO");
    assertEquals(store.lastCommit.projection.automation_mode, "human");
    assertEquals(store.lastCommit.projection.queue_status, "inbox");
    assertEquals(store.lastCommit.projection.flow_state.waiting_for, "team");
    assertEquals(store.state.solicitacoes?.length, 1);
    const resumed = await turn(store, `${id}-later-price`, "Quais os valores da exumação?");
    assertEquals(resumed.kind, "HUMAN_ACTIVE");
    assertEquals(resumed.reply_body, null);
  });
}

Deno.test("a duplicated inbound cannot create another official request or outbox item", async () => {
  const store = await collectedPurposeAndSpouse("duplicate");
  const count = store.commits.length;
  const outboxCount = store.outbox.size;
  const result = await turn(store, "duplicate-spouse", "Não");
  assertEquals(result.kind, "DUPLICATE");
  assertEquals(result.reply_body, null);
  assertEquals(store.commits.length, count);
  assertEquals(store.outbox.size, outboxCount);
  assertEquals(store.state.solicitacoes?.length, 1);
});

Deno.test("document review waiting preserves a price answer and acknowledges a correction instead of repeating status", async () => {
  const store = await collectedPurposeAndSpouse("review-context");
  await turn(store, "review-context-reference", "Quadra 15, jazigo 63");
  store.nextDocument = {
    documento_id: "review-context-document",
    tipo: "application/pdf",
    descricao: "teste.pdf",
    recebido_em: "2026-09-09T18:00:00.000Z",
  };
  await processOfficialTurn(
    input("review-context-file", "[Arquivo recebido: teste.pdf]", "document"),
    store,
    interpreter,
    ALLOWED,
  );
  const price = await turn(store, "review-context-price", "Quais são os valores da exumação?");
  assert(price.reply_body?.includes("modalidade"));
  assert(!price.reply_body?.includes("aguardando conferência"));
  assertEquals(store.lastCommit.projection.queue_status, "inbox");
  const correction = await turn(store, "review-context-correction", "Corrigindo: a exumação será para cremação");
  assertEquals(activeFact(store.state, "exhumation_purpose", store.state.goals[0]!)?.value, "CREMACAO");
  assert(correction.reply_body?.includes("correção"));
  assert(correction.reply_body?.includes("aguardando conferência"));
  assert(!correction.reply_body?.includes("Qual o seu documento"));
  assertEquals(store.lastCommit.projection.queue_status, "inbox");
  const failure = await processOfficialTurn(
    input("review-context-unavailable", "Quero acrescentar uma informação"),
    store,
    {
      interpret: () => Promise.reject(new Error("synthetic provider failure")),
    },
    ALLOWED,
  );
  assertEquals(failure.kind, "INTERPRETATION_UNAVAILABLE");
  assertEquals(failure.reply_body, null, "a review status must not become a reply after interpretation failed");
  assertEquals(failure.outbox_id, null);
});
