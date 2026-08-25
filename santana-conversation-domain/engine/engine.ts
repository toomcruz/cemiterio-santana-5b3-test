// Motor de referencia determinista do Santana Conversation Domain v1.
// Sem IA, sem rede, sem banco: apenas catalogo + reducao de eventos.
// Fase 5B.4-A. Nenhuma integracao com producao, n8n, WhatsApp ou LLM.

import {
  AUTHORITATIVE_SOURCES,
  authoritativeResolution,
  Condition,
  Confidence,
  CONFLICT_QUESTION_CODE,
  EventKind,
  factDef,
  FactSource,
  FactValue,
  goalDef,
  GoalStatus,
  PRIORITY_RANK,
  PriorityClass,
  questionForFact,
  RelationEffect,
  relationsDoc,
  requiresAuthoritativeSignal,
} from "./catalog.ts";
import type { SolicitacaoRecord } from "./solicitacao.ts";

export interface CaseRecord {
  case_id: string;
  subject_kind: string;
  subject_ref: string;
  opened_at_seq: number;
}

export interface GoalRecord {
  goal_id: string;
  goal_code: string;
  case_id: string | null;
  status: GoalStatus;
  status_reason: string | null;
  parent_goal_id: string | null;
  overlay_of: string | null;
  stack_index: number;
  informational: boolean;
  return_to_parent: boolean;
  opened_at_seq: number;
  closed_at_seq: number | null;
  created_by_relation: string | null;
}

export interface FactRecord {
  fact_id: string;
  fact_code: string;
  case_id: string | null;
  goal_id: string | null;
  value: FactValue;
  source: FactSource;
  confidence: Confidence;
  status: "ACTIVE" | "SUPERSEDED";
  recorded_at_seq: number;
  superseded_by: string | null;
  superseded_at_seq: number | null;
  supersession_reason: string | null;
  conflicts_with: string | null;
  authoritative: boolean;
  derived_from: string[];
}

export interface QuestionRef {
  question_code: string;
  fact_code: string;
  goal_id: string;
  priority_class: PriorityClass;
  asked_at_seq: number;
}

export interface PendingAction {
  action_code: string;
  executor: "SYSTEM" | "HUMAN" | "SYSTEM_OR_HUMAN";
  goal_id: string;
  requested_at_seq: number;
}

export interface HandoffModel {
  requested_at_seq: number;
  goal_code: string | null;
  goal_status: string | null;
  case_id: string | null;
  current_step: string;
  confirmed_facts: { fact_code: string; value: FactValue; source: string; confidence: string }[];
  pending_facts: string[];
  current_question: string | null;
  essential_context: {
    goal_stack: string[];
    open_overlays: string[];
    pending_actions: string[];
  };
}

export interface ConversationState {
  schema_version: "santana-conversation-state/v1";
  conversation_id: string;
  seq: number;
  cases: CaseRecord[];
  goals: GoalRecord[];
  facts: FactRecord[];
  pending_question: QuestionRef | null;
  parked_questions: QuestionRef[];
  pending_actions: PendingAction[];
  forbidden_goals: string[];
  handoff: HandoffModel | null;
  event_log: { seq: number; event_kind: EventKind; note?: string | null }[];
  /** Fase 4B / R7 — aditivo; ciclo por categoria, sem status global. */
  solicitacoes?: SolicitacaoRecord[];
  /**
   * Fase 4C / R8 — vínculo unidirecional processo → sessão.
   * Metadado de referência; NÃO faz parte dos objetos de processo hasheados.
   * Fechar a sessão não limpa cases/facts/solicitacoes/documentos.
   */
  last_touched_session_id?: string | null;
}

export interface FactInput {
  code: string;
  value: FactValue;
  source?: FactSource;
  confidence?: Confidence;
  // Sinal autoritativo externo (Administracao/documento). Nunca pode acompanhar
  // uma origem de usuario, extracao de LLM ou inferencia.
  authoritative?: boolean;
}

export interface ConversationEvent {
  kind: EventKind;
  goal_code?: string;
  case_ref?: string;
  facts?: FactInput[];
  target_fact?: string;
  abandon_current?: boolean;
  base_goal_code?: string;
  note?: string;
}

