/**
 * R8 — Sessão × processo (Fase 4C / G11).
 *
 * Garantia: SESSION CLOSED != PROCESS CLOSED.
 * A sessão controla só o ciclo de atendimento/conexão.
 * O processo (cases, facts, documentos, solicitacoes) sobrevive ao fechamento.
 *
 * Vínculo unidirecional: processo → sessão (last_touched_session_id).
 * A sessão NÃO é dona do processo.
 *
 * Offline: sem fetch, sem timers, sem worker 3+2, sem Supabase/n8n/W-API.
 * Fonte: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4C
 */

import type { ConversationState } from "./engine.ts";

export const SESSION_STATUSES = [
  "ACTIVE",
  "WARNING_PENDING",
  "WARNING_SENT",
  "CLOSED",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Coleção documental futura (4E) — já protegida no hash, vazia em 4C. */
export const DOCUMENTOS_FUTURE_KEY = "documentos" as const;

export interface SessionRecord {
  session_id: string;
  conversation_id: string;
  status: SessionStatus;
}

const ALLOWED_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  ACTIVE: ["WARNING_PENDING", "CLOSED"],
  WARNING_PENDING: ["WARNING_SENT", "CLOSED"],
  WARNING_SENT: ["CLOSED"],
  CLOSED: [],
};

function assertSessionId(session_id: string): void {
  if (typeof session_id !== "string" || session_id.length < 1) {
    throw new Error("session_id obrigatorio");
  }
}

export function createSession(input: {
  session_id: string;
  conversation_id: string;
}): SessionRecord {
  assertSessionId(input.session_id);
  if (!input.conversation_id) throw new Error("conversation_id obrigatorio");
  return {
    session_id: input.session_id,
    conversation_id: input.conversation_id,
    status: "ACTIVE",
  };
}

export function transitionSession(
  session: SessionRecord,
  next: SessionStatus,
): SessionRecord {
  const allowed = ALLOWED_TRANSITIONS[session.status];
  if (!allowed.includes(next)) {
    throw new Error(
      `transicao de sessao invalida: ${session.status} → ${next}`,
    );
  }
  return { ...session, status: next };
}

/** Fecha a sessão. Não recebe nem muta objetos de processo. */
export function closeSession(session: SessionRecord): SessionRecord {
  if (session.status === "CLOSED") return session;
  return transitionSession(session, "CLOSED");
}

/**
 * Vínculo unidirecional: o processo registra qual sessão o tocou.
 * Não coloca ownership na sessão.
 */
export function bindProcessToSession(
  state: ConversationState,
  session_id: string,
): ConversationState {
  assertSessionId(session_id);
  return { ...state, last_touched_session_id: session_id };
}

/** Snapshot canônico só dos objetos de PROCESSO (não inclui metadado de sessão). */
export function processObjectsSnapshot(state: ConversationState): {
  cases: ConversationState["cases"];
  facts: ConversationState["facts"];
  solicitacoes: NonNullable<ConversationState["solicitacoes"]>;
  [DOCUMENTOS_FUTURE_KEY]: unknown[];
} {
  return {
    cases: structuredClone(state.cases),
    facts: structuredClone(state.facts),
    solicitacoes: structuredClone(state.solicitacoes ?? []),
    // 4E ainda não existe: coleção futura reservada e protegida no hash.
    [DOCUMENTOS_FUTURE_KEY]: [],
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

/** Hash determinístico dos objetos de processo (prova G11). */
export function hashProcessObjects(state: ConversationState): string {
  const snap = processObjectsSnapshot(state);
  const canonical = JSON.stringify(canonicalize(snap));
  // FNV-1a 64-bit — sync, sem rede, sem WebCrypto async.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Abre NOVA sessão sobre o processo existente.
 * Não cria processo novo; só rebind do vínculo unidirecional.
 */
export function openNewSessionForExistingProcess(input: {
  previousState: ConversationState;
  newSessionId: string;
  conversationId: string;
}): { session: SessionRecord; state: ConversationState } {
  if (input.previousState.conversation_id !== input.conversationId) {
    throw new Error(
      "nova sessao deve reabrir o mesmo conversation_id (mesmo processo)",
    );
  }
  const session = createSession({
    session_id: input.newSessionId,
    conversation_id: input.conversationId,
  });
  const state = bindProcessToSession(input.previousState, session.session_id);
  return { session, state };
}
