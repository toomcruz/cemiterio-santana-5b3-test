import { initState, type ConversationState } from "../santana-conversation-domain/engine/engine.ts";
import { interpret } from "../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { planTurn, type TurnPlan } from "../santana-conversation-domain/runtime/turn.ts";

type V2Case = {
  id: string;
  title: string;
  tags: string[];
  human_expectation: string;
  baseline: { turns: Array<{ turn: number; citizen_message: string; response: string | null }> };
  after: Array<{ turn: number; citizen_message: string; response: string | null }>;
};

const inputPath = "/data/.openclaw/workspace/exports/sana-simulation-lab/SANA-CONVERSATIONAL-REFINEMENT-V2-HUMAN-REVIEW.json";
const source = JSON.parse(await Deno.readTextFile(inputPath)) as { cases: V2Case[] };

const affected = new Set([
  "sim-18", "sim-30", "sim-46", "sim-103", "sim-106", "sim-109",
  "sim-22", "sim-104", "sim-107", "sim-108", "sim-16",
]);
const approvedSample = new Set(["sim-07", "sim-19", "sim-40", "sim-101", "sim-34"]);

const humanDecisions: Record<string, { classification: string; reason: string }> = {
  "sim-18": { classification: "REVISAR", reason: "Terceiro turno robótico, repetitivo e com comandos artificiais; deve aproveitar que o item já é uma placa/lápide." },
  "sim-30": { classification: "REVISAR", reason: "FOCUS_CASE e isolamento funcionam, mas a retomada não nomeia Ana Fictícia e repete Entendi." },
  "sim-46": { classification: "REJEITADA", reason: "Primeiro turno sem resposta e repetições genéricas; falta explicar o limite de competência e orientar o próximo passo." },
  "sim-103": { classification: "REJEITADA", reason: "Pedido explícito de atendimento humano foi ignorado; não houve handoff nem resposta útil." },
  "sim-106": { classification: "REJEITADA", reason: "A mudança explícita para placa e a volta ao jazigo não foram entendidas; o fluxo ficou preso em clarificações." },
  "sim-109": { classification: "REVISAR", reason: "Privacidade foi protegida, mas faltou explicar diretamente o limite e oferecer alternativa segura sem repetir a clarificação." },
  "sim-22": { classification: "REVISAR", reason: "Isolamento seguro, mas a orientação sobre lápide não orienta, usa FINALIZAR e não reconhece Bruno Sintético na retomada." },
  "sim-104": { classification: "REJEITADA", reason: "Não inventa prazo, porém não responde como verificar a alegação de duas horas e repete clarificação artificial." },
  "sim-107": { classification: "REJEITADA", reason: "Ignora a declaração de documento e a mudança para pai/Bruno; não registra nem organiza o que foi dito." },
  "sim-108": { classification: "REJEITADA", reason: "Humano é pedido explícito de handoff, mas foi tratado como texto sem significado." },
  "sim-16": { classification: "REJEITADA", reason: "Ignora setor azul/jazigo 3 e repete a mesma pergunta, falhando em aproveitar contexto." },
  "sim-07": { classification: "APROVADA", reason: "Amostra de não-regressão; decisão humana V2 preservada." },
  "sim-19": { classification: "APROVADA", reason: "Amostra de não-regressão; decisão humana V2 preservada." },
  "sim-40": { classification: "APROVADA", reason: "Amostra de não-regressão; decisão humana V2 preservada." },
  "sim-101": { classification: "APROVADA", reason: "Amostra de não-regressão; decisão humana V2 preservada." },
  "sim-34": { classification: "APROVADA", reason: "Amostra de não-regressão; decisão humana V2 preservada." },
};

function compactState(state: ConversationState) {
  return {
    seq: state.seq,
    current_topic: state.current_topic,
    cases: state.cases.map((item) => ({ case_id: item.case_id, subject_ref: item.subject_ref })),
    goals: state.goals.map((item) => ({ goal_id: item.goal_id, goal_code: item.goal_code, status: item.status, case_id: item.case_id })),
    active_facts: state.facts.filter((item) => item.status === "ACTIVE").map((item) => ({
      fact_code: item.fact_code,
      value: item.value,
      source: item.source,
      case_id: item.case_id,
      goal_id: item.goal_id,
    })),
    pending_question: state.pending_question ? {
      fact_code: state.pending_question.fact_code,
      question_code: state.pending_question.question_code,
    } : null,
    handoff: state.handoff,
    recent_events: state.event_log.slice(-4).map((event) => ({ seq: event.seq, event_kind: event.event_kind, note: event.note })),
  };
}

function turnEvent(plan: TurnPlan) {
  return plan.interpretation?.primary_event ? {
    event_kind: plan.interpretation.primary_event.event_kind,
    evidence: plan.interpretation.primary_event.evidence,
    confidence: plan.interpretation.primary_event.confidence,
  } : null;
}

function transition(before: ConversationState, after: ConversationState) {
  const event = after.event_log.at(-1);
  if (!event || event.seq <= before.seq) return null;
  return { seq: event.seq, event_kind: event.event_kind, note: event.note };
}

function fallback(plan: TurnPlan) {
  if (plan.outcome === "INTERPRETATION_UNAVAILABLE") return "SAFE_FALLBACK — interpretação indisponível; resposta não foi tratada como sucesso Gemini";
  return "none";
}

