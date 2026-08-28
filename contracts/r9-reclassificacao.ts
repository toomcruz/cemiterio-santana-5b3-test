/**
 * R9 — Reclassificação (Fase 4D).
 *
 * Gaps: G17 (tópico no estado), G03 (vínculo de origem), G16 (1ª mensagem).
 * Evento aditivo: RECLASSIFICATION.
 *
 * Divergência documentada (não corrigida silenciosamente):
 * - inventário geral de gaps: G03 → contrato R8
 * - seção específica FASE 4C: R8 = Sessão × processo
 * - seção específica FASE 4D: **novo R9 — Reclassificação** (definição vigente)
 *
 * Fonte: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4D
 * Docs: docs/fase4/R9-RECLASSIFICACAO.md
 */

export type { FirstMessageRoute } from "../santana-conversation-domain/runtime/interpreter/first_message.ts";

export { routeFirstMessage } from "../santana-conversation-domain/runtime/interpreter/first_message.ts";

/** Gaps cobertos por este contrato. */
export const R9_GAPS = ["G17", "G03", "G16"] as const;

/** Evento aditivo autoritativo. */
export const R9_EVENT_KIND = "RECLASSIFICATION" as const;

/** Garantia autoritativa. */
export const R9_GUARANTEE = "RECLASSIFICATION_PRESERVES_PROCESS" as const;
