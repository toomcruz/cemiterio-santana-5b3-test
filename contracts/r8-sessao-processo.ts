/**
 * R8 — Sessão × processo (Fase 4C).
 *
 * Garantia: SESSION CLOSED != PROCESS CLOSED (G11).
 * Vínculo unidirecional: processo → sessão.
 * Sessão não é dona do processo; não fecha case / não limpa facts /
 * documentos / solicitações.
 *
 * Fonte: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4C
 * Docs: docs/fase4/R8-SESSAO-PROCESSO.md
 */

export type { SessionRecord, SessionStatus } from "../santana-conversation-domain/engine/sessao_processo.ts";

export {
  bindProcessToSession,
  closeSession,
  createSession,
  DOCUMENTOS_FUTURE_KEY,
  hashProcessObjects,
  openNewSessionForExistingProcess,
  processObjectsSnapshot,
  SESSION_STATUSES,
  transitionSession,
} from "../santana-conversation-domain/engine/sessao_processo.ts";

/** Gap coberto por este contrato. */
export const R8_GAPS = ["G11"] as const;

/** Garantia autoritativa. */
export const R8_GUARANTEE = "SESSION_CLOSED_NE_PROCESS_CLOSED" as const;
