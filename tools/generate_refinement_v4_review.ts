import { initState, type ConversationState } from "../santana-conversation-domain/engine/engine.ts";
import { interpret } from "../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { planTurn, type TurnPlan } from "../santana-conversation-domain/runtime/turn.ts";

const v3Path = "/data/.openclaw/workspace/exports/sana-conversational-refinement-v3/SANA-CONVERSATIONAL-REFINEMENT-V3-HUMAN-REVIEW.json";
const v3 = JSON.parse(await Deno.readTextFile(v3Path)) as {
  cases: Array<{ id: string; turns: Array<{ turn: number; v3_response: string | null }> }>;
};

const cases = [
  { id: "sim-18", messages: ["Quero localizar um jazigo.", "Agora quero falar da lápide.", "É uma placa com o nome."] },
  { id: "sim-106", messages: ["quero o jazigo da Ana Fictícia", "agora é sobre a placa", "continue no jazigo"] },
  { id: "sim-16", messages: ["Quero localizar o jazigo de Bruno Sintético.", "setor azul, jazigo 3", "setor azul, jazigo 3"] },
  { id: "sim-22", messages: ["Quero saber sobre o jazigo do meu pai.", "Também preciso de orientação sobre lápide.", "Voltando ao meu pai, o nome é Bruno Sintético."] },
  { id: "sim-30", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Agora quero tratar de outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."] },
  { id: "sim-103", messages: ["Preciso de ajuda.", "não sei dizer.", "pode chamar alguém?"] },
  { id: "sim-107", messages: ["documento da Ana foi enviado", "quero falar do pai", "Bruno Sintético", "documento do Bruno foi enviado", "o da Ana estava errado", "vou mandar outro"] },
  { id: "sim-109", messages: ["qual foi o prazo da outra pessoa?", "só me diga a data", "insisto"] },
];

type V4Turn = {
  turn: number;
  citizen_message: string;
  v2_response: string | null;
  v3_response: string | null;
  v4_response: string | null;
  state_before: ReturnType<typeof summarizeState>;
  state_after: ReturnType<typeof summarizeState>;
  event: unknown;
  transition_applied: unknown;
  fallback: string;
  receipt: { status: string; revision: number; delivery: string };
};

function summarizeState(state: ConversationState) {
  return {
    seq: state.seq,
    current_topic: state.current_topic,
    cases: state.cases.map((item) => ({ case_id: item.case_id, subject_ref: item.subject_ref, subject_kind: item.subject_kind })),
    goals: state.goals.map((goal) => ({ goal_id: goal.goal_id, goal_code: goal.goal_code, status: goal.status, case_id: goal.case_id })),
    active_facts: state.facts.filter((fact) => fact.status === "ACTIVE").map((fact) => ({
      fact_code: fact.fact_code,
      value: fact.value,
      case_id: fact.case_id,
      goal_id: fact.goal_id,
    })),
    pending_question: state.pending_question ? {
      fact_code: state.pending_question.fact_code,
      question_code: state.pending_question.question_code,
    } : null,
    handoff: state.handoff ? { case_id: state.handoff.case_id, goal_code: state.handoff.goal_code } : null,
    recent_event: state.event_log.at(-1) ?? null,
  };
}

function transitionFor(plan: TurnPlan, before: ConversationState) {
  const event = plan.next_state.event_log.at(-1) ?? null;
  return event && event.seq > before.seq ? event : null;
}

const outputCases: Array<{ id: string; turns: V4Turn[] }> = [];
for (const testCase of cases) {
  const prior = v3.cases.find((item) => item.id === testCase.id);
  const v3Turns = prior?.turns ?? [];
  const turns: V4Turn[] = [];
  let state = initState(`refinement-v4-review-${testCase.id}`);
  for (const [index, text] of testCase.messages.entries()) {
    const before = structuredClone(state);
    const plan = await planTurn({
      message_id: `${testCase.id}-v4-${index + 1}`,
      text,
      state,
      automation_mode: "BOT_ACTIVE",
    }, { interpret: (input) => Promise.resolve(interpret(input)) });
    const old = v3Turns[index];
    turns.push({
      turn: index + 1,
      citizen_message: text,
      v2_response: old?.v2_response ?? null,
      v3_response: old?.v3_response ?? null,
      v4_response: plan.reply_draft,
      state_before: summarizeState(before),
      state_after: summarizeState(plan.next_state),
      event: plan.interpretation?.primary_event ?? null,
      transition_applied: transitionFor(plan, before),
      fallback: plan.outcome === "HUMAN_ACTIVE" ? "HUMAN_OWNED_NO_AUTOMATIC_REPLY" : "NONE",
      receipt: { status: "LAB_SIMULATED_COMMITTED", revision: plan.next_state.seq, delivery: "QUEUE_ONLY" },
    });
    state = plan.next_state;
  }
  outputCases.push({ id: testCase.id, turns });
}

const report = {
  schema_version: "sana-conversational-refinement-v4-human-review/v1",
  status: "PENDING_HUMAN_REVIEW",
  base_v3_commit: "bde9c63292314d0aa68397a9858ba019cf1186c1",
  branch: "sana-conversational-refinement-v4",
  production_changes: false,
  whatsapp_messages_sent: 0,
  gemini_calls: 0,
  scope: "8 non-approved V3 cases only",
  cases: outputCases,
};

const jsonPath = "/data/.openclaw/workspace/exports/sana-conversational-refinement-v4/SANA-CONVERSATIONAL-REFINEMENT-V4-HUMAN-REVIEW.json";
const mdPath = "/data/.openclaw/workspace/exports/sana-conversational-refinement-v4/SANA-CONVERSATIONAL-REFINEMENT-V4-HUMAN-REVIEW.md";
await Deno.mkdir("/data/.openclaw/workspace/exports/sana-conversational-refinement-v4", { recursive: true });
await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2) + "\n");