async function replay(item: V2Case) {
  let state = initState(`v3-human-${item.id}`);
  const turns = item.after.map((turn) => ({ turn: turn.turn, citizen_message: turn.citizen_message }));
  const replayed = [];
  for (const turn of turns) {
    const before = state;
    const plan = await planTurn({
      message_id: `v3-${item.id}-${turn.turn}`,
      text: turn.citizen_message,
      state: before,
      automation_mode: "BOT_ACTIVE",
    }, { interpret: (input) => Promise.resolve(interpret(input)) });
    state = plan.next_state;
    replayed.push({
      turn: turn.turn,
      citizen_message: turn.citizen_message,
      v2_response: item.after.find((candidate) => candidate.turn === turn.turn)?.response ?? null,
      v3_response: plan.reply_draft,
      event: turnEvent(plan),
      transition_applied: transition(before, state),
      state_before: compactState(before),
      state_after: compactState(state),
      interpretation_facts: plan.interpretation?.facts.map((fact) => ({
        fact_code: fact.fact_code,
        value: fact.value,
        evidence: fact.evidence,
        source: fact.source,
      })) ?? [],
      fallback: fallback(plan),
      receipt: "LAB_PLAN_ONLY — sem persistência/outbox real",
    });
  }
  return replayed;
}

const selected = source.cases.filter((item) => affected.has(item.id) || approvedSample.has(item.id));
const cases = [];
for (const item of selected) {
  const decision = humanDecisions[item.id] ?? { classification: "UNMAPPED", reason: "Sem decisão humana registrada." };
  cases.push({
    id: item.id,
    title: item.title,
    tags: item.tags,
    human_v2_decision: decision,
    expectation_source: item.human_expectation,
    baseline_v2: item.baseline.turns,
    turns: await replay(item),
  });
}

const output = {
  schema_version: "sana-conversational-refinement-v3-human-review/v1",
  status: "PENDING_HUMAN_REVIEW",
  frozen_v2_base: "bfc6c8335a6c72a401573ec2673f4d77a3dd9b3b",
  branch: "sana-conversational-refinement-v3",
  production_changes: false,
  whatsapp_messages_sent: 0,
  gemini_calls: 0,
  selection: { affected_v2: 11, approved_v2_sample: 5, total: selected.length },
  cases,
};

await Deno.writeTextFile("lab-checkpoints/SANA-CONVERSATIONAL-REFINEMENT-V3-HUMAN-REVIEW.json", JSON.stringify(output, null, 2) + "\n");

function line(value: unknown) {
  return String(value ?? "—").replaceAll("\n", " ");
}
function stateLine(state: ReturnType<typeof compactState>) {
  const goals = state.goals.map((item) => `${item.goal_code}:${item.status}`).join(", ") || "nenhum";
  const facts = state.active_facts.map((item) => `${item.fact_code}=${item.value}`).join(", ") || "nenhum";
  const events = state.recent_events.map((item) => item.note ? `${item.event_kind}/${item.note}` : item.event_kind).join(", ") || "nenhum";
  return `seq=${state.seq}; tópico=${state.current_topic ?? "—"}; casos=${state.cases.length}; objetivos=${goals}; fatos=${facts}; pendência=${state.pending_question?.fact_code ?? "—"}; handoff=${state.handoff ? "ativo" : "—"}; eventos=${events}`;
}

let markdown = `# SANA CONVERSATIONAL REFINEMENT V3 — HUMAN REVIEW\n\n` +
  `**Status:** PENDING_HUMAN_REVIEW\n` +
  `**Base V2 congelada:** bfc6c8335a6c72a401573ec2673f4d77a3dd9b3b\n` +
  `**Branch V3:** sana-conversational-refinement-v3\n` +
  `**Escopo:** 11 casos V2 REVISAR/REJEITADOS + 5 aprovados como amostra de não-regressão\n` +
  `**Gemini:** 0 chamadas\n**Produção alterada:** não\n**WhatsApp enviado:** 0\n\n`;
for (const item of cases) {
  markdown += `## ${item.id} — ${item.title}\n\n`;
  markdown += `**Decisão humana V2:** ${item.human_v2_decision.classification}\n`;
  markdown += `**Motivo/expectativa preservado:** ${item.human_v2_decision.reason}\n`;
  for (const turn of item.turns) {
    markdown += `\n### Turno ${turn.turn}\n`;
    markdown += `**Munícipe:** ${line(turn.citizen_message)}\n`;
    markdown += `**V2 — resposta anterior:** ${line(turn.v2_response)}\n`;
    markdown += `**V3 — resposta nova:** ${line(turn.v3_response)}\n`;
    markdown += `**Estado antes:** ${stateLine(turn.state_before)}\n`;
    markdown += `**Estado depois:** ${stateLine(turn.state_after)}\n`;
    markdown += `**Evento:** ${turn.event ? `${turn.event.event_kind} — evidência: ${line(turn.event.evidence)}` : "nenhum"}\n`;
    markdown += `**Transição aplicada:** ${turn.transition_applied ? `${turn.transition_applied.event_kind}${turn.transition_applied.note ? `/${turn.transition_applied.note}` : ""}` : "nenhuma"}\n`;
    if (turn.interpretation_facts.length > 0) {
      markdown += `**Facts (valor + evidência):** ${turn.interpretation_facts.map((fact) => `${fact.fact_code}=${line(fact.value)} [${line(fact.evidence)}]`).join("; ")}\n`;
    }
    markdown += `**Fallback:** ${turn.fallback}\n**Receipt:** ${turn.receipt}\n`;
  }
  markdown += `\n**Classificação V3:** pendente de revisão humana.\n\n---\n\n`;
}
await Deno.writeTextFile("lab-checkpoints/SANA-CONVERSATIONAL-REFINEMENT-V3-HUMAN-REVIEW.md", markdown);
