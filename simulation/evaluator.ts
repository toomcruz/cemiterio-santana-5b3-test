import { type ConversationState } from "../santana-conversation-domain/engine/engine.ts";
import { validateState } from "../santana-conversation-domain/engine/validate.ts";
import type { LabTurnRecord } from "./store.ts";
import type { Scenario } from "./scenarios.ts";

const INTERNAL = /FOCUS_CASE|binding|reducer|state revision|state_hash|event_kind|harness|shadow|fonte controlada|source control|commit_turn|SUPABASE|schema interno|JAZIGO_FAMILIA|OUTRO_CEMITERIO|COMPRA_DE_JAZIGO|GOAL_[A-Z_]+|Preciso confirmar:/i;

export type Evaluation = {
  FACT_BOUNDARY: "PASS" | "FAIL";
  CONTINUITY: "PASS" | "FAIL";
  CASE_ISOLATION: "PASS" | "FAIL";
  CORRECTION: "PASS" | "FAIL" | "N/A";
  NATURALNESS: "PASS" | "REVIEW";
  REPETITION: number;
  UNNECESSARY_QUESTIONS: number;
  HANDOFF: "PASS" | "FAIL" | "N/A";
  CLOSE_RESUME: "PASS" | "FAIL" | "N/A";
  FOCUS_CASE: "PASS" | "FAIL" | "N/A";
  deterministic_failures: Array<{ turn: number; category: string; response: string; state: unknown; expectation: string; cause: string }>;
  notes: string[];
};

function lower(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase("pt-BR");
}

function stateFacts(state: ConversationState | null) {
  return state?.facts ?? [];
}

function factSemanticallySupported(factCode: string, value: string, evidence: string): boolean {
  const text = lower(evidence);
  if (text.includes(lower(value))) return true;
  const patterns: Record<string, RegExp[]> = {
    transport_destination: [/outro cemit[eé]rio/, /outra cidade/, /outro local/, /jazigo da fam[ií]lia/],
    commercial_item: [/l[aá]pide/, /placa/, /t[uú]mulo/],
    grave_context: [/jazigo da fam[ií]lia/, /jazigo do meu pai/, /jazigo da minha m[aã]e/, /jazigo/],
    topic_code: [/l[aá]pide/, /placa/, /t[uú]mulo/],
    lapide_type: [/l[aá]pide/, /placa/, /t[uú]mulo/],
    deceased_relation: [/meu pai/, /minha m[aã]e/, /meu av[oô]/, /minha av[oó]/, /meu irm[aã]o/],
  };
  return (patterns[factCode] ?? []).some((pattern) => pattern.test(text));
}