const lines: string[] = [
  "# SANA Conversational Refinement V4 — Human Review",
  "",
  "Status: PENDING HUMAN REVIEW",
  "Base V3: `bde9c63`",
  "Gemini calls: 0",
  "Production changes: NONE",
  "WhatsApp messages sent: 0",
  "",
  "Compare cada turno V3 → V4. Os receipts são simulados no LAB (`QUEUE_ONLY`) e não representam publicação, envio ou handoff externo.",
  "",
];
for (const item of outputCases) {
  lines.push(`## ${item.id}`);
  lines.push("");
  for (const turn of item.turns) {
    lines.push(`### Turno ${turn.turn}`);
    lines.push(`**Munícipe:** ${turn.citizen_message}`);
    lines.push(`**V2:** ${turn.v2_response ?? "(sem resposta registrada)"}`);
    lines.push(`**V3:** ${turn.v3_response ?? "(sem resposta registrada)"}`);
    lines.push(`**V4:** ${turn.v4_response ?? "(sem resposta automática; atendimento humano ativo)"}`);
    lines.push(`**Evento:** ${JSON.stringify(turn.event)}`);
    lines.push(`**Transição aplicada:** ${JSON.stringify(turn.transition_applied)}`);
    lines.push(`**Fallback:** ${turn.fallback}`);
    lines.push(`**Estado antes:** ${JSON.stringify(turn.state_before)}`);
    lines.push(`**Estado depois:** ${JSON.stringify(turn.state_after)}`);
    lines.push(`**Receipt:** ${turn.receipt.status}; revisão ${turn.receipt.revision}; ${turn.receipt.delivery}`);
    lines.push("");
  }
  lines.push("**Classificação humana:** APROVADA / REVISAR / REJEITADA — preencher pelo revisor.");
  lines.push("");
}
await Deno.writeTextFile(mdPath, lines.join("\n"));
console.log(JSON.stringify({ jsonPath, mdPath, cases: outputCases.length, turns: outputCases.reduce((sum, item) => sum + item.turns.length, 0) }));
