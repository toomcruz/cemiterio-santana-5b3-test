/**
 * R7 — Solicitação (Fase 4B).
 *
 * Contrato de fronteira: solicitação carrega categoria, assunto composto,
 * motivo, encaminhamento e estado com ciclo PRÓPRIO por categoria.
 * Proibido status global único. Assunto nunca é redigido pelo LLM.
 *
 * Fonte: docs/decisoes-humanas/2026-08-19-plano-tecnico-fase-4.md § FASE 4B
 * Docs: docs/fase4/R7-SOLICITACAO.md
 */

export type {
  AssuntoComposition,
  ConfirmedFact,
  ForwardingRef,
  SolicitacaoCategory,
  SolicitacaoEstado,
  SolicitacaoInput,
  SolicitacaoRecord,
} from "../santana-conversation-domain/engine/solicitacao.ts";

export {
  CATEGORY_CYCLES,
  assertEstadoNoCiclo,
  composeAssunto,
  createSolicitacao,
  observableSolicitacaoState,
} from "../santana-conversation-domain/engine/solicitacao.ts";

/** Gaps cobertos por este contrato (parcialmente, fora da fronteira). */
export const R7_GAPS = ["G01", "G12", "G02"] as const;

/** Risco que o teste de não-colapso impede de voltar. */
export const R7_RISK = "R1_DUPLICACAO_DE_AUTORIDADE_POR_COLAPSO_DE_CATEGORIA" as const;