export function evaluateScenario(scenario: Scenario, turns: LabTurnRecord[]): Evaluation {
  const failures: Evaluation["deterministic_failures"] = [];
  const answers = turns.map((turn) => String(turn.commit?.reply_body ?? ""));
  const messages = turns.map((turn) => turn.inbound.body);
  const allText = messages.join(" ").toLocaleLowerCase("pt-BR");
  const finalState = turns.at(-1)?.state_after ?? null;
  let factBoundary: Evaluation["FACT_BOUNDARY"] = "PASS";
  let caseIsolation: Evaluation["CASE_ISOLATION"] = "PASS";
  for (const turn of turns) {
    const state = turn.state_after;
    if (!state) continue;
    const errors = validateState(state);
    if (errors.length) failures.push({ turn: turns.indexOf(turn) + 1, category: "STATE_INVALID", response: turn.commit?.reply_body ?? "", state, expectation: "canonical state valid", cause: errors.join("; ") });
    for (const fact of stateFacts(state)) {
      if (fact.status !== "ACTIVE") continue;
      const evidence = String(fact.value ?? "").trim();
      if (evidence && !factSemanticallySupported(fact.fact_code, evidence, allText) && fact.source !== "DERIVED_RULE") {
        factBoundary = "FAIL";
        failures.push({ turn: turns.indexOf(turn) + 1, category: "FACT_BOUNDARY", response: turn.commit?.reply_body ?? "", state, expectation: `${fact.fact_code}.value must be supported by user evidence`, cause: `value=${evidence} is absent from conversation evidence` });
      }
      if (fact.case_id && !state.cases.some((candidate) => candidate.case_id === fact.case_id)) {
        caseIsolation = "FAIL";
        failures.push({ turn: turns.indexOf(turn) + 1, category: "CASE_ISOLATION", response: turn.commit?.reply_body ?? "", state, expectation: "fact.case_id references an existing case", cause: `unknown case ${fact.case_id}` });
      }
    }
    if (INTERNAL.test(answers[turns.indexOf(turn)] ?? "")) {
      failures.push({ turn: turns.indexOf(turn) + 1, category: "INTERNAL_LEAK", response: turn.commit?.reply_body ?? "", state, expectation: "citizen-facing response contains no internal implementation terms", cause: "response contains internal vocabulary" });
    }
  }
  const repeated = answers.filter((text, index) => index > 0 && text && text === answers[index - 1]).length;
  const questionCodes = turns.map((turn) => turn.state_after?.pending_question?.question_code ?? null).filter(Boolean);
  const repeatedQuestions = answers.filter((text, index) =>
    index > 0 && text && text === answers[index - 1] && questionCodes[index] === questionCodes[index - 1]
  ).length;
  const handoffClaim = answers.some((text) => /(?:encaminhei|foi encaminhad[oa]|registrei seu pedido de encaminhamento|as respostas autom[aá]ticas ficam pausadas)/i.test(text));
  const hasReceipt = turns.some((turn) => turn.commit?.state.handoff !== null);
  const handoff = scenario.tags.includes("handoff") ? (handoffClaim === hasReceipt ? "PASS" : "FAIL") : "N/A";
  if (handoff === "FAIL") failures.push({ turn: 1, category: "HANDOFF", response: answers.join("\n"), state: finalState, expectation: "handoff claims match committed handoff receipt", cause: `claim=${handoffClaim} receipt=${hasReceipt}` });
  const lifecycleNotes = turns.flatMap((turn) => (turn.state_after?.event_log ?? []).map((event) => event.note));
  const closeResume = scenario.tags.includes("close")
    ? (lifecycleNotes.includes("CLOSE") && (scenario.tags.includes("resume") ? lifecycleNotes.includes("RESUME_CASE") : true) ? "PASS" : "FAIL")
    : "N/A";
  if (closeResume === "FAIL") failures.push({ turn: turns.length, category: "CLOSE_RESUME", response: answers.at(-1) ?? "", state: finalState, expectation: "close/resume transitions are explicit", cause: "expected lifecycle event absent" });
  const focusCase = scenario.tags.includes("focus")
    ? (lifecycleNotes.includes("FOCUS_CASE") ? "PASS" : "FAIL")
    : "N/A";
  if (focusCase === "FAIL") failures.push({ turn: turns.length, category: "FOCUS_CASE", response: answers.at(-1) ?? "", state: finalState, expectation: "return to an existing case changes focus without copying facts", cause: "FOCUS_CASE transition absent" });
  const correction = scenario.tags.includes("correction")
    ? (finalState?.facts.some((fact) => fact.status === "SUPERSEDED") ||
        turns.some((turn) => ["CORRECTION", "CHANGE_OF_MIND"].includes(turn.commit?.event_kind ?? "")) ||
        /corrig|desconsider|errei/i.test(allText) ? "PASS" : "FAIL")
    : "N/A";
  if (correction === "FAIL") failures.push({ turn: turns.length, category: "CORRECTION", response: answers.at(-1) ?? "", state: finalState, expectation: "correction is represented by a correction/change event or superseded fact", cause: "correction marker did not produce a correction event or superseded fact" });
  const continuity = failures.some((failure) => ["FACT_BOUNDARY", "CASE_ISOLATION", "CLOSE_RESUME", "FOCUS_CASE"].includes(failure.category)) ? "FAIL" : "PASS";
  const naturalness: Evaluation["NATURALNESS"] = answers.some((text) => text.length > 420 || /não há certeza|fonte controlada|procure a equipe competente/i.test(text)) ? "REVIEW" : "PASS";
  return {
    FACT_BOUNDARY: factBoundary,
    CONTINUITY: continuity,
    CASE_ISOLATION: caseIsolation,
    CORRECTION: correction,
    NATURALNESS: naturalness,
    REPETITION: repeated + repeatedQuestions,
    UNNECESSARY_QUESTIONS: Math.max(0, repeatedQuestions),
    HANDOFF: handoff,
    CLOSE_RESUME: closeResume,
    FOCUS_CASE: focusCase,
    deterministic_failures: failures,
    notes: [
      "Evaluator is independent from the runtime reducer.",
      "Human-facing draft is the official deterministic reply renderer in the frozen runtime; no separate Gemini draft stage exists in this source cut.",
      "Lifecycle transition notes are emitted by the official SOCIAL reducer event: CLOSE and RESUME_CASE; event_kind remains SOCIAL for catalog compatibility.",
    ],
  };
}
