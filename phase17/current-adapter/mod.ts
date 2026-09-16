/**
 * Isolated adapter for the complete safely executable v1 turn boundary.
 *
 * No network, database, transport or production adapter is imported here.
 * The result is intentionally honest about capabilities v1 does not have:
 * semantic tools, action receipts and handoff acceptance are never fabricated.
 */
import { type ConversationState, initState } from "../../santana-conversation-domain/engine/engine.ts";
import { validateState } from "../../santana-conversation-domain/engine/validate.ts";
import { interpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import {
  panelProjection,
  processOfficialTurn,
  type RuntimeCommit,
  type RuntimeInbound,
  type RuntimeLease,
  type RuntimePanelProjection,
  type RuntimeStore,
  type RuntimeTurnResult,
} from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { canonicalJson, sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";

export type CurrentWorkflowLabMode = "compat-v1" | "role-aware-v1";

export interface CurrentWorkflowLabMessage {
  turnId: string;
  role: "user" | "assistant";
  content: string;
}

export interface CurrentWorkflowLabInput {
  caseId: string;
  caseHash: string;
  messages: CurrentWorkflowLabMessage[];
  fixedClock: { instant: string; timezone: string };
  mode?: CurrentWorkflowLabMode;
}

export interface BenchmarkTraceV1 {
  schema_version: "benchmark-trace-v1.0.0";
  case_id: string;
  reply: string;
  recognized_intents: string[];
  reused_fact_keys: string[];
  asked_fact_keys: string[];
  actions: string[];
  track_updates: Array<{ track_id: string; from: string; to: string; evidence: string }>;
  handoff: {
    offered: boolean;
    priority: "none" | "normal" | "priority" | "P0";
    reason: string;
    payload_fields: string[];
    accepted: false | "unknown";
  };
  claims: Array<{ claim_code: string; text_span: string; receipt_refs: string[] }>;
  tool_calls: Array<{ tool: string; authorized: boolean; side_effect: boolean }>;
  receipts_used: string[];
  final_track_states: Record<string, "active" | "blocked" | "pending_handoff" | "handled" | "closed" | "inactive">;
  case_closed: boolean;
  closure_basis: string[];
  normalization: {
    method: "deterministic";
    model: "santana-conversation-domain/v1 deterministic interpreter";
    review_required: false;
  };
}

interface TurnAudit {
  turn_id: string;
  input: {
    content_sha256: string;
    content_characters: number;
    assistant_context_count: number;
    assistant_context_injected: boolean;
  };
  classification: {
    result_kind: RuntimeTurnResult["kind"];
    event_kind: string | null;
    subject: RuntimePanelProjection["subject"];
    current_topic: string | null;
    goal_codes: string[];
  };
  state: {
    revision_before: number;
    revision_after: number;
    state_hash: string;
    goal_statuses: string[];
  };
  policy_visible_gaps: {
    pending_fact_code: string | null;
    pending_action_codes: string[];
    waiting_for: unknown;
    administrative_authorization_status: unknown;
    operational_process_status: unknown;
  };
  handoff: {
    present: boolean;
    current_step: string | null;
  };
  outbox: {
    enqueued: boolean;
    outbox_id: string | null;
    body_sha256: string | null;
    body_characters: number;
  };
  response: {
    present: boolean;
    body_sha256: string | null;
    body_characters: number;
  };
  duration_ms: number;
}

export interface CurrentWorkflowLabResult {
  status: "COMPLETED";
  case_id: string;
  case_hash: string;
  trace: BenchmarkTraceV1;
  idempotency_probe: {
    duplicate_kind: RuntimeTurnResult["kind"];
    duplicate_reply_is_null: boolean;
    revision_unchanged: boolean;
    commits_unchanged: boolean;
    outbox_unchanged: boolean;
  };
  audit: {
    schema_version: "current-workflow-lab-audit/v1.0.0";
    mode: CurrentWorkflowLabMode;
    fixed_clock: CurrentWorkflowLabInput["fixedClock"];
    fixed_clock_consumed_by_v1: false;
    runtime_path: string[];
    input: Array<{
      turn_id: string;
      role: CurrentWorkflowLabMessage["role"];
      content_sha256: string;
      content_characters: number;
      submitted_to_runtime: boolean;
    }>;
    turns: TurnAudit[];
    final_state_hash: string;
    final_revision: number;
    outbox_count: number;
    unsupported_capabilities: string[];
  };
  metrics: {
    total_duration_ms: number;
    max_turn_duration_ms: number;
    user_turns: number;
    assistant_context_turns: number;
    committed_turns: number;
    automatic_replies: number;
    retries: 0;
    external_tool_calls: 0;
    semantic_receipts: 0;
  };
}

const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };
const automaticReplies = { automatic_replies_allowed: true } as const;

class StrictMemoryRuntimeStore implements RuntimeStore {
  state: ConversationState;
  revision = 0;
  catalogHash: string | null = null;
  automation: RuntimeLease["automation_mode"] = "BOT_ACTIVE";
  readonly commits: RuntimeCommit[] = [];
  readonly committedInbound = new Set<string>();
  readonly outbox = new Map<string, string>();
  private readonly leased = new Map<string, { revision: number; catalog_hash: string }>();

  constructor(private readonly conversationId: string) {
    this.state = initState(conversationId);
  }

  acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    this.catalogHash ??= input.catalog_hash;
    if (this.catalogHash !== input.catalog_hash) throw new Error("catalog hash changed inside one lab case");
    const duplicate = this.committedInbound.has(input.external_message_id);
    if (!duplicate) {
      this.leased.set(input.external_message_id, { revision: this.revision, catalog_hash: input.catalog_hash });
    }
    return Promise.resolve({
      duplicate,
      conversation_id: this.conversationId,
      inbound_message_id: input.external_message_id,
      revision: this.revision,
      automation_mode: this.automation,
      catalog_hash: this.catalogHash,
      state: structuredClone(this.state),
      received_document: null,
    });
  }

  async commitTurn(input: RuntimeCommit) {
    if (this.committedInbound.has(input.inbound_message_id)) {
      return { replayed: true, revision: this.revision, outbox_id: null };
    }
    const lease = this.leased.get(input.inbound_message_id);
    if (!lease) throw new Error("turn was not leased by this store");
    if (input.conversation_id !== this.conversationId) throw new Error("commit belongs to another conversation");
    if (input.expected_revision !== this.revision || lease.revision !== this.revision) {
      throw new Error("revision mismatch in isolated store");
    }
    if (input.catalog_hash !== lease.catalog_hash) throw new Error("catalog hash mismatch in isolated store");
    if (input.state_hash !== await sha256(canonicalJson(input.state))) throw new Error("state hash mismatch");
    const errors = validateState(input.state);
    if (errors.length) throw new Error(`invalid committed state: ${errors.slice(0, 3).join("; ")}`);

    this.state = structuredClone(input.state);
    this.revision += 1;
    this.automation = input.projection.automation_mode === "human" ? "HUMAN_ACTIVE" : "BOT_ACTIVE";
    this.committedInbound.add(input.inbound_message_id);
    this.leased.delete(input.inbound_message_id);
    this.commits.push(structuredClone(input));
    const outboxId = input.reply_body === null ? null : `lab-outbox-${input.inbound_message_id}`;
    if (outboxId) this.outbox.set(outboxId, input.reply_body!);
    return { replayed: false, revision: this.revision, outbox_id: outboxId };
  }
}

