// Interpretador deterministico (mock desta fase): mensagem em pt-BR -> proposta
// de interpretacao. Sem LLM, sem rede, sem banco. Substituivel pelo adapter de
// LLM na 5B.4-D sem mudar o contrato.

import type {
  Ambiguity,
  CandidateEvent,
  CandidateFact,
  CandidateGoal,
  CaseReference,
  Confidence,
  Interpretation,
  InterpreterInput,
} from "./types.ts";
import type { EventKind } from "../../engine/catalog.ts";

interface GoalPattern {
  goal_code: string;
  subject_kind: string;
  any: string[];
  confidence: Confidence;
}
interface FactPattern {
  fact_code: string;
  value: string;
  any: string[];
  /** Frases que invalidam o casamento (ex.: "ainda nao paguei" nega "paguei"). */
  none?: string[];
  confidence: Confidence;
}
interface ParallelTopic {
  goal_code: string;
  fact_code: string;
  any: string[];
  confidence: Confidence;
}
interface AmbiguityPattern {
  code: string;
  all: string[];
  none: string[];
  description: string;
  options: string[];
  blocking: boolean;
}
interface AuthoritativeClaim {
  fact_code: string;
  any: string[];
}
interface Lexicon {
  authoritative_claim_patterns: AuthoritativeClaim[];
  correction_markers: string[];
  change_of_mind_markers: string[];
  parallel_question_markers: string[];
  complaint_markers: string[];
  new_subject_markers: string[];
  uncertainty_markers: string[];
  goal_patterns: GoalPattern[];
  fact_patterns: FactPattern[];
  parallel_topics: ParallelTopic[];
  ambiguity_patterns: AmbiguityPattern[];
  typo_tolerance: { max_edit_distance: number; min_token_length: number };
}

export const lexicon: Lexicon = JSON.parse(
  Deno.readTextFileSync(new URL("./lexicon.v1.json", import.meta.url)),
) as Lexicon;

/** minusculas, sem acentos, sem pontuacao, espacos colapsados. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return (previous[b.length] ?? max + 1) <= max;
}

/** Casamento tolerante a erro de digitacao, token a token e em ordem. */
export function matches(normalizedText: string, phrase: string): boolean {
  if (normalizedText.includes(phrase)) return true;
  const words = normalizedText.split(" ");
  const target = phrase.split(" ");
  const { max_edit_distance, min_token_length } = lexicon.typo_tolerance;
  for (let start = 0; start + target.length <= words.length; start++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) {
      const word = words[start + k] ?? "";
      const wanted = target[k] ?? "";
      if (word === wanted) continue;
      if (wanted.length >= min_token_length && editDistanceAtMost(word, wanted, max_edit_distance)) continue;
      ok = false;
      break;
    }
    if (ok) return true;
  }
  return false;
}

function firstMatch(text: string, phrases: string[]): string | null {
  for (const phrase of phrases) if (matches(text, phrase)) return phrase;
  return null;
}

function lower(a: Confidence, b: Confidence): Confidence {
  const rank: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return rank[a] <= rank[b] ? a : b;
}

const SUBJECT_HINTS = [
  "meu pai",
  "minha mae",
  "meu avo",
  "minha avo",
  "meu irmao",
  "minha irma",
  "meu marido",
  "minha esposa",
  "meu filho",
  "minha filha",
  "meu tio",
  "minha tia",
];

