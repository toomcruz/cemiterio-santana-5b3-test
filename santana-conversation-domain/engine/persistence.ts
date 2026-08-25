// Ponte entre o reducer canonico (TypeScript) e a persistencia (migration 0020).
// Produz a transicao (lista de operacoes) e a projecao canonica que o banco
// recalcula. Nao contem regra conversacional: apenas diferenca de estado.
//
// Fase 4C / R8 (G11): ciclo de sessão vive em sessao_processo.ts e NÃO gera
// TransitionOp de processo. Fechar sessão não emite ops sobre cases/facts/
// solicitacoes/documentos. Ver docs/fase4/R8-SESSAO-PROCESSO.md.

import type { ConversationState, FactRecord, GoalRecord, QuestionRef } from "./engine.ts";
import { DOCUMENTOS_FUTURE_KEY } from "./sessao_processo.ts";

/** Chaves de objeto de PROCESSO protegidas pela garantia R8 (offline). */
export const R8_PROCESS_OBJECT_KEYS = [
  "cases",
  "facts",
  "solicitacoes",
  DOCUMENTOS_FUTURE_KEY,
] as const;

export interface TransitionOp {
  op: string;
  [key: string]: unknown;
}

export interface IdMap {
  next: Record<string, number>;
  ids: Record<string, string>;
  /** Namespace numerico da conversa: mantem os identificadores unicos entre cenarios. */
  scope: number;
}

export function newIdMap(scope = 0): IdMap {
  return { next: { case: 0, goal: 0, fact: 0, question: 0, action: 0 }, ids: {}, scope };
}

const TAG: Record<string, string> = { case: "1", goal: "2", fact: "3", question: "4", action: "5" };

/** Identificador estavel e deterministico no formato uuid, por conversa. */
export function uuidFor(map: IdMap, kind: keyof typeof TAG | string, key: string): string {
  const full = `${kind}:${key}`;
  const known = map.ids[full];
  if (known) return known;
  const n = (map.next[kind] ?? 0) + 1;
  map.next[kind] = n;
  const tag = TAG[kind] ?? "9";
  const id = `${tag}0000000-0000-4000-8000-${String(map.scope).padStart(4, "0")}${String(n).padStart(8, "0")}`;
  map.ids[full] = id;
  return id;
}

export function questionKey(q: QuestionRef): string {
  return `${q.goal_id}:${q.fact_code}:${q.asked_at_seq}`;
}

function factValue(f: FactRecord): { kind: string; value: string } {
  if (typeof f.value === "boolean") return { kind: "BOOL", value: f.value ? "true" : "false" };
  if (typeof f.value === "number") return { kind: "NUM", value: String(f.value) };
  return { kind: "TEXT", value: String(f.value ?? "") };
}

function canonicalValue(f: FactRecord): string {
  const v = factValue(f);
  if (v.kind === "BOOL") return f.value === true ? "t" : "f";
  return v.value;
}

const dash = (v: unknown): string => (v === null || v === undefined ? "-" : String(v));

/**
 * Projecao canonica em texto, identica a produzida por
 * support_vnext_shadow.conv_state_canonical. E o contrato de comparacao.
 */