const GOAL_INTENTS: Record<string, string[]> = {
  GOAL_EXUMACAO: ["EXUMACAO", "RETIRAR_RESTOS"],
  GOAL_RECADASTRO: ["RECADASTRO"],
  GOAL_INFO_OSSUARIO: ["DESTINO_OSSUARIO", "RENOVACAO_OSSUARIO"],
  GOAL_CONCESSAO: ["CONCESSAO"],
  GOAL_JAZIGO_SERVICOS: ["LAPIDE_PLACA", "LIMPEZA_ZELADORIA", "OBRA_REFORMA"],
  GOAL_RECLAMACAO: ["RECLAMACAO_OPERACIONAL", "RECLAMACAO_SEM_RETORNO"],
  GOAL_TRANSPORTE: ["TRASLADO"],
};

const TRACK_IDS: Record<string, string> = {
  GOAL_EXUMACAO: "exhumation",
  GOAL_RECADASTRO: "recadastro",
  GOAL_INFO_OSSUARIO: "ossuary",
  GOAL_CONCESSAO: "concession",
  GOAL_JAZIGO_SERVICOS: "grave_service",
  GOAL_RECLAMACAO: "complaint",
  GOAL_TRANSPORTE: "transport",
  GOAL_COMERCIAL: "commercial",
  GOAL_OUTROS_ASSUNTOS: "other_subject",
  GOAL_INFO_HORARIO: "service_hours",
};

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function validateInput(input: CurrentWorkflowLabInput): CurrentWorkflowLabMode {
  if (!/^[a-z0-9_]+$/.test(input.caseId)) throw new Error("caseId must match benchmark-trace-v1");
  if (!/^[a-f0-9]{64}$/.test(input.caseHash)) throw new Error("caseHash must be lowercase SHA-256");
  if (!input.messages.length || !input.messages.some((message) => message.role === "user")) {
    throw new Error("at least one user message is required");
  }
  const ids = new Set<string>();
  for (const message of input.messages) {
    if (!/^[A-Za-z0-9_-]+$/.test(message.turnId)) throw new Error("turnId contains unsupported characters");
    if (ids.has(message.turnId)) throw new Error("turnId must be unique");
    ids.add(message.turnId);
    if (!message.content.trim()) throw new Error("message content is required");
  }
  if (!Number.isFinite(Date.parse(input.fixedClock.instant))) throw new Error("fixedClock.instant is invalid");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.fixedClock.timezone }).format(new Date(input.fixedClock.instant));
  } catch {
    throw new Error("fixedClock.timezone is invalid");
  }
  return input.mode ?? "compat-v1";
}

