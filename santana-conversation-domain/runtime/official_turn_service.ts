/**
 * Definitive runtime orchestration boundary.
 *
 * This service owns one inbound turn after a transport adapter has verified
 * W-API. It does not know Next.js, n8n, the legacy panel rules or W-API HTTP
 * details. The store implementation must atomically persist the proposed state
 * and enqueue the reply before any delivery attempt.
 */
import { contextGoal, type ConversationState, initState } from "../engine/engine.ts";
import { goalDef } from "../engine/catalog.ts";
import { registerReceivedDocumento } from "../engine/documento.ts";
import { validateState } from "../engine/validate.ts";
import type { LanguageInterpreter } from "./adapter/adapter.ts";
import { canonicalJson, currentCatalogHash, sha256 } from "./server_transition.ts";
import { planTurn, type TurnPlan } from "./turn.ts";
import { officialInformationReply } from "./official_information.ts";
import { documentAwaitingReview, withOperationalRequests } from "./official_operations.ts";

export type RuntimeAutomationMode = "BOT_ACTIVE" | "HUMAN_ACTIVE";
export type RuntimeMessageType = "text" | "image" | "document" | "audio";

/**
 * Transporte opaco de mídia. Seus campos nunca entram no estado conversacional
 * nem na projeção pública; o adaptador de armazenamento é o único consumidor.
 */
export interface RuntimeInboundAttachment {
  file_name: string;
  mime_type: string;
  message_type: Exclude<RuntimeMessageType, "text">;
  media_url?: string | null;
  media_key?: string | null;
  media_direct_path?: string | null;
}

export interface RuntimeInbound {
  external_message_id: string;
  phone_e164: string;
  contact_name: string | null;
  body: string;
  message_type: RuntimeMessageType;
  metadata?: Record<string, unknown>;
  attachment?: RuntimeInboundAttachment | null;
}

export interface RuntimeLease {
  duplicate: boolean;
  conversation_id: string;
  inbound_message_id: string;
  revision: number;
  automation_mode: RuntimeAutomationMode;
  catalog_hash: string | null;
  state: unknown | null;
  /** Registrado pelo adaptador de armazenamento, nunca inferido pelo LLM. */
  received_document?: RuntimeReceivedDocument | null;
  /** Código técnico seguro; nunca contém URL, token ou detalhe do munícipe. */
  attachment_failure?: string | null;
}

export interface RuntimeReceivedDocument {
  documento_id: string;
  tipo: string;
  descricao: string | null;
  recebido_em: string;
}

export interface RuntimePanelProjection {
  subject: "nao_classificado" | "exumacao" | "recadastro" | "ossuario" | "concessao" | "comercial";
  stage: "novos" | "pendencias" | "aguardando";
  automation_mode: "bot" | "human";
  queue_status?: "inbox" | "waiting_citizen";
  flow_state: Record<string, unknown>;
}

export interface RuntimeCommit {
  conversation_id: string;
  inbound_message_id: string;
  expected_revision: number;
  catalog_hash: string;
  state_hash: string;
  state: ConversationState;
  outcome: TurnPlan["outcome"];
  event_kind: string | null;
  reply_body: string | null;
  projection: RuntimePanelProjection;
}

export interface RuntimeStore {
  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease>;
  commitTurn(input: RuntimeCommit): Promise<{
    replayed: boolean;
    revision: number;
    outbox_id: string | null;
    reply_suppressed?: boolean;
    reply_body?: string | null;
  }>;
}

export interface RuntimeAutomationPolicy {
  /**
   * Only an explicit true may authorize the runtime to draft or enqueue a reply.
   * A blocked inbound becomes human-owned so skipped turns can never be
   * reinterpreted out of sequence if the rollout is expanded later.
   */
  automatic_replies_allowed: boolean;
}

export interface RuntimeTurnResult {
  kind: "DUPLICATE" | "COMMITTED" | "HUMAN_ACTIVE" | "INTERPRETATION_UNAVAILABLE";
  conversation_id: string;
  inbound_message_id: string;
  revision: number;
  reply_body: string | null;
  outbox_id: string | null;
  event_kind: string | null;
}

