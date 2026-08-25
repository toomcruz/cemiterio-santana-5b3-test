// G16 — precedência da primeira mensagem sobre menu genérico (Fase 4D / R9).
// Regra no motor/interpreter: se a intenção é identificável com segurança,
// usa essa intenção. Não inventa classificador probabilístico.

import { goalDef } from "../../engine/catalog.ts";
import type { Interpretation } from "./types.ts";

export type FirstMessageRoute =
  | {
    kind: "SPECIALIZED";
    goal_code: string;
    topic_code: string;
  }
  | {
    kind: "DISAMBIGUATION";
    reason: string;
    options: string[];
  }
  | {
    kind: "GENERIC_MENU";
  };

/**
 * Roteia a primeira mensagem.
 * - intenção segura + goal especializado → SPECIALIZED (nunca menu genérico)
 * - ambígua / insufficiente → DISAMBIGUATION (menu/desambiguação permitido)
 * - GENERIC_MENU só quando não há intenção especializada nem ambiguidade útil
 */
export function routeFirstMessage(
  interpretation: Interpretation,
): FirstMessageRoute {
  const goalCode = interpretation.goal?.goal_code ?? null;
  const specialized = goalCode != null && goalCode !== "GOAL_OUTROS_ASSUNTOS";
  const confident = interpretation.overall_confidence === "HIGH" ||
    interpretation.overall_confidence === "MEDIUM";

  if (
    specialized &&
    confident &&
    !interpretation.needs_clarification &&
    interpretation.primary_event != null
  ) {
    return {
      kind: "SPECIALIZED",
      goal_code: goalCode,
      topic_code: goalDef(goalCode).topic_code,
    };
  }

  if (interpretation.needs_clarification || interpretation.goal == null) {
    return {
      kind: "DISAMBIGUATION",
      reason: interpretation.clarification_reason ??
        "primeira mensagem insuficiente/ambígua",
      options: interpretation.ambiguities.flatMap((a) => a.options),
    };
  }

  // Intenção só genérica (OUTROS) sem segurança → não forçar menu sobre
  // mensagem específica; aqui OUTROS explícito ainda é desambiguação.
  if (goalCode === "GOAL_OUTROS_ASSUNTOS") {
    return {
      kind: "DISAMBIGUATION",
      reason: "intenção genérica — desambiguação permitida",
      options: interpretation.ambiguities.flatMap((a) => a.options),
    };
  }

  return { kind: "GENERIC_MENU" };
}