function safeConversationId(caseHash: string): string {
  return `91111111-2222-4333-8444-${caseHash.slice(0, 12)}`;
}

function transportSentinel(): string {
  return "+10000000";
}

function goalTrackState(
  status: ConversationState["goals"][number]["status"],
  pendingAction: boolean,
  handoff: boolean,
): "active" | "blocked" | "pending_handoff" | "handled" | "closed" | "inactive" {
  if (status === "RESOLVED") return "handled";
  if (status === "ABANDONED") return "closed";
  if (status === "SUSPENDED") return "inactive";
  if (handoff) return "pending_handoff";
  if (status === "WAITING" || pendingAction) return "blocked";
  return "active";
}

function finalTrackStates(state: ConversationState): BenchmarkTraceV1["final_track_states"] {
  const tracks: BenchmarkTraceV1["final_track_states"] = {};
  for (const goal of state.goals) {
    const id = TRACK_IDS[goal.goal_code] ?? normalize(goal.goal_code);
    tracks[id] = goalTrackState(
      goal.status,
      state.pending_actions.some((action) => action.goal_id === goal.goal_id),
      state.handoff?.goal_code === goal.goal_code,
    );
  }
  return tracks;
}

function recognizedIntents(state: ConversationState): string[] {
  const intents = new Set<string>();
  for (const goal of state.goals) for (const intent of GOAL_INTENTS[goal.goal_code] ?? []) intents.add(intent);
  return [...intents].sort();
}

function traceActions(
  reply: string,
  state: ConversationState,
  tracks: BenchmarkTraceV1["final_track_states"],
): string[] {
  const text = normalize(reply);
  const actions = new Set(state.pending_actions.map((action) => action.action_code));
  if (reply.includes("?")) actions.add("ASK_CLARIFYING_QUESTION");
  if (state.handoff) actions.add("HANDOFF");
  if (Object.keys(tracks).length > 1) actions.add("PRESERVE_TRACKS");
  if (/precisa confirmar|depende da administracao|informacao oficial|nao confirma/.test(text)) {
    actions.add("ACKNOWLEDGE_UNCERTAINTY");
  }
  if (/confirmacao|comprovante|aguard/.test(text)) actions.add("WAIT_FOR_RECEIPT");
  if (reply.includes("?") && /confirm|autoriza|posso/.test(text)) actions.add("REQUEST_EXPLICIT_CONFIRMATION");
  if (/urgente|prioridade|imediat/.test(text)) actions.add("PRIORITIZE_URGENT");
  if (/orcamento|oferta|venda/.test(text)) actions.add("OFFER_COMMERCIAL");
  if (/novo atendimento|escolha uma opcao|selecione uma opcao|voltar ao menu/.test(text)) {
    actions.add("RESTART_MENU");
  }
  return [...actions].sort();
}

