/** Ten synthetic, bounded cases through the official V2 bridge. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import { createMotorV2OfficialInterpreter } from "../../edge-functions/_shared/motor-v2-official-interpreter.ts";
import { applyEvent, type ConversationState, initState } from "../../santana-conversation-domain/engine/engine.ts";
import { interpret as deterministicInterpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { planTurn } from "../../santana-conversation-domain/runtime/turn.ts";
import type { LanguageInterpreter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";

interface ShadowCase {
  case_id: string;
  category: string;
  text: string;
  state: ConversationState;
  expected: {
    outcome: "PROPOSED" | "CLARIFICATION";
    event_kind: string | null;
    cases: number;
    goals: number;
    needs_clarification: boolean;
    handoff: boolean;
    questions: number;
  };
}

function openState(conversationId: string, goalCode: string): ConversationState {
  return applyEvent(initState(conversationId), {
    kind: "NEW_GOAL",
    goal_code: goalCode,
    case_ref: `synthetic-${conversationId}`,
  });
}

function cases(): ShadowCase[] {
  return [
    {
      case_id: "semantic-01",
      category: "multi_intent",
      text: "Preciso de exumação e também de recadastro.",
      state: initState("semantic-01"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "NEW_GOAL",
        cases: 1,
        goals: 2,
        needs_clarification: false,
        handoff: false,
        questions: 1,
      },
    },
    {
      case_id: "semantic-02",
      category: "intent_change_context",
      text: "Agora preciso tratar do recadastro.",
      state: openState("semantic-02", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "RECLASSIFICATION",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
    {
      case_id: "semantic-03",
      category: "closing",
      text: "Obrigado, era só isso.",
      state: openState("semantic-03", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "SOCIAL",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
    {
      case_id: "semantic-04",
      category: "media",
      text: "Veja a foto e confirme o conteúdo. [MIDIA_NAO_ANALISADA]",
      state: initState("semantic-04"),
      expected: {
        outcome: "CLARIFICATION",
        event_kind: null,
        cases: 0,
        goals: 0,
        needs_clarification: true,
        handoff: false,
        questions: 1,
      },
    },
    {
      case_id: "semantic-05",
      category: "p0",
      text: "Há conflito familiar sobre quem pode autorizar.",
      state: initState("semantic-05"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "HUMAN_REQUEST",
        cases: 0,
        goals: 0,
        needs_clarification: false,
        handoff: true,
        questions: 0,
      },
    },
    {
      case_id: "semantic-06",
      category: "handoff",
      text: "Quero falar com uma pessoa sobre este atendimento.",
      state: openState("semantic-06", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "HUMAN_REQUEST",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: true,
        questions: 0,
      },
    },
    {
      case_id: "semantic-07",
      category: "simple_goal",
      text: "Preciso de exumação.",
      state: initState("semantic-07"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "NEW_GOAL",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
    {
      case_id: "semantic-08",
      category: "correction",
      text: "Na verdade, quero recadastro, não exumação.",
      state: openState("semantic-08", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "CORRECTION",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
    {
      case_id: "semantic-09",
      category: "return_with_context",
      text: "A referência é quadra 3.",
      state: openState("semantic-09", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "COMPLEMENT",
        cases: 1,
        goals: 1,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
    {
      case_id: "semantic-10",
      category: "new_case",
      text: "É para outro falecido; preciso de exumação.",
      state: openState("semantic-10", "GOAL_EXUMACAO"),
      expected: {
        outcome: "PROPOSED",
        event_kind: "NEW_GOAL",
        cases: 2,
        goals: 2,
        needs_clarification: false,
        handoff: false,
        questions: 0,
      },
    },
  ];
}

function safeObservation(observation: ControlledNvidiaAiObservation | undefined) {
  if (!observation) return null;
  return {
    outcome: observation.outcome,
    provider: observation.provider,
    model: observation.model,
    provider_attempted: observation.provider_attempted,
    ai_output_used: observation.ai_output_used,
    fallback_used: observation.fallback_used,
    duration_ms: observation.duration_ms,
    rejection_code: observation.rejection_code,
    rejection_category: observation.rejection_category,
    http_status: observation.http_status,
    content_type: observation.content_type,
    body_bytes: observation.body_bytes,
    parse_position: observation.parse_position,
    finish_reason: observation.finish_reason,
  };
}

function safePlan(plan: Awaited<ReturnType<typeof planTurn>>) {
  return {
    outcome: plan.outcome,
    event_kind: plan.interpretation?.primary_event?.event_kind ?? null,
    goal_code: plan.interpretation?.goal?.goal_code ?? null,
    needs_clarification: plan.interpretation?.needs_clarification ?? null,
    handoff: plan.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST",
    questions: plan.question_draft ? 1 : 0,
    reply_present: plan.reply_draft !== null,
    state_seq: plan.next_state.seq,
    cases: plan.next_state.cases.length,
    goals: plan.next_state.goals.length,
    official_mapping: plan.interpretation?.official_mapping
      ? {
        selected_event: plan.interpretation.official_mapping.selected_event,
        suppressed_events: plan.interpretation.official_mapping.suppressed_events,
        risk_level: plan.interpretation.official_mapping.risk_level,
        intent_changed: plan.interpretation.official_mapping.intent_changed,
        reason: plan.interpretation.official_mapping.reason,
      }
      : null,
  };
}

function humanPlan(plan: Awaited<ReturnType<typeof planTurn>>) {
  return {
    text: plan.reply_draft ?? "(sem resposta proposta)",
    handoff: plan.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST",
    questions: plan.question_draft ? 1 : 0,
    actions: [],
    receipts: [],
  };
}

function writePrivate(path: string, value: unknown): Promise<void> {
  return Deno.writeTextFile(path, canonicalJson(value) + "\n", { mode: 0o600 });
}

async function main(): Promise<void> {
  const key = (Deno.env.get("NVIDIA_API_KEY") ?? "").trim();
  const output = Deno.args[0];
  const reviewOutput = Deno.args[1];
  if (!key || !output || !reviewOutput) throw new Error("provider key and output paths are required");
  const observations: ControlledNvidiaAiObservation[] = [];
  const v2 = createMotorV2OfficialInterpreter(key, (event) => observations.push(event));
  const baseline: LanguageInterpreter = { interpret: (input) => Promise.resolve(deterministicInterpret(input)) };
  const rows: Array<Record<string, unknown>> = [];
  const reviewRows: Array<Record<string, unknown>> = [];
  const assignment: Array<Record<string, unknown>> = [];
  const assignmentPattern = ["B", "A", "A", "B", "B", "A", "B", "A", "A", "B"];

  for (const [index, item] of cases().entries()) {
    const before = observations.length;
    const input = {
      message_id: `${item.case_id}-turn`,
      text: item.text,
      state: item.state,
      automation_mode: "BOT_ACTIVE" as const,
    };
    const v2Plan = await planTurn(input, v2);
    const v2Observation = observations.slice(before).at(-1);
    const baselinePlan = await planTurn(input, baseline);
    const integrated = safePlan(v2Plan);
    const directedFailures = Object.entries(item.expected).filter(([key, expected]) =>
      integrated[key as keyof typeof integrated] !== expected
    )
      .map(([key, expected]) => ({ field: key, expected, actual: integrated[key as keyof typeof integrated] }));
    const aIsV2 = assignmentPattern[index] === "A";
    rows.push({
      case_id: item.case_id,
      category: item.category,
      provider: CONTROLLED_NVIDIA_MODEL,
      uses_ai: v2Observation?.ai_output_used === true,
      fallback_used: v2Observation?.fallback_used === true,
      provider_attempted: v2Observation?.provider_attempted === true,
      observation: safeObservation(v2Observation),
      integrated_v2: integrated,
      deterministic_baseline: safePlan(baselinePlan),
      expected: item.expected,
      directed_pass: directedFailures.length === 0,
      directed_failures: directedFailures,
      external_effects: false,
      delivery: "SUPPRESSED",
    });
    assignment.push({ case_id: item.case_id, a_is_v2: aIsV2 });
    reviewRows.push({
      review_id: `review-${String(index + 1).padStart(2, "0")}`,
      category: item.category,
      context: [
        item.state.goals.length > 0
          ? "Há um atendimento anterior em andamento."
          : "Não há atendimento anterior em andamento.",
        item.text,
      ],
      response_a: aIsV2 ? humanPlan(v2Plan) : humanPlan(baselinePlan),
      response_b: aIsV2 ? humanPlan(baselinePlan) : humanPlan(v2Plan),
    });
  }

  const summary = {
    schema_version: "phase19c3-directed-semantic-shadow/1.0.0",
    synthetic_input_only: true,
    case_count: rows.length,
    provider: CONTROLLED_NVIDIA_MODEL,
    calls: observations.length,
    valid_ai_outputs: observations.filter((item) => item.outcome === "llm_valid" && item.ai_output_used).length,
    fallback_count: observations.filter((item) => item.fallback_used).length,
    directed_pass_count: rows.filter((row) => row.directed_pass === true).length,
    external_effects: false,
    whatsapp_delivery: "SUPPRESSED",
    review_package: "written separately without system-origin labels",
    rows,
  };
  await Deno.writeTextFile(output, canonicalJson(summary) + "\n", { mode: 0o600 });
  await Deno.writeTextFile(
    reviewOutput,
    canonicalJson({
      schema_version: "phase19c2-human-review/1.0.0",
      synthetic_input_only: true,
      case_count: reviewRows.length,
      systems_blinded: true,
      provider_blinded: true,
      response_origin_blinded: true,
      rows: reviewRows,
    }) + "\n",
    { mode: 0o600 },
  );
  await writePrivate(`${output}.assignment`, assignment);
  console.log(canonicalJson({
    schema_version: summary.schema_version,
    synthetic_input_only: true,
    case_count: summary.case_count,
    calls: summary.calls,
    valid_ai_outputs: summary.valid_ai_outputs,
    fallback_count: summary.fallback_count,
    directed_pass_count: summary.directed_pass_count,
    external_effects: false,
    whatsapp_delivery: "SUPPRESSED",
  }));
  if (
    summary.case_count !== 10 || summary.calls !== 10 || summary.valid_ai_outputs !== 10 ||
    summary.fallback_count !== 0 || summary.directed_pass_count !== 10
  ) {
    Deno.exit(2);
  }
}

if (import.meta.main) await main();
