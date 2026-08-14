import type { DecisionInput, DecisionPlan } from "../../contracts/decision-plan.ts";
import { A_CONFIRMAR_RESTRICTIONS, assertAConfirmarPlan } from "../../contracts/decision-plan.ts";
import { assertMethod, HttpProblem, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";

type Rule = {
  decision_rule_id: string;
  rule_code: string;
  priority: number;
  stop_processing: boolean;
  when_expression: Record<string, unknown>;
  then_plan: Partial<DecisionPlan>;
};

function matches(rule: Rule, input: DecisionInput): boolean {
  const when = rule.when_expression;
  const intent = input.classification.intent_candidates[0]?.code;
  const service = input.classification.service_candidates[0]?.code;
  const location = input.classification.location_candidate?.location_type;
  return (!when.intent_code || when.intent_code === intent) &&
    (!when.service_code || when.service_code === service) &&
    (!when.location_type || when.location_type === location) &&
    (!when.message_role || when.message_role === input.classification.message_role) &&
    (!when.requires_pending_confirmation || Boolean(input.state.pending_confirmation));
}

function aConfirmar(input: DecisionInput, reason: string): DecisionPlan {
  return {
    schema_version: "1.0",
    decision_id: crypto.randomUUID(),
    correlation_id: input.correlation_id,
    release_id: input.release_id,
    state_version: input.state.state_version,
    outcome: "A_CONFIRMAR",
    actions: ["RESPONDER"],
    response_plan: null,
    state_patch: { expected_state_version: input.state.state_version, operations: [] },
    request_plan: null,
    document_plan: null,
    handoff_plan: null,
    reason_codes: [reason],
    validation_requirements: {
      session_must_be_active: true,
      human_must_be_inactive: true,
      confirmation_nonce_required: false,
      required_document_ids: [],
      provider_delivery_required: false,
    },
    a_confirmar_restrictions: A_CONFIRMAR_RESTRICTIONS,
    expires_at: new Date(Date.now() + 300000).toISOString(),
  };
}

const COMPOSABLE_FIELDS = [
  "response_plan",
  "request_plan",
  "document_plan",
  "handoff_plan",
  "state_patch",
  "validation_requirements",
] as const;

/** Compatible rules may add distinct allowed plan sections; contradictory values are a real conflict. */
function mergeCompatible(input: DecisionInput, rules: Rule[]): DecisionPlan | null {
  const base = rules[0]?.then_plan;
  if (!base) return null;
  const plan: Partial<DecisionPlan> = { ...base };
  for (const rule of rules.slice(1)) {
    for (const key of COMPOSABLE_FIELDS) {
      const current = plan[key];
      const next = rule.then_plan[key];
      if (current !== undefined && next !== undefined && JSON.stringify(current) !== JSON.stringify(next)) {
        return null;
      }
      if (current === undefined) plan[key] = next;
    }
    const currentActions = Array.isArray(plan.actions) ? plan.actions : [];
    const nextActions = Array.isArray(rule.then_plan.actions) ? rule.then_plan.actions : [];
    plan.actions = [...new Set([...currentActions, ...nextActions])];
  }
  return {
    ...plan,
    schema_version: "1.0",
    decision_id: crypto.randomUUID(),
    correlation_id: input.correlation_id,
    release_id: input.release_id,
    state_version: input.state.state_version,
  } as DecisionPlan;
}

export async function decide(input: DecisionInput, rest: SupabaseRest): Promise<DecisionPlan> {
  const rules = await rest.rpc<Rule[]>("get_runtime_decision_rules", {
    p_release_id: input.release_id,
    p_intent_code: input.classification.intent_candidates[0]?.code ?? null,
    p_service_code: input.classification.service_candidates[0]?.code ?? null,
    p_location_type: input.classification.location_candidate?.location_type ?? null,
  });
  const applicable = rules.filter((rule) => matches(rule, input)).sort((a, b) =>
    b.priority - a.priority ||
    (a.rule_code ?? "").localeCompare(b.rule_code ?? "") ||
    (a.decision_rule_id ?? "").localeCompare(b.decision_rule_id ?? "")
  );
  const firstApplicable = applicable[0];
  if (!firstApplicable) return aConfirmar(input, "NO_MATCHING_PUBLISHED_RULE");
  const highestPriority = firstApplicable.priority;
  const equallyPrecedent = applicable.filter((rule) => rule.priority === highestPriority);
  const selected: Rule[] = [];
  for (const rule of equallyPrecedent) {
    // Equal-priority rules are canonically ordered. Conflicting closed plans fail closed below.
    selected.push(rule);
    if (rule.stop_processing) break;
  }
  const plan = mergeCompatible(input, selected);
  if (!plan || assertAConfirmarPlan(plan).length) return aConfirmar(input, "RULE_CONFLICT_OR_INVALID_PLAN");
  await rest.rpc("store_shadow_decision", {
    p_plan: plan,
    p_session_id: input.state.session_id,
    p_topic_id: input.state.active_topic?.topic_id ?? null,
  });
  return plan;
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    try {
      assertMethod(request, "POST");
      requireInternalShadowAccess(request);
      requireShadowOnly();
      return json(await decide(await parseJson<DecisionInput>(request), new SupabaseRest()));
    } catch (error) {
      return problem(error instanceof Error ? error : new HttpProblem(500, "UNKNOWN", "Unknown error"));
    }
  });
}