export function asStoredState(raw: unknown, conversationId: string): ConversationState {
  if (raw === null || raw === undefined) return initState(conversationId);
  const errors = validateState(raw);
  if (errors.length) throw new Error(`persisted conversation state is invalid: ${errors.slice(0, 3).join("; ")}`);
  const state = structuredClone(raw) as ConversationState;
  if (state.conversation_id !== conversationId) throw new Error("persisted state belongs to another conversation");
  return state;
}

/**
 * Idempotent state migration for the first official runtime revision that
 * introduced explicit handoff for jazigo occurrences. Earlier experimental
 * turns could mark a bot-owned occurrence RESOLVED immediately after its first
 * description. Reopen only that unsafe terminal state; never touch a human
 * handoff, history, documents or another topic. The next atomic commit records
 * the migrated state and its new hash.
 */
function migrateStoredState(state: ConversationState): ConversationState {
  if (state.handoff !== null) return state;
  let changed = false;
  const goals = state.goals.map((goal) => {
    if (goal.goal_code !== "GOAL_JAZIGO_SERVICOS" || goal.status !== "RESOLVED") return goal;
    changed = true;
    return { ...goal, status: "ACTIVE" as const, status_reason: null, closed_at_seq: null };
  });
  if (!changed) return state;
  return {
    ...state,
    goals,
    current_topic: "JAZIGO_SERVICOS",
  };
}

function projectedGoal(state: ConversationState) {
  return contextGoal(state) ??
    [...state.goals].reverse().find((goal) => goal.overlay_of === null) ??
    state.goals.at(-1) ??
    null;
}

function panelSubject(state: ConversationState): RuntimePanelProjection["subject"] {
  const code = projectedGoal(state)?.goal_code;
  switch (code) {
    case "GOAL_EXUMACAO":
    case "GOAL_TRANSPORTE":
      return "exumacao";
    case "GOAL_RECADASTRO":
      return "recadastro";
    case "GOAL_INFO_OSSUARIO":
      return "ossuario";
    case "GOAL_CONCESSAO":
      return "concessao";
    case "GOAL_JAZIGO_SERVICOS":
    case "GOAL_COMERCIAL":
    case "GOAL_RECLAMACAO":
      return "comercial";
    default:
      return "nao_classificado";
  }
}

function withReceivedDocument(
  state: ConversationState,
  received: RuntimeReceivedDocument | null | undefined,
): ConversationState {
  if (!received) return state;
  const existing = state.documentos ?? [];
  if (existing.some((document) => document.documento_id === received.documento_id)) return state;
  const focus = state.goals.find((goal) => goal.goal_id === state.pending_question?.goal_id) ?? projectedGoal(state);
  const pendingIdentity =
    ["requester_document", "recadastro_holder_document"].includes(state.pending_question?.fact_code ?? "")
      ? state.pending_question!.fact_code
      : null;
  return {
    ...state,
    documentos: [
      ...existing,
      registerReceivedDocumento({
        documento_id: received.documento_id,
        case_id: focus?.case_id ?? null,
        tipo: pendingIdentity ?? received.tipo,
        recebido_em: received.recebido_em,
        ...(received.descricao ? { descricao: received.descricao } : {}),
      }),
    ],
  };
}

function replyWithAttachment(
  reply: string | null,
  received: RuntimeReceivedDocument | null | undefined,
  failure: string | null | undefined,
  outcome: TurnPlan["outcome"],
): string | null {
  if (outcome === "HUMAN_ACTIVE" || outcome === "INTERPRETATION_UNAVAILABLE") return reply;
  if (received) {
    const prefix = "Arquivo recebido e preservado. ";
    if (reply) return prefix + reply;
    return prefix +
      "Você pode continuar explicando o que precisa. O arquivo ficará pendente de análise; o recebimento não significa validação nem agendamento.";
  }
  if (failure) {
    const prefix = "Recebi sua mensagem, mas não consegui armazenar o arquivo agora. Você pode reenviá-lo mais tarde. ";
    return reply ? prefix + reply : prefix + "Você pode continuar explicando o que precisa.";
  }
  return reply;
}