function claims(reply: string): BenchmarkTraceV1["claims"] {
  const text = normalize(reply);
  if (!text || /nao confirma|ainda nao|precisa confirmar|depende da administracao|aguarda/.test(text)) return [];
  const patterns: Array<[string, RegExp]> = [
    ["APPOINTMENT_CONFIRMED_WITHOUT_RECEIPT", /\b(?:agendamento|horario)\b.{0,45}\bconfirmad/],
    ["PAYMENT_CONFIRMED_WITHOUT_RECEIPT", /\bpagamento\b.{0,45}\bconfirmad/],
    ["DOCUMENT_VALIDATED_WITHOUT_RECEIPT", /\bdocumento\b.{0,45}\b(?:validado|aprovado)/],
    ["EXECUTION_COMPLETED_WITHOUT_RECEIPT", /\b(?:servico|processo|execucao)\b.{0,45}\bconcluid/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([claim_code]) => ({
    claim_code,
    text_span: claim_code,
    receipt_refs: [],
  }));
}

function policyGaps(projection: RuntimePanelProjection, state: ConversationState): TurnAudit["policy_visible_gaps"] {
  return {
    pending_fact_code: state.pending_question?.fact_code ?? null,
    pending_action_codes: state.pending_actions.map((action) => action.action_code),
    waiting_for: projection.flow_state.waiting_for ?? null,
    administrative_authorization_status: projection.flow_state.administrative_authorization_status ?? null,
    operational_process_status: projection.flow_state.operational_process_status ?? null,
  };
}

/**
 * Runs the current v1 workflow without loading any external adapter.
 * `compat-v1` preserves the Phase 15 assistant-context concatenation. The
 * role-aware diagnostic omits assistant messages because v1 has no API for
 * ingesting them as already-sent context.
 */
export async function runCurrentWorkflowLabCase(input: CurrentWorkflowLabInput): Promise<CurrentWorkflowLabResult> {
  const mode = validateInput(input);
  const store = new StrictMemoryRuntimeStore(safeConversationId(input.caseHash));
  const inputAudit: CurrentWorkflowLabResult["audit"]["input"] = [];
  const turns: TurnAudit[] = [];
  let pendingAssistantContext: string[] = [];
  let finalInbound: RuntimeInbound | null = null;
  const started = performance.now();

  for (const message of input.messages) {
    inputAudit.push({
      turn_id: message.turnId,
      role: message.role,
      content_sha256: await sha256(message.content),
      content_characters: message.content.length,
      submitted_to_runtime: message.role === "user",
    });
    if (message.role === "assistant") {
      pendingAssistantContext.push(message.content);
      continue;
    }

    const assistantContextCount = pendingAssistantContext.length;
    const body = mode === "compat-v1" && assistantContextCount
      ? `Contexto sintético já registrado: ${pendingAssistantContext.join(" ")} Mensagem atual: ${message.content}`
      : message.content;
    pendingAssistantContext = [];
    const inbound: RuntimeInbound = {
      external_message_id: `lab-${input.caseHash.slice(0, 12)}-${message.turnId}`,
      phone_e164: transportSentinel(),
      contact_name: null,
      body,
      message_type: "text",
      metadata: { lab_fixed_clock: input.fixedClock.instant },
    };
    finalInbound = inbound;
    const before = store.revision;
    const turnStarted = performance.now();
    const result = await processOfficialTurn(inbound, store, interpreter, automaticReplies);
    const durationMs = Math.max(0, performance.now() - turnStarted);
    const commit = store.commits.at(-1);
    if (!commit) throw new Error("current runtime returned without a committed turn");
    const projection = commit.projection;
    const reply = result.reply_body ?? "";
    turns.push({
      turn_id: message.turnId,
      input: {
        content_sha256: await sha256(body),
        content_characters: body.length,
        assistant_context_count: assistantContextCount,
        assistant_context_injected: mode === "compat-v1" && assistantContextCount > 0,
      },
      classification: {
        result_kind: result.kind,
        event_kind: result.event_kind,
        subject: projection.subject,
        current_topic: store.state.current_topic ?? null,
        goal_codes: store.state.goals.map((goal) => goal.goal_code),
      },
      state: {
        revision_before: before,
        revision_after: store.revision,
        state_hash: commit.state_hash,
        goal_statuses: store.state.goals.map((goal) => `${goal.goal_code}:${goal.status}`),
      },
      policy_visible_gaps: policyGaps(projection, store.state),
      handoff: {
        present: store.state.handoff !== null,
        current_step: store.state.handoff?.current_step ?? null,
      },
      outbox: {
        enqueued: result.outbox_id !== null,
        outbox_id: result.outbox_id,
        body_sha256: result.outbox_id ? await sha256(store.outbox.get(result.outbox_id) ?? "") : null,
        body_characters: result.outbox_id ? (store.outbox.get(result.outbox_id)?.length ?? 0) : 0,
      },
      response: {
        present: Boolean(reply),
        body_sha256: reply ? await sha256(reply) : null,
        body_characters: reply.length,
      },
      duration_ms: durationMs,
    });
  }
  if (!finalInbound) throw new Error("fixture has no user message");

  const revisionBeforeDuplicate = store.revision;
  const commitsBeforeDuplicate = store.commits.length;
  const outboxBeforeDuplicate = store.outbox.size;
  const duplicate = await processOfficialTurn(finalInbound, store, interpreter, automaticReplies);
  const lastCommit = store.commits.at(-1);
  const reply = lastCommit?.reply_body ?? "";
  const projection = panelProjection(store.state);
  const tracks = finalTrackStates(store.state);
  const offered = store.state.handoff !== null || projection.flow_state.waiting_for === "team";
  const trace: BenchmarkTraceV1 = {
    schema_version: "benchmark-trace-v1.0.0",
    case_id: input.caseId,
    reply,
    recognized_intents: recognizedIntents(store.state),
    reused_fact_keys: [
      ...new Set(
        store.state.facts.filter((fact) => fact.status === "ACTIVE").map((fact) => fact.fact_code),
      ),
    ].sort(),
    asked_fact_keys: reply.includes("?") && store.state.pending_question
      ? [store.state.pending_question.fact_code]
      : [],
    actions: traceActions(reply, store.state, tracks),
    track_updates: [],
    handoff: {
      offered,
      priority: offered ? "normal" : "none",
      reason: store.state.handoff?.current_step ?? (offered ? String(projection.flow_state.waiting_for ?? "team") : ""),
      payload_fields: store.state.handoff
        ? ["goal", "confirmed_facts", "pending_facts", "current_question", "pending_actions"]
        : [],
      accepted: false,
    },
    claims: claims(reply),
    tool_calls: [],
    receipts_used: [],
    final_track_states: tracks,
    case_closed: store.state.goals.length > 0 && store.state.goals.every((goal) => goal.status === "RESOLVED"),
    closure_basis: [...new Set(store.state.goals.map((goal) => `${goal.goal_code}:${goal.status}`))],
    normalization: {
      method: "deterministic",
      model: "santana-conversation-domain/v1 deterministic interpreter",
      review_required: false,
    },
  };
  const totalDurationMs = Math.max(0, performance.now() - started);
  return {
    status: "COMPLETED",
    case_id: input.caseId,
    case_hash: input.caseHash,
    trace,
    idempotency_probe: {
      duplicate_kind: duplicate.kind,
      duplicate_reply_is_null: duplicate.reply_body === null,
      revision_unchanged: store.revision === revisionBeforeDuplicate,
      commits_unchanged: store.commits.length === commitsBeforeDuplicate,
      outbox_unchanged: store.outbox.size === outboxBeforeDuplicate,
    },
    audit: {
      schema_version: "current-workflow-lab-audit/v1.0.0",
      mode,
      fixed_clock: structuredClone(input.fixedClock),
      fixed_clock_consumed_by_v1: false,
      runtime_path: [
        "RuntimeInbound",
        "processOfficialTurn",
        "deterministic interpreter",
        "canonical reducer/state validation",
        "operational request projection",
        "atomic in-memory commit",
        "isolated outbox",
        "reply trace normalization",
      ],
      input: inputAudit,
      turns,
      final_state_hash: await sha256(canonicalJson(store.state)),
      final_revision: store.revision,
      outbox_count: store.outbox.size,
      unsupported_capabilities: [
        "assistant-role history ingestion (role-aware-v1)",
        "semantic action gateway",
        "tool execution receipts",
        "handoff acceptance receipt",
        "production transport delivery",
      ],
    },
    metrics: {
      total_duration_ms: totalDurationMs,
      max_turn_duration_ms: Math.max(0, ...turns.map((turn) => turn.duration_ms)),
      user_turns: turns.length,
      assistant_context_turns: input.messages.filter((message) => message.role === "assistant").length,
      committed_turns: store.commits.length,
      automatic_replies: store.outbox.size,
      retries: 0,
      external_tool_calls: 0,
      semantic_receipts: 0,
    },
  };
}
