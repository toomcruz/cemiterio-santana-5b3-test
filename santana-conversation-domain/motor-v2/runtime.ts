import { canonicalJson, sha256 } from "../runtime/server_transition.ts";
import { projectBenchmarkTrace } from "./benchmark_trace.ts";
import { unique } from "./normalization.ts";
import { evaluatePolicy } from "./policy.ts";
import { MemoryMotorV2Store, upsertVersionedFact } from "./store.ts";
import {
  enrichUnderstandingWithContext,
  GuardedUnderstandingProvider,
  LabSemanticUnderstandingProvider,
  type UnderstandingProvider,
} from "./understanding.ts";
import type { MotorV2AuditEvent, MotorV2LabInput, MotorV2LabResult, MotorV2State, MotorV2Track } from "./types.ts";

const INPUT_KEYS = new Set([
  "case_id",
  "conversation_id",
  "inbound_id",
  "messages",
  "known_facts",
  "do_not_ask_again",
  "track_states",
  "administrative_gaps",
  "fixed_clock",
]);

function validateInput(value: MotorV2LabInput): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("motor-v2 input must be an object");
  const unknown = Object.keys(value).filter((key) => !INPUT_KEYS.has(key));
  if (unknown.length) throw new Error(`motor-v2 input contains forbidden fields: ${unknown.join(", ")}`);
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    throw new Error("at least one message is required");
  }
  if (value.messages.length > 200 || value.messages.some((message) => message.content.length > 20_000)) {
    throw new Error("message input exceeds lab safety bounds");
  }
  if (!value.messages.some((message) => message.role === "user")) {
    throw new Error("at least one user message is required");
  }
  if (
    value.messages.some((message) =>
      !message.turn_id || !["user", "assistant"].includes(message.role) || !message.content.trim()
    )
  ) {
    throw new Error("invalid message");
  }
  if (
    !Array.isArray(value.known_facts) || !Array.isArray(value.do_not_ask_again) || !Array.isArray(value.track_states)
  ) {
    throw new Error("invalid seeded context");
  }
  const safeKey = /^[a-z0-9_]+$/;
  if (
    value.known_facts.some((fact) =>
      !safeKey.test(fact.key) || !fact.source_turn ||
      (fact.value !== null && !["string", "number", "boolean"].includes(typeof fact.value))
    ) || value.do_not_ask_again.some((key) => !safeKey.test(key))
  ) {
    throw new Error("invalid seeded fact context");
  }
  if (
    value.track_states.length === 0 ||
    new Set(value.track_states.map((track) => track.track_id)).size !== value.track_states.length
  ) {
    throw new Error("tracks must be non-empty and unique");
  }
  if (value.track_states.some((track) => !safeKey.test(track.track_id) || !track.label.trim())) {
    throw new Error("invalid track context");
  }
  if (value.case_id && !safeKey.test(value.case_id)) throw new Error("invalid case_id");
  if (Number.isNaN(Date.parse(value.fixed_clock?.instant ?? "")) || !value.fixed_clock?.timezone) {
    throw new Error("fixed_clock must contain a valid instant and timezone");
  }
  const gaps = value.administrative_gaps as unknown as Record<string, unknown>;
  const expectedGaps = [
    "current_deadline",
    "current_value",
    "current_documents",
    "family_authorization",
    "current_schedule",
    "eligibility",
    "current_procedure",
  ];
  const statuses = new Set(["unknown", "requires_current_policy", "human_validation_required"]);
  if (
    !gaps || Object.keys(gaps).length !== expectedGaps.length ||
    expectedGaps.some((key) => !statuses.has(String(gaps[key])))
  ) {
    throw new Error("administrative gaps must be explicit and closed");
  }
}

function tracksFor(input: MotorV2LabInput, now: string, subintents: readonly string[]): MotorV2Track[] {
  return input.track_states.map((track) => ({
    ...structuredClone(track),
    subintents: subintents.filter((intent) =>
      track.label.toLocaleUpperCase("pt-BR").includes(intent.split("_")[0] ?? intent)
    ),
    updated_at: now,
  }));
}

function renderReply(state: MotorV2State): string {
  const actions = new Set(state.policy.actions);
  if (actions.has("REQUEST_EXPLICIT_CONFIRMATION")) {
    return "Preservei a versão atual e preparei somente a alteração solicitada. Confirma explicitamente a prévia antes de qualquer envio?";
  }
  if (state.understanding.subintents.includes("CONTINGENCIA_FUNERARIA_POR_RAMIFICACAO")) {
    return "A contingência verificada foi aceita como plano. Pagamento, agendamento e execução continuam sem confirmação e exigem receipts próprios.";
  }
  const prefix = actions.has("PRIORITIZE_URGENT")
    ? "Vou priorizar a necessidade funerária urgente e preservar os demais assuntos separadamente. "
    : actions.has("ACKNOWLEDGE_UNCERTAINTY")
    ? "Há informações conflitantes; nenhuma delas será tratada como regra ou direito confirmado. "
    : "Preservei os assuntos e os fatos já informados, sem repetir a coleta. ";
  if (state.policy.handoff.offered) {
    return prefix +
      "A próxima orientação depende de validação humana. O handoff leva as trilhas, as lacunas e o próximo passo, sem declarar conclusão.";
  }
  return prefix + "O próximo passo seguro permanece aberto; nenhuma ação externa foi executada.";
}