/** A small, non-authoritative UI projection; full facts remain in private runtime state. */
export function panelProjection(state: ConversationState): RuntimePanelProjection {
  const focus = projectedGoal(state);
  const waiting = focus?.status === "WAITING" || state.handoff !== null;
  const documentReview = documentAwaitingReview(state);
  const authorization = focus?.goal_code === "GOAL_EXUMACAO"
    ? state.facts.find((fact) =>
      fact.status === "ACTIVE" && fact.fact_code === "exhumation_authorization" &&
      fact.case_id === focus.case_id && fact.authoritative && fact.confidence === "CONFIRMED"
    )
    : null;
  const collectionCompleted = !!focus && focus.goal_code === "GOAL_EXUMACAO" &&
    !state.pending_question && !documentReview;
  return {
    subject: panelSubject(state),
    stage: waiting ? "aguardando" : focus ? "pendencias" : "novos",
    automation_mode: state.handoff ? "human" : "bot",
    queue_status: documentReview || state.handoff || (waiting && !state.pending_question)
      ? "inbox"
      : state.pending_question
      ? "waiting_citizen"
      : "inbox",
    flow_state: {
      runtime: "santana-conversation-domain/v1",
      current_goal: focus?.goal_code ?? null,
      current_topic: state.current_topic ?? null,
      pending_question_code: state.pending_question?.question_code ?? null,
      pending_fact_code: state.pending_question?.fact_code ?? null,
      pending_action_codes: state.pending_actions.map((action) => action.action_code),
      waiting_for: documentReview || state.handoff || (state.pending_actions.length > 0 && !state.pending_question)
        ? "team"
        : state.pending_question
        ? "citizen"
        : null,
      runtime_requests: (state.solicitacoes ?? []).map((item) => ({
        id: item.solicitacao_id,
        goal_id: item.goal_id,
        summary: item.summary,
      })),
      handoff_requested: state.handoff !== null,
      active_goal_status: focus?.status ?? null,
      goal_display_name: focus ? goalDef(focus.goal_code).topic_code : null,
      // These dimensions intentionally do not collapse into goal.status:
      // conversational collection, administrative authority and physical
      // operation have independent meanings and lifecycles.
      conversation_collection_status: focus?.goal_code === "GOAL_EXUMACAO"
        ? collectionCompleted ? "COMPLETED" : "IN_PROGRESS"
        : "NOT_APPLICABLE",
      administrative_authorization_status: focus?.goal_code === "GOAL_EXUMACAO"
        ? authorization && String(authorization.value).startsWith("OBTIDA_") ? "AUTHORIZED" : "PENDING"
        : "NOT_APPLICABLE",
      operational_process_status: focus?.goal_code === "GOAL_EXUMACAO" ? "NOT_COMPLETED" : "NOT_APPLICABLE",
    },
  };
}

/**
 * Executes a single official turn. A duplicate is never interpreted a second
 * time; a reply remains a draft until RuntimeStore.commitTurn has committed it.
 */
