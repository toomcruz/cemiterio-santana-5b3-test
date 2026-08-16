// Validacao estatica do dominio: integridade cruzada dos catalogos e
// conformidade do estado com state.schema.json (subconjunto JSON Schema usado).

import { factsDoc, goalsDoc, questionsDoc, relationsDoc, stateSchema, topicsDoc } from "./catalog.ts";

type Json = Record<string, unknown>;

function refTarget(schema: Json, ref: string): Json {
  const path = ref.replace(/^#\//, "").split("/");
  let node: unknown = schema;
  for (const part of path) {
    node = (node as Json)[part];
    if (node === undefined) throw new Error(`$ref inexistente: ${ref}`);
  }
  return node as Json;
}

export function validateAgainstSchema(root: Json, node: Json, value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (typeof node.$ref === "string") return validateAgainstSchema(root, refTarget(root, node.$ref), value, path);

  if ("const" in node && value !== node.const) errors.push(`${path}: esperado const ${String(node.const)}`);

  if (Array.isArray(node.enum)) {
    if (!node.enum.some((e) => e === value)) errors.push(`${path}: valor fora do enum (${String(value)})`);
    return errors;
  }

  if (Array.isArray(node.oneOf)) {
    const matches = node.oneOf.filter((sub) => validateAgainstSchema(root, sub as Json, value, path).length === 0);
    if (matches.length !== 1) errors.push(`${path}: nao satisfaz exatamente um oneOf`);
    return errors;
  }

  const types = node.type === undefined ? [] : Array.isArray(node.type) ? node.type as string[] : [node.type as string];
  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    errors.push(`${path}: tipo esperado ${types.join("|")}, recebido ${value === null ? "null" : typeof value}`);
    return errors;
  }

  if (typeof value === "string" && typeof node.minLength === "number" && value.length < node.minLength) {
    errors.push(`${path}: minLength ${node.minLength}`);
  }
  if (typeof value === "number" && typeof node.minimum === "number" && value < node.minimum) {
    errors.push(`${path}: minimum ${node.minimum}`);
  }

  if (Array.isArray(value) && node.items) {
    value.forEach((item, i) => errors.push(...validateAgainstSchema(root, node.items as Json, item, `${path}[${i}]`)));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Json;
    const props = (node.properties ?? {}) as Record<string, Json>;
    for (const req of (node.required ?? []) as string[]) {
      if (!(req in obj)) errors.push(`${path}: propriedade obrigatoria ausente '${req}'`);
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}: propriedade nao declarada '${key}'`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errors.push(...validateAgainstSchema(root, sub, obj[key], `${path}.${key}`));
    }
  }
  return errors;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`tipo desconhecido no schema: ${type}`);
  }
}

export function validateState(state: unknown): string[] {
  return validateAgainstSchema(stateSchema as Json, stateSchema as Json, state, "state");
}

export function validateCatalogs(): string[] {
  const errors: string[] = [];
  const factCodes = new Set(factsDoc.facts.map((f) => f.fact_code));
  const goalCodes = new Set(goalsDoc.goals.map((g) => g.goal_code));
  const topicCodes = new Set(topicsDoc.topics.map((t) => t.topic_code));

  for (const goal of goalsDoc.goals) {
    if (!topicCodes.has(goal.topic_code)) errors.push(`goal ${goal.goal_code}: topico inexistente ${goal.topic_code}`);
    for (const code of goal.required_facts) {
      if (!factCodes.has(code)) errors.push(`goal ${goal.goal_code}: fato inexistente ${code}`);
    }
  }
  for (const topic of topicsDoc.topics) {
    if (!goalCodes.has(topic.primary_goal)) {
      errors.push(`topico ${topic.topic_code}: goal inexistente ${topic.primary_goal}`);
    }
  }
  for (const fact of factsDoc.facts) {
    for (const dep of fact.depends_on ?? []) {
      if (!factCodes.has(dep)) errors.push(`fato ${fact.fact_code}: depends_on inexistente ${dep}`);
    }
    for (const cond of fact.relevant_when ?? []) {
      if (!factCodes.has(cond.fact)) errors.push(`fato ${fact.fact_code}: relevant_when referencia ${cond.fact}`);
    }
    if (fact.derived && !fact.allowed_sources.includes("DERIVED_RULE")) {
      errors.push(`fato ${fact.fact_code}: derivado sem origem DERIVED_RULE`);
    }
  }
  for (const relation of relationsDoc.relations) {
    if (!goalCodes.has(relation.from_goal)) errors.push(`relacao ${relation.relation_code}: from_goal inexistente`);
    if (relation.to_goal && !goalCodes.has(relation.to_goal)) {
      errors.push(`relacao ${relation.relation_code}: to_goal inexistente`);
    }
    for (const cond of relation.when?.conditions ?? []) {
      if (!factCodes.has(cond.fact)) {
        errors.push(`relacao ${relation.relation_code}: condicao sobre fato inexistente ${cond.fact}`);
      }
    }
    for (const effect of [...(relation.effects ?? []), ...(relation.on_child_resolved ?? [])]) {
      if (effect.fact_code && !factCodes.has(effect.fact_code)) {
        errors.push(`relacao ${relation.relation_code}: efeito sobre fato inexistente ${effect.fact_code}`);
      }
      if (effect.goal_code && !goalCodes.has(effect.goal_code)) {
        errors.push(`relacao ${relation.relation_code}: efeito sobre goal inexistente ${effect.goal_code}`);
      }
      if (relation.forbidden_effects?.includes(effect.op)) {
        errors.push(`relacao ${relation.relation_code}: efeito proibido declarado ${effect.op}`);
      }
    }
  }
  // Todo fato exigido por algum goal precisa de uma pergunta declarada.
  const questionFacts = new Set(questionsDoc.questions.map((q) => q.fact_code));
  for (const goal of goalsDoc.goals) {
    for (const code of goal.required_facts) {
      if (!questionFacts.has(code)) {
        errors.push(`fato ${code} exigido por ${goal.goal_code} nao tem pergunta declarada`);
      }
    }
  }
  return errors;
}