export function canonicalState(state: ConversationState, map: IdMap, subject: SubjectResolver): string {
  const lines: string[] = [];
  const caseLines = state.cases.map((c) => {
    const s = subject(c.subject_ref);
    return `C|${uuidFor(map, "case", c.case_id)}|${c.subject_kind}|${s.hmac}|${s.key_version}|OPEN\n`;
  });
  lines.push(...caseLines.sort());

  const goalLines = state.goals.map((g) =>
    `G|${uuidFor(map, "goal", g.goal_id)}|${g.goal_code}|${g.case_id ? uuidFor(map, "case", g.case_id) : "-"}|` +
    `${g.status}|${dash(g.status_reason)}|${g.parent_goal_id ? uuidFor(map, "goal", g.parent_goal_id) : "-"}|` +
    `${g.overlay_of ? uuidFor(map, "goal", g.overlay_of) : "-"}|${g.stack_index}|` +
    `${g.informational ? "t" : "f"}|${g.return_to_parent ? "t" : "f"}|${dash(g.created_by_relation)}|` +
    `${g.opened_at_seq}|${dash(g.closed_at_seq)}\n`
  );
  lines.push(...goalLines.sort());

  const factLines = state.facts.map((f) => {
    const derived = f.derived_from.length > 0
      ? f.derived_from.map((d) => uuidFor(map, "fact", d)).sort().join(",")
      : "-";
    return `F|${uuidFor(map, "fact", f.fact_id)}|${f.fact_code}|${f.case_id ? uuidFor(map, "case", f.case_id) : "-"}|` +
      `${f.goal_id ? uuidFor(map, "goal", f.goal_id) : "-"}|${factValue(f).kind}|${canonicalValue(f)}|` +
      `${f.source}|${f.confidence}|${f.status}|${f.authoritative ? "t" : "f"}|${f.recorded_at_seq}|` +
      `${f.superseded_by ? uuidFor(map, "fact", f.superseded_by) : "-"}|${dash(f.superseded_at_seq)}|` +
      `${dash(f.supersession_reason)}|${f.conflicts_with ? uuidFor(map, "fact", f.conflicts_with) : "-"}|${derived}\n`;
  });
  lines.push(...factLines.sort());

  const q = state.pending_question;
  lines.push(
    q
      ? `Q|${uuidFor(map, "question", questionKey(q))}|${q.question_code}|${q.fact_code}|${
        uuidFor(map, "goal", q.goal_id)
      }|${q.priority_class}|${q.asked_at_seq}\n`
      : "Q|-\n",
  );

  const parked = state.parked_questions.map((p, i) =>
    `P|${String(i + 1).padStart(6, "0")}|${uuidFor(map, "question", questionKey(p))}\n`
  );
  lines.push(...parked.sort());

  const actionLines = state.pending_actions.map((a) =>
    `A|${uuidFor(map, "action", `${a.goal_id}:${a.action_code}:${a.requested_at_seq}`)}|${a.action_code}|` +
    `${a.executor}|${uuidFor(map, "goal", a.goal_id)}|-\n`
  );
  lines.push(...actionLines.sort());

  return lines.join("");
}

export type SubjectResolver = (subject_ref: string) => { hmac: string; key_version: number };

function goalById(state: ConversationState, id: string): GoalRecord | undefined {
  return state.goals.find((g) => g.goal_id === id);
}

/**
 * Diferenca entre dois estados do reducer, na ordem exigida pelas constraints:
 * cases, goals, status de goal, supersessao, confianca, novos fatos, perguntas,
 * acoes. Nenhuma decisao de dominio acontece aqui.
 */
