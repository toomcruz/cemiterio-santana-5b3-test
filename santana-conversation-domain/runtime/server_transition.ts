/**
 * Runtime server-side boundary for the official conversation engine.
 *
 * It reconstructs the canonical reducer state from `conv_get_state`, assigns
 * opaque server UUIDs/HMACs, derives the structural transition and exposes only
 * a payload suitable for `conv_apply_transition`.  It contains no W-API, UI or
 * legacy-panel dependency.
 */
import {
  type ConversationState,
  initState,
  type PendingAction,
  type QuestionRef,
} from "../engine/engine.ts";
import {
  canonicalState,
  diffTransition,
  newIdMap,
  questionKey,
  type IdMap,
  type SubjectResolver,
  uuidFor,
} from "../engine/persistence.ts";
import { eventsDoc, factsDoc, goalsDoc, questionsDoc, relationsDoc, stateSchema, topicsDoc } from "../engine/catalog.ts";

export interface PersistedConversationState {
  exists: boolean;
  session_id?: string;
  seq: number;
  catalog_hash?: string;
  state_hash?: string;
  cases?: Array<{
    case_id: string;
    subject_kind: string;
    subject_ref_hmac: string;
    identity_key_version: number;
    status: string;
    opened_at_seq: number;
  }>;
  goals?: Array<Record<string, unknown>>;
  facts?: Array<Record<string, unknown>>;
  pending_question?: Record<string, unknown> | null;
  parked_questions?: Array<Record<string, unknown>>;
  pending_actions?: Array<Record<string, unknown>>;
}

export interface PreparedTransition {
  expected_seq: number;
  idempotency_key: string;
  transition: {
    event_kind: string;
    catalog_hash: string;
    state_hash: string;
    inbound_message_id?: string;
    correlation_id?: string;
    ops: Array<Record<string, unknown>>;
  };
}

interface Hydrated {
  state: ConversationState;
  ids: IdMap;
  subjects: Map<string, { hmac: string; key_version: number }>;
}

const textEncoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) =>
      `${JSON.stringify(key)}:${canonicalJson(nested)}`
    ).join(",")}}`;
  }
  // JSON.stringify(undefined) returns undefined even though this helper's
  // contract is a string.  Treat it like JSON null so the hash stays total and
  // deterministic for optional metadata.
  return JSON.stringify(value) ?? "null";
}

/** Stable hash pinned in every persisted conversation transition. */
export async function currentCatalogHash(): Promise<string> {
  return sha256(canonicalJson({ topicsDoc, factsDoc, goalsDoc, relationsDoc, questionsDoc, eventsDoc, stateSchema }));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function hydrateQuestion(value: Record<string, unknown>): QuestionRef {
  return {
    question_code: String(value.question_code),
    fact_code: String(value.fact_code),
    goal_id: String(value.goal_id),
    priority_class: String(value.priority_class) as QuestionRef["priority_class"],
    asked_at_seq: Number(value.asked_at_seq),
  };
}

/** Converts the closed RPC read-model into the reducer's in-memory state. */
export function hydratePersistedState(raw: PersistedConversationState, conversationId: string): Hydrated {
  const state = initState(conversationId);
  state.seq = Number(raw.seq ?? 0);
  const ids = newIdMap();
  const subjects = new Map<string, { hmac: string; key_version: number }>();

  for (const row of raw.cases ?? []) {
    state.cases.push({
      case_id: row.case_id,
      subject_kind: row.subject_kind,
      // The raw subject is intentionally never returned by the RPC.  The HMAC is
      // kept as the in-memory reference and the resolver preserves it verbatim.
      subject_ref: row.subject_ref_hmac,
      opened_at_seq: Number(row.opened_at_seq),
    });
    ids.ids[`case:${row.case_id}`] = row.case_id;
    subjects.set(row.subject_ref_hmac, { hmac: row.subject_ref_hmac, key_version: Number(row.identity_key_version) });
  }
  for (const row of raw.goals ?? []) {
    const goal = {
      goal_id: String(row.goal_id),
      goal_code: String(row.goal_code),
      case_id: stringOrNull(row.case_id),
      status: String(row.status) as ConversationState["goals"][number]["status"],
      status_reason: stringOrNull(row.status_reason),
      parent_goal_id: stringOrNull(row.parent_goal_id),
      overlay_of: stringOrNull(row.overlay_of),
      stack_index: Number(row.stack_index),
      informational: row.informational === true,
      return_to_parent: row.return_to_parent === true,
      opened_at_seq: Number(row.opened_at_seq),
      closed_at_seq: typeof row.closed_at_seq === "number" ? row.closed_at_seq : null,
      created_by_relation: stringOrNull(row.created_by_relation),
    };
    state.goals.push(goal);
    ids.ids[`goal:${goal.goal_id}`] = goal.goal_id;
  }
  for (const row of raw.facts ?? []) {
    const fact = {
      fact_id: String(row.fact_id),
      fact_code: String(row.fact_code),
      case_id: stringOrNull(row.case_id),
      goal_id: stringOrNull(row.goal_id),
      value: row.value as string | boolean | number | null,
      source: String(row.source) as ConversationState["facts"][number]["source"],
      confidence: String(row.confidence) as ConversationState["facts"][number]["confidence"],
      status: String(row.status) as ConversationState["facts"][number]["status"],
      recorded_at_seq: Number(row.recorded_at_seq),
      superseded_by: stringOrNull(row.superseded_by),
      superseded_at_seq: typeof row.superseded_at_seq === "number" ? row.superseded_at_seq : null,
      supersession_reason: stringOrNull(row.supersession_reason),
      conflicts_with: stringOrNull(row.conflicts_with),
      authoritative: row.authoritative === true,
      derived_from: Array.isArray(row.derived_from) ? row.derived_from.map(String) : [],
    };
    state.facts.push(fact);
    ids.ids[`fact:${fact.fact_id}`] = fact.fact_id;
  }
  if (raw.pending_question) {
    state.pending_question = hydrateQuestion(raw.pending_question);
    ids.ids[`question:${questionKey(state.pending_question)}`] = String(raw.pending_question.question_id);
  }
  state.parked_questions = (raw.parked_questions ?? []).map(hydrateQuestion);
  for (const row of raw.parked_questions ?? []) {
    const question = hydrateQuestion(row);
    ids.ids[`question:${questionKey(question)}`] = String(row.question_id);
  }
  state.pending_actions = (raw.pending_actions ?? []).map((row) => ({
    action_code: String(row.action_code),
    executor: String(row.executor) as PendingAction["executor"],
    goal_id: String(row.goal_id),
    requested_at_seq: Number(row.requested_at_seq),
  }));
  for (const row of raw.pending_actions ?? []) {
    const key = `${String(row.goal_id)}:${String(row.action_code)}:${Number(row.requested_at_seq)}`;
    ids.ids[`action:${key}`] = String(row.action_id);
  }
  const focus = state.goals.filter((goal) => goal.status === "ACTIVE").sort((a, b) => b.stack_index - a.stack_index)[0];
  state.current_topic = focus ? goalsDoc.goals.find((goal) => goal.goal_code === focus.goal_code)?.topic_code ?? null : null;
  return { state, ids, subjects };
}

function ensureIdsForNext(prev: ConversationState, next: ConversationState, ids: IdMap): void {
  for (const item of next.cases) if (!prev.cases.some((before) => before.case_id === item.case_id)) {
    ids.ids[`case:${item.case_id}`] ??= crypto.randomUUID();
  }
  for (const item of next.goals) if (!prev.goals.some((before) => before.goal_id === item.goal_id)) {
    ids.ids[`goal:${item.goal_id}`] ??= crypto.randomUUID();
  }
  for (const item of next.facts) if (!prev.facts.some((before) => before.fact_id === item.fact_id)) {
    ids.ids[`fact:${item.fact_id}`] ??= crypto.randomUUID();
  }
  for (const item of [next.pending_question, ...next.parked_questions]) if (item) {
    ids.ids[`question:${questionKey(item)}`] ??= crypto.randomUUID();
  }
  for (const item of next.pending_actions) {
    const key = `${item.goal_id}:${item.action_code}:${item.requested_at_seq}`;
    ids.ids[`action:${key}`] ??= crypto.randomUUID();
  }
}

async function prepareSubjectResolver(
  prev: ConversationState,
  next: ConversationState,
  subjects: Map<string, { hmac: string; key_version: number }>,
  identitySecret: string,
  identityKeyVersion: number,
): Promise<SubjectResolver> {
  for (const item of next.cases) {
    if (prev.cases.some((before) => before.case_id === item.case_id)) continue;
    subjects.set(item.subject_ref, {
      hmac: await hmacSha256(identitySecret, item.subject_ref),
      key_version: identityKeyVersion,
    });
  }
  return (subjectRef) => {
    const known = subjects.get(subjectRef);
    if (!known) throw new Error("subject HMAC was not prepared");
    return known;
  };
}

/**
 * Builds one atomic, replay-safe RPC payload. The caller persists it only after
 * it has successfully accepted/deduplicated the inbound message.
 */
export async function prepareTransition(input: {
  persisted: PersistedConversationState;
  previous: ConversationState;
  next: ConversationState;
  event_kind: string;
  identity_secret: string;
  identity_key_version: number;
  inbound_message_id?: string;
  correlation_id?: string;
}): Promise<PreparedTransition> {
  if (!input.identity_secret.trim()) throw new Error("identity secret is required");
  const catalogHash = await currentCatalogHash();
  if (input.persisted.exists && input.persisted.catalog_hash !== catalogHash) {
    throw new Error("catalog hash mismatch; migration/cutover is required before writing");
  }
  const hydrated = hydratePersistedState(input.persisted, input.previous.conversation_id);
  const ids = hydrated.ids;
  ensureIdsForNext(input.previous, input.next, ids);
  const subject = await prepareSubjectResolver(
    input.previous,
    input.next,
    hydrated.subjects,
    input.identity_secret,
    input.identity_key_version,
  );
  const ops = diffTransition(input.previous, input.next, ids, subject).map((op) => ({ ...op }));
  for (const op of ops) {
    if (op.op === "record_fact" && input.inbound_message_id) op.inbound_message_id = input.inbound_message_id;
  }
  const stateHash = await sha256(canonicalState(input.next, ids, subject));
  const transition = {
    event_kind: input.event_kind,
    catalog_hash: catalogHash,
    state_hash: stateHash,
    ...(input.inbound_message_id ? { inbound_message_id: input.inbound_message_id } : {}),
    ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
    ops,
  };
  return {
    expected_seq: Number(input.persisted.seq ?? 0),
    idempotency_key: await sha256(canonicalJson({ expected_seq: input.persisted.seq ?? 0, transition })),
    transition,
  };
}

/** Exposed for runtime tests that need the stable UUID assignment behaviour. */
export function persistedIdFor(ids: IdMap, kind: string, sourceId: string): string {
  return uuidFor(ids, kind, sourceId);
}