export async function processOfficialTurn(
  inbound: RuntimeInbound,
  store: RuntimeStore,
  interpreter: LanguageInterpreter,
  automationPolicy: RuntimeAutomationPolicy,
): Promise<RuntimeTurnResult> {
  if (!inbound.external_message_id.trim()) throw new Error("external_message_id is required");
  if (!/^\+?[1-9][0-9]{7,14}$/.test(inbound.phone_e164)) throw new Error("phone_e164 is invalid");
  if (!inbound.body.trim()) throw new Error("message body is required");
  const catalogHash = await currentCatalogHash();
  const lease = await store.acquireInbound({ ...inbound, catalog_hash: catalogHash });
  if (lease.duplicate) {
    return {
      kind: "DUPLICATE",
      conversation_id: lease.conversation_id,
      inbound_message_id: lease.inbound_message_id,
      revision: lease.revision,
      reply_body: null,
      outbox_id: null,
      event_kind: null,
    };
  }
  // A lease without state is a just-created conversation.  It is safe to
  // initialise it with the currently deployed catalog even when an earlier
  // crashed worker created the receipt under the preceding catalog version.
  // Once a state exists, catalog changes require an explicit migration.
  if (lease.state !== null && lease.catalog_hash && lease.catalog_hash !== catalogHash) {
    throw new Error("catalog hash mismatch; a controlled conversation migration is required");
  }
  const state = migrateStoredState(asStoredState(lease.state, lease.conversation_id));
  const effectiveAutomationMode: RuntimeAutomationMode = automationPolicy.automatic_replies_allowed === true
    ? lease.automation_mode
    : "HUMAN_ACTIVE";
  const information = effectiveAutomationMode === "BOT_ACTIVE"
    ? await officialInformationReply({ text: inbound.body, state })
    : null;
  const infoState = information ? structuredClone(state) : null;
  if (infoState && information) {
    infoState.seq += 1;
    infoState.event_log.push({
      seq: infoState.seq,
      event_kind: "PARALLEL_QUESTION",
      note: `official-information:${information.topic}:${information.information_type}:${information.status}`,
    });
  }
  const plan: TurnPlan = infoState && information
    ? {
      expected_seq: state.seq,
      outcome: "PROPOSED",
      next_state: infoState,
      interpretation: null,
      question_draft: null,
      reply_draft: information.text,
    }
    : await planTurn({
      message_id: lease.inbound_message_id,
      text: inbound.body,
      state,
      automation_mode: effectiveAutomationMode,
    }, interpreter);
  const receivedState = withReceivedDocument(plan.next_state, lease.received_document);
  const nextState = effectiveAutomationMode === "BOT_ACTIVE"
    ? await withOperationalRequests(receivedState)
    : receivedState;
  const stateErrors = validateState(nextState);
  const awaitingFileReview = !information && nextState.handoff === null &&
    ["PROPOSED", "CLARIFICATION"].includes(plan.outcome) && documentAwaitingReview(nextState);
  const reviewNotice =
    "O arquivo recebido está aguardando conferência da equipe. Não precisa reenviar o mesmo arquivo agora; você pode acrescentar outras informações ao atendimento.";
  let reviewedDraft = plan.reply_draft;
  if (awaitingFileReview) {
    const question = plan.question_draft;
    if (question && reviewedDraft?.includes(question)) reviewedDraft = reviewedDraft.replace(question, reviewNotice);
    else if (plan.outcome === "PROPOSED" && plan.interpretation?.facts.length) {
      const corrected = ["CORRECTION", "CHANGE_OF_MIND"].includes(plan.interpretation.primary_event?.event_kind ?? "");
      reviewedDraft = `${
        corrected ? "Registrei a correção informada." : "Registrei a informação neste atendimento."
      } ${reviewNotice}`;
    } else reviewedDraft = reviewNotice;
  }
  const replyBody = replyWithAttachment(
    reviewedDraft,
    lease.received_document,
    lease.attachment_failure,
    plan.outcome,
  );
  if (stateErrors.length) throw new Error(`engine produced an invalid state: ${stateErrors.slice(0, 3).join("; ")}`);
  const projection = panelProjection(nextState);
  if (effectiveAutomationMode === "HUMAN_ACTIVE") projection.automation_mode = "human";
  const commit = await store.commitTurn({
    conversation_id: lease.conversation_id,
    inbound_message_id: lease.inbound_message_id,
    expected_revision: lease.revision,
    catalog_hash: catalogHash,
    state_hash: await sha256(canonicalJson(nextState)),
    state: nextState,
    outcome: plan.outcome,
    event_kind: information ? "PARALLEL_QUESTION" : plan.interpretation?.primary_event?.event_kind ?? null,
    reply_body: replyBody,
    projection,
  });
  const kind = plan.outcome === "HUMAN_ACTIVE" || commit.reply_suppressed === true
    ? "HUMAN_ACTIVE"
    : plan.outcome === "INTERPRETATION_UNAVAILABLE"
    ? "INTERPRETATION_UNAVAILABLE"
    : "COMMITTED";
  return {
    kind,
    conversation_id: lease.conversation_id,
    inbound_message_id: lease.inbound_message_id,
    revision: commit.revision,
    reply_body: commit.replayed || commit.reply_suppressed
      ? null
      : commit.reply_body === undefined
      ? replyBody
      : commit.reply_body,
    outbox_id: commit.outbox_id,
    event_kind: information ? "PARALLEL_QUESTION" : plan.interpretation?.primary_event?.event_kind ?? null,
  };
}
