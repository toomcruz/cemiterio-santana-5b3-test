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
