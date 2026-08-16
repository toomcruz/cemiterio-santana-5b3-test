// Carrega e tipa os catalogos versionados do dominio conversacional.
// Fase 5B.4-A: artefato de modelagem e validacao. Nenhuma integracao externa.

export type PriorityClass =
  | "FLOW_BRANCH"
  | "PREREQUISITE"
  | "BLOCKING_UNCERTAINTY"
  | "DEPENDENCY"
  | "NEXT_ACTION_DATA"
  | "ADMINISTRATIVE";

export const PRIORITY_RANK: Record<PriorityClass, number> = {
  FLOW_BRANCH: 1,
  PREREQUISITE: 2,
  BLOCKING_UNCERTAINTY: 3,
  DEPENDENCY: 4,
  NEXT_ACTION_DATA: 5,
  ADMINISTRATIVE: 6,
};

export type FactSource = "USER_EXPLICIT" | "USER_CORRECTION" | "DOCUMENT" | "SYSTEM" | "DERIVED_RULE";
export type Confidence = "CONFIRMED" | "UNCERTAIN" | "CONFLICTING";
export type GoalStatus = "ACTIVE" | "SUSPENDED" | "WAITING" | "RESOLVED" | "ABANDONED";
export type FactValue = string | boolean | number | null;

export type EventKind =
  | "ANSWER"
  | "CORRECTION"
  | "COMPLEMENT"
  | "PARALLEL_QUESTION"
  | "CHANGE_OF_MIND"
  | "NEW_GOAL"
  | "COMPLAINT"
  | "HUMAN_REQUEST"
  | "SOCIAL"
  | "UNCERTAIN";

export interface Condition {
  fact: string;
  equals?: FactValue;
  in?: FactValue[];
}

export interface FactDef {
  fact_code: string;
  display_name: string;
  scope: "CONVERSATION" | "CASE" | "GOAL";
  value_type: string;
  allowed_values?: string[];
  priority_class: PriorityClass;
  relevant_when?: Condition[];
  depends_on?: string[];
  derived?: boolean;
  allowed_sources: FactSource[];
  ai_extractable: boolean;
  human_rule_note?: string;
}

export interface GoalDef {
  goal_code: string;
  topic_code: string;
  creates_case?: boolean;
  case_subject?: string;
  overlay?: boolean;
  informational?: boolean;
  required_facts: string[];
}

export interface TopicDef {
  topic_code: string;
  display_name: string;
  layer: "BASE" | "OVERLAY";
  primary_goal: string;
  fallback?: boolean;
  capabilities: string[];
  entities: string[];
}

export interface RelationEffect {
  op: string;
  fact_code?: string;
  fact_codes?: string[];
  goal_code?: string;
  value?: FactValue;
  from?: string[];
  source?: FactSource;
  suspend_parent?: boolean;
  return_to_parent?: boolean;
  status?: GoalStatus;
  reason?: string;
  action_code?: string;
  executor?: "SYSTEM" | "HUMAN" | "SYSTEM_OR_HUMAN";
}

export interface RelationDef {
  relation_code: string;
  kind: string;
  from_goal: string;
  to_goal: string | null;
  description: string;
  when?: {
    goal_code: string;
    goal_status_in: GoalStatus[];
    conditions: Condition[];
  };
  effects?: RelationEffect[];
  on_child_resolved?: RelationEffect[];
  forbidden_effects?: string[];
  rules?: Record<string, boolean>;
  example?: string;
}

export interface QuestionDef {
  question_code: string;
  fact_code: string;
  text: string;
}

interface TopicsDoc {
  topics: TopicDef[];
  informational_goals: { goals: string[] };
}
interface FactsDoc {
  fact_sources: FactSource[];
  confidence_states: Confidence[];
  facts: FactDef[];
  ai_boundary: { ai_may: string[]; ai_may_not: string[] };
}
interface GoalsDoc {
  goal_status: GoalStatus[];
  stack_operations: string[];
  goals: GoalDef[];
}
interface RelationsDoc {
  relations: RelationDef[];
}
interface QuestionsDoc {
  priority_order: { rank: number; priority_class: PriorityClass }[];
  questions: QuestionDef[];
  conflict_questions: { question_code: string }[];
}
interface EventsDoc {
  events: { event_kind: EventKind; description: string; effects: string[] }[];
}

function load<T>(name: string): T {
  const url = new URL(`../${name}`, import.meta.url);
  return JSON.parse(Deno.readTextFileSync(url)) as T;
}

export const topicsDoc: TopicsDoc = load("topics.v1.json");
export const factsDoc: FactsDoc = load("facts.v1.json");
export const goalsDoc: GoalsDoc = load("goals.v1.json");
export const relationsDoc: RelationsDoc = load("relations.v1.json");
export const questionsDoc: QuestionsDoc = load("questions.v1.json");
export const eventsDoc: EventsDoc = load("conversation-events.v1.json");
export const stateSchema: Record<string, unknown> = load("state.schema.json");

const factIndex = new Map<string, FactDef>(factsDoc.facts.map((f) => [f.fact_code, f]));
const goalIndex = new Map<string, GoalDef>(goalsDoc.goals.map((g) => [g.goal_code, g]));
const questionIndex = new Map<string, QuestionDef>(questionsDoc.questions.map((q) => [q.fact_code, q]));

export function factDef(code: string): FactDef {
  const def = factIndex.get(code);
  if (!def) throw new Error(`fato desconhecido no catalogo: ${code}`);
  return def;
}

export function goalDef(code: string): GoalDef {
  const def = goalIndex.get(code);
  if (!def) throw new Error(`goal desconhecido no catalogo: ${code}`);
  return def;
}

export function questionForFact(code: string): QuestionDef {
  const q = questionIndex.get(code);
  if (!q) throw new Error(`nenhuma pergunta declarada para o fato: ${code}`);
  return q;
}

export const CONFLICT_QUESTION_CODE = "Q_CONFLICT_CONFIRM";