async function auditEvent(
  sequence: number,
  at: string,
  kind: string,
  detail: string,
  payload: unknown,
): Promise<MotorV2AuditEvent> {
  return { sequence, at, kind, detail, state_hash: await sha256(canonicalJson(payload)) };
}

export class MotorV2Runtime {
  readonly #provider: UnderstandingProvider;
  readonly #store: MemoryMotorV2Store;

  constructor(
    provider: UnderstandingProvider = new LabSemanticUnderstandingProvider(),
    store = new MemoryMotorV2Store(),
  ) {
    this.#provider = new GuardedUnderstandingProvider(provider);
    this.#store = store;
  }

  async runLabCase(input: MotorV2LabInput): Promise<MotorV2LabResult> {
    const started = performance.now();
    validateInput(input);
    const inputHash = await sha256(canonicalJson(input));
    const caseId = input.case_id ?? `lab_case_${inputHash.slice(0, 20)}`;
    const conversationId = input.conversation_id ?? `conversation_${inputHash.slice(0, 20)}`;
    const inboundId = input.inbound_id ?? `inbound_${inputHash.slice(20, 40)}`;
    const prior = this.#store.load();
    if (prior?.processed_inbound_ids.includes(inboundId)) {
      const trace = projectBenchmarkTrace({
        caseId,
        reply: renderReply(prior),
        state: prior,
        policy: prior.policy,
        reusedFactKeys: unique([...input.known_facts.map((fact) => fact.key), ...input.do_not_ask_again]),
        gatewayCalls: [],
        provider: this.#provider.metadata,
      });
      return {
        trace,
        state: prior,
        audit: prior.audit,
        metrics: {
          duration_ms: performance.now() - started,
          message_count: input.messages.length,
          user_turn_count: input.messages.filter((message) => message.role === "user").length,
          recognized_intent_count: prior.understanding.subintents.length,
          track_count: prior.tracks.length,
          question_count: prior.policy.asked_fact_keys.length,
          tool_call_count: 0,
          retry_count: 0,
        },
        provider: this.#provider.metadata,
        duplicate: true,
      };
    }

    const proposedUnderstanding = await this.#provider.understand(input.messages) as MotorV2State["understanding"];
    const understanding = enrichUnderstandingWithContext(proposedUnderstanding, [
      ...input.track_states.flatMap((track) => [track.track_id, track.label]),
      ...input.known_facts.map((fact) => fact.key),
    ]);
    const tracks = tracksFor(input, input.fixed_clock.instant, understanding.subintents);
    const policy = evaluatePolicy({
      understanding,
      messages: input.messages,
      tracks,
      gaps: input.administrative_gaps,
      currentPolicies: [],
      at: input.fixed_clock.instant,
    });
    let facts = prior?.facts ?? [];
    for (const fact of input.known_facts) {
      facts = await upsertVersionedFact(facts, {
        key: fact.key,
        value: fact.value,
        value_type: fact.value === null ? "null" : typeof fact.value as "string" | "number" | "boolean",
        source: fact.status,
        source_ref: fact.source_turn,
        confidence: "high",
        observed_at: input.fixed_clock.instant,
        temporal_status: "not_applicable",
      });
    }
    const audit = [
      await auditEvent(
        1,
        input.fixed_clock.instant,
        "understanding_completed",
        this.#provider.metadata.id,
        understanding,
      ),
      await auditEvent(2, input.fixed_clock.instant, "policy_evaluated", "deterministic fail-closed policy", policy),
    ];
    const state: MotorV2State = {
      schema_version: "motor-v2-state/1.0.0",
      conversation_id: conversationId,
      revision: prior?.revision ?? 0,
      facts: prior?.facts ?? facts,
      tracks,
      understanding,
      policy,
      receipts: prior?.receipts ?? [],
      processed_inbound_ids: prior?.processed_inbound_ids ?? [],
      audit: [
        ...(prior?.audit ?? []),
        ...audit.map((event, index) => ({ ...event, sequence: (prior?.audit.length ?? 0) + index + 1 })),
      ],
      state_hash: "",
    };

    // The isolated runtime proposes actions but never invokes the Action Gateway.
    const committed = await this.#store.commit(state, inboundId, input.fixed_clock, "isolated lab turn");
    const reply = renderReply(committed.state);
    const reusedFactKeys = unique([...input.known_facts.map((fact) => fact.key), ...input.do_not_ask_again]);
    const trace = projectBenchmarkTrace({
      caseId,
      reply,
      state: committed.state,
      policy,
      reusedFactKeys,
      gatewayCalls: [],
      provider: this.#provider.metadata,
    });
    return {
      trace,
      state: committed.state,
      audit: committed.state.audit,
      metrics: {
        duration_ms: performance.now() - started,
        message_count: input.messages.length,
        user_turn_count: input.messages.filter((message) => message.role === "user").length,
        recognized_intent_count: understanding.subintents.length,
        track_count: tracks.length,
        question_count: policy.asked_fact_keys.length,
        tool_call_count: 0,
        retry_count: 0,
      },
      provider: this.#provider.metadata,
      duplicate: committed.duplicate,
    };
  }
}

export function runMotorV2LabCase(input: MotorV2LabInput): Promise<MotorV2LabResult> {
  return new MotorV2Runtime().runLabCase(input);
}