const OPEN_STATUSES: GoalStatus[] = ["ACTIVE", "SUSPENDED", "WAITING"];

export function initState(conversation_id: string): ConversationState {
  return {
    schema_version: "santana-conversation-state/v1",
    conversation_id,
    seq: 0,
    cases: [],
    goals: [],
    facts: [],
    pending_question: null,
    parked_questions: [],
    pending_actions: [],
    forbidden_goals: [],
    handoff: null,
    event_log: [],
    solicitacoes: [],
  };
}

function clone(state: ConversationState): ConversationState {
  return JSON.parse(JSON.stringify(state)) as ConversationState;
}

function scopeKey(code: string, goal: GoalRecord | null): string {
  const def = factDef(code);
  if (def.scope === "CONVERSATION") return `conv:${code}`;
  if (def.scope === "GOAL") return `goal:${goal ? goal.goal_id : "none"}:${code}`;
  const caseId = goal ? goal.case_id : null;
  return `case:${caseId ?? "none"}:${code}`;
}

function factScopeKey(fact: FactRecord): string {
  const def = factDef(fact.fact_code);
  if (def.scope === "CONVERSATION") return `conv:${fact.fact_code}`;
  if (def.scope === "GOAL") return `goal:${fact.goal_id ?? "none"}:${fact.fact_code}`;
  return `case:${fact.case_id ?? "none"}:${fact.fact_code}`;
}

export function activeFacts(state: ConversationState, code: string, goal: GoalRecord | null): FactRecord[] {
  const key = scopeKey(code, goal);
  return state.facts
    .filter((f) => f.status === "ACTIVE" && f.fact_code === code && factScopeKey(f) === key)
    .sort((a, b) => a.recorded_at_seq - b.recorded_at_seq);
}

export function activeFact(state: ConversationState, code: string, goal: GoalRecord | null): FactRecord | null {
  return activeFacts(state, code, goal)[0] ?? null;
}

function conditionsHold(
  state: ConversationState,
  conditions: Condition[] | undefined,
  goal: GoalRecord | null,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    const fact = activeFact(state, c.fact, goal);
    if (!fact) return false;
    if (c.equals !== undefined) return fact.value === c.equals;
    if (c.in !== undefined) return c.in.includes(fact.value);
    return true;
  });
}

export function isRelevant(state: ConversationState, code: string, goal: GoalRecord | null): boolean {
  const def = factDef(code);
  return conditionsHold(state, def.relevant_when, goal);
}

function goalById(state: ConversationState, id: string | null): GoalRecord | null {
  if (!id) return null;
  return state.goals.find((g) => g.goal_id === id) ?? null;
}

export function focusGoal(state: ConversationState): GoalRecord | null {
  const active = state.goals.filter((g) => g.status === "ACTIVE");
  if (active.length === 0) return null;
  return active.reduce((a, b) => (b.stack_index > a.stack_index ? b : a));
}