export function diffTransition(
  prev: ConversationState,
  next: ConversationState,
  map: IdMap,
  subject: SubjectResolver,
): TransitionOp[] {
  const ops: TransitionOp[] = [];

  for (const c of next.cases) {
    if (prev.cases.some((p) => p.case_id === c.case_id)) continue;
    const s = subject(c.subject_ref);
    ops.push({
      op: "open_case",
      case_id: uuidFor(map, "case", c.case_id),
      subject_kind: c.subject_kind,
      subject_ref_hmac: s.hmac,
      identity_key_version: s.key_version,
    });
  }

  for (const g of next.goals) {
    if (prev.goals.some((p) => p.goal_id === g.goal_id)) continue;
    ops.push({
      op: "push_goal",
      goal_id: uuidFor(map, "goal", g.goal_id),
      case_id: g.case_id ? uuidFor(map, "case", g.case_id) : null,
      goal_code: g.goal_code,
      status: g.status,
      status_reason: g.status_reason,
      parent_goal_id: g.parent_goal_id ? uuidFor(map, "goal", g.parent_goal_id) : null,
      overlay_of: g.overlay_of ? uuidFor(map, "goal", g.overlay_of) : null,
      stack_index: g.stack_index,
      informational: g.informational,
      return_to_parent: g.return_to_parent,
      created_by_relation: g.created_by_relation,
    });
  }

  for (const g of next.goals) {
    const before = goalById(prev, g.goal_id);
    if (!before) continue;
    if (before.status === g.status && before.status_reason === g.status_reason) continue;
    ops.push({
      op: "set_goal_status",
      goal_id: uuidFor(map, "goal", g.goal_id),
      status: g.status,
      status_reason: g.status_reason,
    });
  }

  for (const f of next.facts) {
    const before = prev.facts.find((p) => p.fact_id === f.fact_id);
    if (!before) continue;
    if (before.status === "ACTIVE" && f.status === "SUPERSEDED") {
      ops.push({
        op: "supersede_fact",
        fact_id: uuidFor(map, "fact", f.fact_id),
        superseded_by: f.superseded_by ? uuidFor(map, "fact", f.superseded_by) : null,
        supersession_reason: f.supersession_reason,
      });
    } else if (before.confidence !== f.confidence || before.conflicts_with !== f.conflicts_with) {
      ops.push({
        op: "set_fact_confidence",
        fact_id: uuidFor(map, "fact", f.fact_id),
        confidence: f.confidence,
        conflicts_with: f.conflicts_with ? uuidFor(map, "fact", f.conflicts_with) : null,
      });
    }
  }

  for (const f of next.facts) {
    if (prev.facts.some((p) => p.fact_id === f.fact_id)) continue;
    const v = factValue(f);
    ops.push({
      op: "record_fact",
      fact_id: uuidFor(map, "fact", f.fact_id),
      case_id: f.case_id ? uuidFor(map, "case", f.case_id) : null,
      goal_id: f.goal_id ? uuidFor(map, "goal", f.goal_id) : null,
      fact_code: f.fact_code,
      value_kind: v.kind,
      value: v.value,
      source: f.source,
      confidence: f.confidence,
      authoritative: f.authoritative,
      conflicts_with: f.conflicts_with ? uuidFor(map, "fact", f.conflicts_with) : null,
      derived_from: f.derived_from.map((d) => uuidFor(map, "fact", d)),
    });
  }

  // Perguntas: a corrente sai antes de outra entrar (unica PENDING por conversa).
  const prevPending = prev.pending_question;
  const nextPending = next.pending_question;
  const prevParked = prev.parked_questions.map(questionKey);
  const nextParked = next.parked_questions.map(questionKey);

  if (prevPending) {
    const key = questionKey(prevPending);
    const stillPending = nextPending && questionKey(nextPending) === key;
    if (!stillPending) {
      const parkedIndex = nextParked.indexOf(key);
      if (parkedIndex >= 0) {
        ops.push({
          op: "park_question",
          question_id: uuidFor(map, "question", key),
          park_order: parkedIndex + 1,
        });
      } else {
        ops.push({ op: "close_question", question_id: uuidFor(map, "question", key), state: "ANSWERED" });
      }
    }
  }

  for (const key of prevParked) {
    if (nextParked.includes(key)) continue;
    if (nextPending && questionKey(nextPending) === key) continue;
    ops.push({ op: "close_question", question_id: uuidFor(map, "question", key), state: "CANCELLED" });
  }

  if (nextPending) {
    const key = questionKey(nextPending);
    const wasPending = prevPending && questionKey(prevPending) === key;
    if (!wasPending) {
      if (prevParked.includes(key)) {
        ops.push({ op: "restore_question", question_id: uuidFor(map, "question", key) });
      } else {
        ops.push({
          op: "set_question",
          question_id: uuidFor(map, "question", key),
          goal_id: uuidFor(map, "goal", nextPending.goal_id),
          question_code: nextPending.question_code,
          fact_code: nextPending.fact_code,
          priority_class: nextPending.priority_class,
        });
      }
    }
  }

  const actionKey = (a: { goal_id: string; action_code: string; requested_at_seq: number }) =>
    `${a.goal_id}:${a.action_code}:${a.requested_at_seq}`;
  for (const a of prev.pending_actions) {
    if (next.pending_actions.some((n) => actionKey(n) === actionKey(a))) continue;
    ops.push({ op: "close_action", action_id: uuidFor(map, "action", actionKey(a)), status: "RESOLVED" });
  }
  for (const a of next.pending_actions) {
    if (prev.pending_actions.some((p) => actionKey(p) === actionKey(a))) continue;
    ops.push({
      op: "open_action",
      action_id: uuidFor(map, "action", actionKey(a)),
      goal_id: uuidFor(map, "goal", a.goal_id),
      action_code: a.action_code,
      executor: a.executor,
    });
  }

  return ops;
}
