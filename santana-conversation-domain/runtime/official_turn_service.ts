/**
 * Definitive runtime orchestration boundary.
 *
 * This service owns one inbound turn after a transport adapter has verified
 * W-API. It does not know Next.js, n8n, the legacy panel rules or W-API HTTP
 * details. The store implementation must atomically persist the proposed state
 * and enqueue the reply before any delivery attempt.
 */
import { type ConversationState, focusGoal, initState } from "../engine/engine.ts";
import { goalDef } from "../engine/catalog.ts";
import { registerReceivedDocumento } from "../engine/documento.ts";
import { validateState } from "../engine/validate.ts";
import type { LanguageInterpreter } from "./adapter/adapter.ts";
import { canonicalJson, currentCatalogHash, sha256 } from "./server_transition.ts";
import { planTurn, type TurnPlan } from "./turn.ts";

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
  }>;
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

function asStoredState(raw: unknown, conversationId: string): ConversationState {
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
  return focusGoal(state) ??
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
  const focus = projectedGoal(state);
  return {
    ...state,
    documentos: [
      ...existing,
      registerReceivedDocumento({
        documento_id: received.documento_id,
        case_id: focus?.case_id ?? null,
        tipo: received.tipo,
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
  return {
    subject: panelSubject(state),
    stage: waiting ? "aguardando" : focus ? "pendencias" : "novos",
    automation_mode: state.handoff ? "human" : "bot",
    flow_state: {
      runtime: "santana-conversation-domain/v1",
      current_goal: focus?.goal_code ?? null,
      current_topic: state.current_topic ?? null,
      pending_question_code: state.pending_question?.question_code ?? null,
      pending_fact_code: state.pending_question?.fact_code ?? null,
      pending_action_codes: state.pending_actions.map((action) => action.action_code),
      handoff_requested: state.handoff !== null,
      active_goal_status: focus?.status ?? null,
      goal_display_name: focus ? goalDef(focus.goal_code).topic_code : null,
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
  const plan = await planTurn({
    message_id: lease.inbound_message_id,
    text: inbound.body,
    state,
    automation_mode: lease.automation_mode,
  }, interpreter);
  const nextState = withReceivedDocument(plan.next_state, lease.received_document);
  const stateErrors = validateState(nextState);
  const replyBody = replyWithAttachment(
    plan.reply_draft,
    lease.received_document,
    lease.attachment_failure,
    plan.outcome,
  );
  if (stateErrors.length) throw new Error(`engine produced an invalid state: ${stateErrors.slice(0, 3).join("; ")}`);
  const commit = await store.commitTurn({
    conversation_id: lease.conversation_id,
    inbound_message_id: lease.inbound_message_id,
    expected_revision: lease.revision,
    catalog_hash: catalogHash,
    state_hash: await sha256(canonicalJson(nextState)),
    state: nextState,
    outcome: plan.outcome,
    event_kind: plan.interpretation?.primary_event?.event_kind ?? null,
    reply_body: replyBody,
    projection: panelProjection(nextState),
  });
  const kind = plan.outcome === "HUMAN_ACTIVE"
    ? "HUMAN_ACTIVE"
    : plan.outcome === "INTERPRETATION_UNAVAILABLE"
    ? "INTERPRETATION_UNAVAILABLE"
    : "COMMITTED";
  return {
    kind,
    conversation_id: lease.conversation_id,
    inbound_message_id: lease.inbound_message_id,
    revision: commit.revision,
    reply_body: commit.replayed ? null : replyBody,
    outbox_id: commit.outbox_id,
    event_kind: plan.interpretation?.primary_event?.event_kind ?? null,
  };
}