function nextId(prefix: string, count: number): string {
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

function supersede(state: ConversationState, fact: FactRecord, reason: string, replacementId: string | null): void {
  fact.status = "SUPERSEDED";
  fact.supersession_reason = reason;
  fact.superseded_at_seq = state.seq;
  fact.superseded_by = replacementId;
  // Toda conclusao derivada do fato antigo perde validade.
  for (const f of state.facts) {
    if (f.status !== "ACTIVE") continue;
    if (f.derived_from.includes(fact.fact_id)) {
      supersede(state, f, "DEPENDENCY_INVALIDATED", null);
    }
  }
  // Fatos que dependem do codigo alterado sao recalculados (invalidados).
  for (const f of state.facts) {
    if (f.status !== "ACTIVE") continue;
    const def = factDef(f.fact_code);
    if ((def.depends_on ?? []).includes(fact.fact_code)) {
      supersede(state, f, "DEPENDENCY_INVALIDATED", null);
    }
  }
}

function recordFact(
  state: ConversationState,
  goal: GoalRecord | null,
  input: FactInput,
  mode: "ASSERT" | "SUPERSEDE" | "DERIVE",
  derivedFrom: string[] = [],
): FactRecord | null {
  const def = factDef(input.code);
  const source = input.source ?? (mode === "DERIVE" ? "DERIVED_RULE" : "USER_EXPLICIT");
  if (!def.allowed_sources.includes(source)) {
    throw new Error(`origem ${source} nao permitida para o fato ${input.code}`);
  }
  if (def.allowed_values && typeof input.value === "string" && !def.allowed_values.includes(input.value)) {
    throw new Error(`valor ${input.value} fora do dominio de ${input.code}`);
  }
  if (input.authoritative && !AUTHORITATIVE_SOURCES.includes(source)) {
    throw new Error(`sinal autoritativo exige origem ${AUTHORITATIVE_SOURCES.join("/")}, recebido ${source}`);
  }
  const authoritative = input.authoritative === true;
  // Declaracao do usuario, extracao de LLM ou inferencia nunca confirmam um fato
  // autoritativo: ficam registradas como alegacao UNCERTAIN.
  const needsSignal = requiresAuthoritativeSignal(input.code, input.value) && source !== "DERIVED_RULE";
  const effectiveConfidence: Confidence = needsSignal && !authoritative
    ? "UNCERTAIN"
    : (input.confidence ?? "CONFIRMED");

  const existing = activeFacts(state, input.code, goal);
  const incumbent = existing[0] ?? null;
  const sameValue = existing.find((f) => f.value === input.value) ?? null;

  // Uma alegacao nao autoritativa nunca e "promovida" no lugar: o sinal externo
  // cria um fato novo e supera a alegacao, preservando o historico. (5B.4-B.2)
  if (sameValue && authoritative && !sameValue.authoritative) {
    supersede(state, sameValue, "SYSTEM_REPLACEMENT", null);
  } else if (sameValue) {
    // O valor informado ja existe: ele passa a ser o unico ativo e qualquer
    // valor concorrente e superado com historico.
    const reason = source === "USER_CORRECTION"
      ? "USER_CORRECTION"
      : mode === "DERIVE"
      ? "SYSTEM_REPLACEMENT"
      : "CHANGE_OF_MIND";
    for (const other of existing) {
      if (other === sameValue) continue;
      supersede(state, other, reason, sameValue.fact_id);
    }
    if (effectiveConfidence !== "UNCERTAIN" || sameValue.confidence !== "CONFIRMED") {
      sameValue.confidence = effectiveConfidence;
    }
    sameValue.authoritative = sameValue.authoritative || authoritative;
    sameValue.conflicts_with = null;
    // A origem registra quem afirmou o valor primeiro: confirmar nao reescreve
    // a proveniencia (e a persistencia trata origem como imutavel).
    return sameValue;
  }

  const fact: FactRecord = {
    fact_id: nextId("f", state.facts.length),
    fact_code: input.code,
    case_id: def.scope === "CASE" ? (goal ? goal.case_id : null) : null,
    goal_id: def.scope === "GOAL" ? (goal ? goal.goal_id : null) : null,
    value: input.value,
    source,
    confidence: effectiveConfidence,
    status: "ACTIVE",
    recorded_at_seq: state.seq,
    superseded_by: null,
    superseded_at_seq: null,
    supersession_reason: null,
    conflicts_with: null,
    authoritative,
    derived_from: derivedFrom,
  };

  if (incumbent) {
    if (mode === "SUPERSEDE" || mode === "DERIVE") {
      const reason = mode === "DERIVE"
        ? "SYSTEM_REPLACEMENT"
        : source === "USER_CORRECTION"
        ? "USER_CORRECTION"
        : "CHANGE_OF_MIND";
      for (const other of existing) supersede(state, other, reason, fact.fact_id);
    } else if (incumbent.confidence === "CONFIRMED") {
      // Contradicao: nenhum valor e descartado automaticamente.
      incumbent.confidence = "CONFLICTING";
      incumbent.conflicts_with = fact.fact_id;
      fact.confidence = "CONFLICTING";
      fact.conflicts_with = incumbent.fact_id;
    } else {
      supersede(state, incumbent, "SYSTEM_REPLACEMENT", fact.fact_id);
    }
  }

  state.facts.push(fact);
  return fact;
}

function factIdsFor(state: ConversationState, codes: string[] | undefined, goal: GoalRecord | null): string[] {
  if (!codes) return [];
  const ids: string[] = [];
  for (const code of codes) {
    const f = activeFact(state, code, goal);
    if (f) ids.push(f.fact_id);
  }
  return ids;
}

function pushGoal(
  state: ConversationState,
  goal_code: string,
  opts: {
    parent?: GoalRecord | null;
    suspend_parent?: boolean;
    return_to_parent?: boolean;
    created_by_relation?: string | null;
    overlay_of?: string | null;
    case_ref?: string;
    reuse_case_id?: string | null;
  } = {},
): GoalRecord {
  const def = goalDef(goal_code);
  if (state.forbidden_goals.includes(goal_code)) {
    throw new Error(`goal ${goal_code} esta proibido pelo estado atual`);
  }
  let case_id: string | null = opts.reuse_case_id ?? null;
  // Subfluxo aberto por relacao permanece no case do objetivo pai: nunca se
  // cria um segundo case para o mesmo falecido/jazigo/pedido.
  if (def.creates_case && !opts.reuse_case_id) {
    const subjectRef = opts.case_ref ?? `${goal_code}:${state.seq}`;
    const existing = state.cases.find((c) => c.subject_ref === subjectRef);
    if (existing) {
      case_id = existing.case_id;
    } else {
      const created: CaseRecord = {
        case_id: nextId("case", state.cases.length),
        subject_kind: def.case_subject ?? "GENERIC",
        subject_ref: subjectRef,
        opened_at_seq: state.seq,
      };
      state.cases.push(created);
      case_id = created.case_id;
    }
  } else if (!case_id) {
    const parent = opts.parent ?? null;
    case_id = parent ? parent.case_id : null;
  }

  const parent = opts.parent ?? null;
  if (parent && opts.suspend_parent) {
    parent.status = "SUSPENDED";
    parent.status_reason = `SUBFLOW:${goal_code}`;
  }
  const goal: GoalRecord = {
    goal_id: nextId("g", state.goals.length),
    goal_code,
    case_id,
    status: "ACTIVE",
    status_reason: null,
    parent_goal_id: parent ? parent.goal_id : null,
    overlay_of: opts.overlay_of ?? null,
    stack_index: state.goals.length,
    informational: def.informational === true,
    return_to_parent: opts.return_to_parent === true,
    opened_at_seq: state.seq,
    closed_at_seq: null,
    created_by_relation: opts.created_by_relation ?? null,
  };
  state.goals.push(goal);
  return goal;
}

function applyEffects(
  state: ConversationState,
  goal: GoalRecord,
  effects: RelationEffect[],
  relationCode: string,
): boolean {
  let changed = false;
  for (const effect of effects) {
    switch (effect.op) {
      case "assert_derived_fact": {
        if (!effect.fact_code) break;
        const before = activeFact(state, effect.fact_code, goal);
        if (before && before.value === effect.value) break;
        recordFact(
          state,
          goal,
          { code: effect.fact_code, value: effect.value ?? null, source: "DERIVED_RULE" },
          "DERIVE",
          factIdsFor(state, effect.from, goal),
        );
        changed = true;
        break;
      }
      case "record_fact": {
        if (!effect.fact_code) break;
        const before = activeFact(state, effect.fact_code, goal);
        if (before && before.value === effect.value) break;
        recordFact(
          state,
          goal,
          {
            code: effect.fact_code,
            value: effect.value ?? null,
            source: effect.source ?? "SYSTEM",
            authoritative: effect.authoritative === true,
          },
          "DERIVE",
        );
        changed = true;
        break;
      }
      case "push_goal": {
        const code = effect.goal_code;
        if (!code) break;
        if (state.forbidden_goals.includes(code)) break;
        // So e reaberto o subfluxo que foi fechado por a dependencia ter deixado
        // de existir; abandono pelo usuario e conclusao continuam bloqueando.
        const recalculable = ["DEPENDENCY_SATISFIED", "DEPENDENCY_REMOVED"];
        const already = state.goals.some((g) =>
          g.goal_code === code &&
          g.created_by_relation === relationCode &&
          g.case_id === goal.case_id &&
          !(g.status === "ABANDONED" && recalculable.includes(g.status_reason ?? ""))
        );
        if (already) break;
        pushGoal(state, code, {
          parent: goal,
          suspend_parent: effect.suspend_parent,
          return_to_parent: effect.return_to_parent,
          created_by_relation: relationCode,
          reuse_case_id: goal.case_id,
        });
        changed = true;
        break;
      }
      case "set_goal_status": {
        const status = effect.status;
        if (!status || goal.status === status) break;
        if (goal.status === "RESOLVED" || goal.status === "ABANDONED") break;
        goal.status = status;
        goal.status_reason = effect.reason ?? relationCode;
        changed = true;
        break;
      }
      case "require_action": {
        const code = effect.action_code;
        if (!code) break;
        if (state.pending_actions.some((a) => a.action_code === code && a.goal_id === goal.goal_id)) break;
        state.pending_actions.push({
          action_code: code,
          executor: effect.executor ?? "SYSTEM_OR_HUMAN",
          goal_id: goal.goal_id,
          requested_at_seq: state.seq,
        });
        changed = true;
        break;
      }
      case "satisfy_dependency": {
        // Escopo do case: a dependencia fica satisfeita/inaplicavel enquanto o fato
        // que a dispensa estiver ativo. Nao existe proibicao global nem permanente.
        const code = effect.goal_code;
        if (!code) break;
        for (const g of state.goals) {
          if (g.goal_code !== code) continue;
          if (g.case_id !== goal.case_id) continue;
          if (!OPEN_STATUSES.includes(g.status)) continue;
          g.status = "ABANDONED";
          g.status_reason = effect.reason ?? "DEPENDENCY_SATISFIED";
          g.closed_at_seq = state.seq;
          const parent = goalById(state, g.parent_goal_id);
          if (parent && parent.status === "SUSPENDED" && g.return_to_parent) {
            parent.status = "ACTIVE";
            parent.status_reason = null;
          }
          changed = true;
        }
        break;
      }
      case "require_facts_in_current_goal":
        // Escopo declarativo: a relevancia dos fatos ja e resolvida por relevant_when.
        // Nenhum goal ou case novo pode ser criado por esta relacao.
        break;
      default:
        throw new Error(`efeito desconhecido: ${effect.op}`);
    }
  }
  return changed;
}

function evaluateRelations(state: ConversationState): void {
  for (let i = 0; i < 12; i++) {
    let changed = false;
    for (const relation of relationsDoc.relations) {
      const when = relation.when;
      if (!when) continue;
      const targets = state.goals.filter((g) =>
        g.goal_code === when.goal_code && when.goal_status_in.includes(g.status)
      );
      for (const goal of targets) {
        if (!conditionsHold(state, when.conditions, goal)) continue;
        if (applyEffects(state, goal, relation.effects ?? [], relation.relation_code)) changed = true;
      }
    }
    if (resolveCompletedGoals(state)) changed = true;
    if (!changed) return;
  }
  throw new Error("avaliacao de relacoes nao convergiu");
}

export interface MissingFact {
  code: string;
  priority: PriorityClass;
  conflicting: boolean;
  authoritative: boolean;
}

export function missingFacts(state: ConversationState, goal: GoalRecord): MissingFact[] {
  const def = goalDef(goal.goal_code);
  const out: MissingFact[] = [];
  for (const code of def.required_facts) {
    if (!isRelevant(state, code, goal)) continue;
    const facts = activeFacts(state, code, goal);
    const primary = facts[0];
    const factSpec = factDef(code);
    if (!primary) {
      out.push({
        code,
        priority: factSpec.priority_class,
        conflicting: false,
        authoritative: factSpec.authoritative_only === true,
      });
      continue;
    }
    if (primary.confidence !== "CONFIRMED") {
      out.push({
        code,
        priority: "BLOCKING_UNCERTAINTY",
        conflicting: primary.confidence === "CONFLICTING",
        authoritative: primary.confidence === "UNCERTAIN" && requiresAuthoritativeSignal(code, primary.value),
      });
      continue;
    }
    // Valor que, mesmo confirmado pelo usuario, nao permite continuar: exige
    // verificacao pela Administracao (ex.: recadastro DESCONHECIDO).
    if ((factSpec.blocking_values ?? []).includes(primary.value)) {
      out.push({ code, priority: "BLOCKING_UNCERTAINTY", conflicting: false, authoritative: true });
    }
  }
  return out;
}

function resolveCompletedGoals(state: ConversationState): boolean {
  let changed = false;
  for (const goal of [...state.goals].sort((a, b) => b.stack_index - a.stack_index)) {
    if (goal.status !== "ACTIVE") continue;
    if (missingFacts(state, goal).length > 0) continue;
    goal.status = "RESOLVED";
    goal.closed_at_seq = state.seq;
    changed = true;
    const parent = goalById(state, goal.parent_goal_id);
    if (goal.created_by_relation) {
      const relation = relationsDoc.relations.find((r) => r.relation_code === goal.created_by_relation);
      if (relation?.on_child_resolved && parent) {
        applyEffects(state, parent, relation.on_child_resolved, relation.relation_code);
      }
    }
    if (parent && goal.return_to_parent && parent.status === "SUSPENDED") {
      parent.status = "ACTIVE";
      parent.status_reason = null;
    }
  }
  return changed;
}

export function bestMissingFact(state: ConversationState, goal: GoalRecord): MissingFact | null {
  const missing = missingFacts(state, goal);
  if (missing.length === 0) return null;
  let best = missing.find((m) => m.conflicting) ?? missing[0];
  if (!best) return null;
  if (!best.conflicting) {
    for (const candidate of missing) {
      if (PRIORITY_RANK[candidate.priority] < PRIORITY_RANK[best.priority]) best = candidate;
    }
  }
  return best;
}

export function nextBestQuestion(state: ConversationState): QuestionRef | null {
  const goal = focusGoal(state);
  if (!goal) return null;
  const missing = missingFacts(state, goal).filter((m) => !m.authoritative);
  if (missing.length === 0) return null;
  // Conflito de fato precede a escolha por classe: uma contradicao invalida a
  // decisao que ja estava sendo tomada.
  let best = missing.find((m) => m.conflicting) ?? missing[0];
  if (!best) return null;
  if (!best.conflicting) {
    for (const candidate of missing) {
      if (PRIORITY_RANK[candidate.priority] < PRIORITY_RANK[best.priority]) best = candidate;
    }
  }
  return {
    question_code: best.conflicting ? CONFLICT_QUESTION_CODE : questionForFact(best.code).question_code,
    fact_code: best.code,
    goal_id: goal.goal_id,
    priority_class: best.priority,
    asked_at_seq: state.seq,
  };
}

// Lacuna autoritativa: o objetivo fica WAITING com uma acao pendente para a
// Administracao, e nenhuma pergunta e feita ao usuario sobre esse fato.
function syncAuthoritativeGaps(state: ConversationState): void {
  for (const goal of state.goals) {
    if (goal.status !== "ACTIVE" && goal.status !== "WAITING") continue;
    const gap = bestMissingFact(state, goal);
    const blocking = gap && gap.authoritative ? authoritativeResolution(gap.code) : null;
    if (blocking) {
      goal.status = "WAITING";
      goal.status_reason = `AWAITING:${blocking.action_code}`;
      // Uma lacuna resolvida deixa de gerar acao: so a lacuna corrente fica pendente.
      state.pending_actions = state.pending_actions.filter(
        (a) => a.goal_id !== goal.goal_id || a.action_code === blocking.action_code,
      );
      if (!state.pending_actions.some((a) => a.action_code === blocking.action_code && a.goal_id === goal.goal_id)) {
        state.pending_actions.push({
          action_code: blocking.action_code,
          executor: blocking.executor,
          goal_id: goal.goal_id,
          requested_at_seq: state.seq,
        });
      }
      if (state.pending_question && state.pending_question.goal_id === goal.goal_id) {
        state.parked_questions.push(state.pending_question);
        state.pending_question = null;
      }
    } else if (goal.status === "WAITING") {
      goal.status = "ACTIVE";
      goal.status_reason = null;
      state.pending_actions = state.pending_actions.filter((a) => a.goal_id !== goal.goal_id);
    }
  }
}

function questionStillValid(state: ConversationState, q: QuestionRef): boolean {
  const goal = goalById(state, q.goal_id);
  if (!goal || goal.status !== "ACTIVE") return false;
  return missingFacts(state, goal).some((m) => m.code === q.fact_code);
}

function refreshPendingQuestion(state: ConversationState): void {
  if (state.pending_question && !questionStillValid(state, state.pending_question)) {
    state.pending_question = null;
  }
  const candidate = nextBestQuestion(state);
  const pending = state.pending_question;
  if (pending && candidate) {
    const focusChanged = candidate.goal_id !== pending.goal_id;
    const conflictTakesOver = candidate.question_code === CONFLICT_QUESTION_CODE &&
      pending.question_code !== CONFLICT_QUESTION_CODE;
    if (focusChanged || conflictTakesOver) {
      // A pergunta anterior nao e destruida: fica estacionada para retomada.
      state.parked_questions.push(pending);
      state.pending_question = candidate;
    }
  }
  if (!state.pending_question) {
    while (state.parked_questions.length > 0) {
      const parked = state.parked_questions.pop();
      if (parked && questionStillValid(state, parked)) {
        state.pending_question = parked;
        return;
      }
    }
    state.pending_question = nextBestQuestion(state);
  }
}

export function buildHandoff(state: ConversationState): HandoffModel {
  const goal = focusGoal(state) ?? state.goals.filter((g) => OPEN_STATUSES.includes(g.status)).at(-1) ?? null;
  const confirmed = state.facts
    .filter((f) => f.status === "ACTIVE" && (!goal || !f.case_id || f.case_id === goal.case_id))
    .map((f) => ({ fact_code: f.fact_code, value: f.value, source: f.source, confidence: f.confidence }));
  return {
    requested_at_seq: state.seq,
    goal_code: goal ? goal.goal_code : null,
    goal_status: goal ? goal.status : null,
    case_id: goal ? goal.case_id : null,
    current_step: goal ? `${goal.goal_code}:${goal.status}` : "SEM_OBJETIVO_ABERTO",
    confirmed_facts: confirmed,
    pending_facts: goal ? missingFacts(state, goal).map((m) => m.code) : [],
    current_question: state.pending_question ? state.pending_question.question_code : null,
    essential_context: {
      goal_stack: state.goals.filter((g) => OPEN_STATUSES.includes(g.status)).map((g) => `${g.goal_code}:${g.status}`),
      open_overlays: state.goals.filter((g) => g.overlay_of !== null && OPEN_STATUSES.includes(g.status)).map((g) =>
        g.goal_code
      ),
      pending_actions: state.pending_actions.map((a) => a.action_code),
    },
  };
}

export function applyEvent(previous: ConversationState, event: ConversationEvent): ConversationState {
  const state = clone(previous);
  state.seq += 1;
  state.event_log.push({ seq: state.seq, event_kind: event.kind, note: event.note ?? null });

  const goal = focusGoal(state);

  switch (event.kind) {
    case "SOCIAL":
      return state;

    case "HUMAN_REQUEST": {
      state.handoff = buildHandoff(state);
      return state;
    }

    case "NEW_GOAL": {
      if (!event.goal_code) throw new Error("NEW_GOAL exige goal_code");
      if (event.abandon_current && goal) {
        goal.status = "ABANDONED";
        goal.status_reason = "USER_ABANDONED";
        goal.closed_at_seq = state.seq;
        const parent = goalById(state, goal.parent_goal_id);
        if (parent && parent.status === "SUSPENDED") {
          parent.status_reason = "BLOCKED_BY_ABANDONED_SUBFLOW";
        }
      }
      const created = pushGoal(state, event.goal_code, { case_ref: event.case_ref });
      for (const f of event.facts ?? []) recordFact(state, created, f, "ASSERT");
      break;
    }

    case "COMPLAINT": {
      let base = goal;
      if (!base && event.base_goal_code) {
        base = pushGoal(state, event.base_goal_code, { case_ref: event.case_ref });
      }
      if (!base) throw new Error("COMPLAINT exige um assunto-base");
      // Overlay transversal: o goal-base permanece ACTIVE e nao e substituido.
      const overlay = pushGoal(state, "GOAL_RECLAMACAO", {
        parent: base,
        suspend_parent: false,
        return_to_parent: false,
        overlay_of: base.goal_id,
        reuse_case_id: base.case_id,
      });
      for (const f of event.facts ?? []) recordFact(state, overlay, f, "ASSERT");
      break;
    }

    case "PARALLEL_QUESTION": {
      if (!event.goal_code) throw new Error("PARALLEL_QUESTION exige goal_code informativo");
      if (state.pending_question) {
        state.parked_questions.push(state.pending_question);
        state.pending_question = null;
      }
      const info = pushGoal(state, event.goal_code, {
        parent: goal,
        suspend_parent: false,
        return_to_parent: false,
        reuse_case_id: goal ? goal.case_id : null,
      });
      for (const f of event.facts ?? []) recordFact(state, info, f, "ASSERT");
      break;
    }

    case "CORRECTION":
    case "CHANGE_OF_MIND": {
      const source: FactSource = event.kind === "CORRECTION" ? "USER_CORRECTION" : "USER_EXPLICIT";
      for (const f of event.facts ?? []) {
        const owner = ownerGoalForFact(state, f.code, goal);
        recordFact(state, owner, { ...f, source: f.source ?? source }, "SUPERSEDE");
      }
      break;
    }

    case "UNCERTAIN": {
      for (const f of event.facts ?? []) {
        const owner = ownerGoalForFact(state, f.code, goal);
        recordFact(state, owner, { ...f, confidence: f.confidence ?? "UNCERTAIN" }, "ASSERT");
      }
      break;
    }

    case "ANSWER":
    case "COMPLEMENT": {
      for (const f of event.facts ?? []) {
        const owner = ownerGoalForFact(state, f.code, goal);
        recordFact(state, owner, f, "ASSERT");
      }
      break;
    }
  }

  evaluateRelations(state);
  syncAuthoritativeGaps(state);
  refreshPendingQuestion(state);
  return state;
}

export interface AuthoritativeSignal {
  facts: FactInput[];
  note?: string;
}

// Entrada autoritativa da Administracao (ou documento). Nao e um evento
// conversacional: e o unico caminho capaz de CONFIRMAR um fato autoritativo.
export function applyAuthoritativeSignal(
  previous: ConversationState,
  signal: AuthoritativeSignal,
): ConversationState {
  const state = clone(previous);
  state.seq += 1;
  for (const f of signal.facts) {
    const owner = ownerGoalForFact(state, f.code, null);
    recordFact(state, owner, { ...f, source: f.source ?? "SYSTEM", authoritative: true }, "SUPERSEDE");
  }
  evaluateRelations(state);
  syncAuthoritativeGaps(state);
  refreshPendingQuestion(state);
  return state;
}

// Um fato pertence ao goal aberto que o declara como necessario; nunca e movido
// entre cases, mesmo quando o codigo do fato e o mesmo.
function ownerGoalForFact(state: ConversationState, code: string, focus: GoalRecord | null): GoalRecord | null {
  if (focus && goalDef(focus.goal_code).required_facts.includes(code)) return focus;
  const open = state.goals.filter((g) => OPEN_STATUSES.includes(g.status)).sort((a, b) =>
    b.stack_index - a.stack_index
  );
  for (const g of open) {
    if (goalDef(g.goal_code).required_facts.includes(code)) return g;
  }
  return focus;
}

export function run(conversation_id: string, events: ConversationEvent[]): ConversationState {
  let state = initState(conversation_id);
  for (const event of events) state = applyEvent(state, event);
  return state;
}
