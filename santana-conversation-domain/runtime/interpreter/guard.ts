// Barreira de seguranca entre a linguagem e o dominio. Vale para QUALQUER
// interpretador (mock desta fase ou LLM da 5B.4-D): a proposta e sanitizada
// antes de virar evento, e o que for recusado fica registrado com o motivo.

import { factDef, factsDoc } from "../../engine/catalog.ts";
import type { CandidateFact, Interpretation, Refusal } from "./types.ts";

const ALLOWED_SOURCES = ["USER_EXPLICIT", "USER_CORRECTION"];
const KNOWN_FACTS = new Set(factsDoc.facts.map((f) => f.fact_code));

/**
 * Sanitiza a interpretacao:
 *  - fato autoritativo (situacao/autorizacao de jazigo, autorizacao de exumacao)
 *    NUNCA pode vir da linguagem;
 *  - fato com regra deterministica de negocio idem;
 *  - codigo desconhecido ou valor fora do dominio e descartado (anti-alucinacao);
 *  - origem diferente de USER_* e descartada (anti-escalada de autoridade);
 *  - confianca baixa vira esclarecimento, nunca adivinhacao.
 */
export function guardInterpretation(interpretation: Interpretation): Interpretation {
  const refusals: Refusal[] = [...interpretation.refusals];
  const kept: CandidateFact[] = [];

  for (const fact of interpretation.facts) {
    if (!KNOWN_FACTS.has(fact.fact_code)) {
      refusals.push({ reason: "UNKNOWN_CODE", detail: `fato fora do catalogo v1: ${fact.fact_code}` });
      continue;
    }
    const def = factDef(fact.fact_code);
    if (def.authoritative_only) {
      refusals.push({
        reason: "AUTHORITATIVE_FACT",
        detail: `${fact.fact_code} so e confirmado por sinal autoritativo da Administracao`,
      });
      continue;
    }
    if (def.deterministic_rule || def.ai_extractable === false) {
      refusals.push({
        reason: "OFFICIAL_RULE",
        detail: `${fact.fact_code} e definido por regra oficial, nao por interpretacao de linguagem`,
      });
      continue;
    }
    if (!ALLOWED_SOURCES.includes(fact.source)) {
      refusals.push({ reason: "FORBIDDEN_SOURCE", detail: `origem ${fact.source} nao pode vir da linguagem` });
      continue;
    }
    if (def.allowed_values && typeof fact.value === "string" && !def.allowed_values.includes(fact.value)) {
      refusals.push({
        reason: "VALUE_OUT_OF_DOMAIN",
        detail: `valor ${fact.value} fora do dominio de ${fact.fact_code}`,
      });
      continue;
    }
    if (fact.confidence === "LOW") {
      refusals.push({ reason: "LOW_CONFIDENCE", detail: `${fact.fact_code} exige confirmacao antes de virar fato` });
      continue;
    }
    kept.push(fact);
  }

  const lostEverything = interpretation.facts.length > 0 && kept.length === 0;
  const needsClarification = interpretation.needs_clarification || lostEverything;

  return {
    ...interpretation,
    facts: kept,
    refusals,
    needs_clarification: needsClarification,
    clarification_reason: interpretation.clarification_reason ??
      (lostEverything ? "nenhum fato da mensagem pode ser aceito pela camada de linguagem" : null),
  };
}

/** Verificacao dura, usada em teste: a proposta nao contem nada proibido. */
export function assertNoAuthorityEscalation(interpretation: Interpretation): void {
  for (const fact of interpretation.facts) {
    const def = factDef(fact.fact_code);
    if (def.authoritative_only || def.deterministic_rule || def.ai_extractable === false) {
      throw new Error(`escalada de autoridade: ${fact.fact_code}`);
    }
    if (!ALLOWED_SOURCES.includes(fact.source)) {
      throw new Error(`origem proibida na interpretacao: ${fact.source}`);
    }
  }
}