export function interpret(input: InterpreterInput): Interpretation {
  const text = normalize(input.text);
  const facts: CandidateFact[] = [];
  const secondary: CandidateEvent[] = [];
  const ambiguities: Ambiguity[] = [];

  const correctionMarker = firstMatch(text, lexicon.correction_markers);
  const changeMarker = firstMatch(text, lexicon.change_of_mind_markers);
  const parallelMarker = firstMatch(text, lexicon.parallel_question_markers);
  const complaintMarker = firstMatch(text, lexicon.complaint_markers);
  const newSubjectMarker = firstMatch(text, lexicon.new_subject_markers);
  const uncertaintyMarker = firstMatch(text, lexicon.uncertainty_markers);

  // Fatos candidatos.
  const seen = new Set<string>();
  for (const pattern of lexicon.fact_patterns) {
    const evidence = firstMatch(text, pattern.any);
    if (!evidence) continue;
    if ((pattern.none ?? []).some((p) => matches(text, p))) continue;
    if (seen.has(pattern.fact_code)) continue;
    seen.add(pattern.fact_code);
    // "nao sei" e a propria informacao quando o valor codificado e DESCONHECIDO;
    // nos demais casos a incerteza derruba a confianca.
    const confidence = uncertaintyMarker && pattern.value !== "DESCONHECIDO"
      ? lower(pattern.confidence, "LOW")
      : pattern.confidence;
    facts.push({
      fact_code: pattern.fact_code,
      value: pattern.value,
      source: correctionMarker ? "USER_CORRECTION" : "USER_EXPLICIT",
      confidence,
      evidence,
      requires_confirmation: confidence === "LOW",
    });
  }

  // Alegacoes autoritativas sao reconhecidas de proposito: a guarda as recusa
  // com motivo registrado, em vez de o interpretador fingir que nao viu.
  for (const claim of lexicon.authoritative_claim_patterns) {
    const evidence = firstMatch(text, claim.any);
    if (!evidence || seen.has(claim.fact_code)) continue;
    seen.add(claim.fact_code);
    facts.push({
      fact_code: claim.fact_code,
      value: "PENDENTE",
      source: "USER_EXPLICIT",
      confidence: "HIGH",
      evidence,
      requires_confirmation: true,
    });
  }

  // Objetivo provavel.
  let goal: CandidateGoal | null = null;
  let subjectKind: CaseReference["subject_kind"] = "GENERIC";
  for (const pattern of lexicon.goal_patterns) {
    const evidence = firstMatch(text, pattern.any);
    if (!evidence) continue;
    if (goal === null) {
      goal = { goal_code: pattern.goal_code, confidence: pattern.confidence, evidence };
      subjectKind = pattern.subject_kind as CaseReference["subject_kind"];
    }
  }

  // Pergunta paralela informativa.
  let parallelGoal: CandidateGoal | null = null;
  if (parallelMarker || !goal) {
    for (const topic of lexicon.parallel_topics) {
      const evidence = firstMatch(text, topic.any);
      if (!evidence) continue;
      parallelGoal = { goal_code: topic.goal_code, confidence: topic.confidence, evidence };
      facts.push({
        fact_code: topic.fact_code,
        value: input.text.trim(),
        source: "USER_EXPLICIT",
        confidence: topic.confidence,
        evidence,
        requires_confirmation: false,
      });
      break;
    }
  }

  // Ambiguidades declaradas.
  for (const pattern of lexicon.ambiguity_patterns) {
    const hasAll = pattern.all.every((p) => matches(text, p));
    const hasNone = pattern.none.every((p) => !matches(text, p));
    if (!hasAll || !hasNone) continue;
    // Pronome tem referente claro quando ha um atendimento aberto com sujeito conhecido.
    if (
      pattern.code === "AMB_SUJEITO_INDEFINIDO" && input.context.has_open_goal &&
      input.context.known_subject_hints.length > 0
    ) continue;
    ambiguities.push({
      code: pattern.code,
      description: pattern.description,
      options: pattern.options,
      blocking: pattern.blocking,
    });
  }

  // Referencia de case.
  const subjectHint = SUBJECT_HINTS.find((hint) => matches(text, hint)) ?? null;
  let caseKind: CaseReference["kind"] = input.context.has_open_goal ? "CURRENT" : "NEW";
  let caseConfidence: Confidence = "HIGH";
  if (newSubjectMarker) {
    caseKind = "NEW";
  } else if (subjectHint && input.context.known_subject_hints.length > 0) {
    caseKind = input.context.known_subject_hints.includes(subjectHint) ? "CURRENT" : "NEW";
  } else if (
    input.context.has_open_goal && !subjectHint && ambiguities.some((a) => a.code === "AMB_SUJEITO_INDEFINIDO")
  ) {
    caseKind = "AMBIGUOUS";
    caseConfidence = "LOW";
  }

  // Evento primario.
  let primaryKind: EventKind | null = null;
  let primaryEvidence = "";
  let primaryConfidence: Confidence = "MEDIUM";
  if (complaintMarker) {
    primaryKind = "COMPLAINT";
    primaryEvidence = complaintMarker;
    primaryConfidence = "HIGH";
  } else if (correctionMarker) {
    primaryKind = "CORRECTION";
    primaryEvidence = correctionMarker;
    primaryConfidence = "HIGH";
  } else if (changeMarker) {
    primaryKind = "CHANGE_OF_MIND";
    primaryEvidence = changeMarker;
    primaryConfidence = "HIGH";
  } else if (parallelGoal && input.context.has_open_goal) {
    primaryKind = "PARALLEL_QUESTION";
    primaryEvidence = parallelGoal.evidence;
    primaryConfidence = parallelGoal.confidence;
  } else if (goal && (caseKind === "NEW" || !input.context.has_open_goal)) {
    primaryKind = "NEW_GOAL";
    primaryEvidence = goal.evidence;
    primaryConfidence = goal.confidence;
  } else if (facts.length > 0) {
    const answersPending = input.context.pending_question_fact !== null &&
      facts.some((f) => f.fact_code === input.context.pending_question_fact);
    primaryKind = answersPending ? "ANSWER" : "COMPLEMENT";
    primaryEvidence = facts[0]?.evidence ?? "";
    primaryConfidence = facts[0]?.confidence ?? "MEDIUM";
  } else if (uncertaintyMarker) {
    primaryKind = "UNCERTAIN";
    primaryEvidence = uncertaintyMarker;
    primaryConfidence = "MEDIUM";
  }

  if (goal && primaryKind && primaryKind !== "NEW_GOAL" && caseKind === "NEW") {
    secondary.push({ event_kind: "NEW_GOAL", confidence: goal.confidence, evidence: goal.evidence });
  }

  const confidences: Confidence[] = [
    primaryConfidence,
    ...facts.map((f) => f.confidence),
    ...(goal ? [goal.confidence] : []),
    caseConfidence,
  ];
  let overall: Confidence = "HIGH";
  for (const c of confidences) overall = lower(overall, c);
  if (!primaryKind) overall = "LOW";

  const blocking = ambiguities.some((a) => a.blocking);
  const needsClarification = blocking || overall === "LOW" || primaryKind === null;
  const clarificationReason = blocking
    ? `ambiguidade bloqueadora: ${ambiguities.filter((a) => a.blocking).map((a) => a.code).join(", ")}`
    : primaryKind === null
    ? "nenhum evento conversacional reconhecido"
    : overall === "LOW"
    ? "confianca baixa na interpretacao"
    : null;

  return {
    schema_version: "santana-interpretation/v1",
    message_id: input.message_id,
    text_normalized: text,
    primary_event: primaryKind
      ? { event_kind: primaryKind, confidence: primaryConfidence, evidence: primaryEvidence }
      : null,
    secondary_events: secondary,
    goal: parallelGoal && primaryKind === "PARALLEL_QUESTION" ? parallelGoal : goal,
    case_reference: {
      kind: caseKind,
      subject_kind: subjectKind,
      subject_hint: subjectHint,
      confidence: caseConfidence,
    },
    facts,
    ambiguities,
    overall_confidence: overall,
    needs_clarification: needsClarification,
    clarification_reason: clarificationReason,
    refusals: [],
    produced_by: "deterministic-mock/v1",
  };
}
