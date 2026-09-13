/**
 * Compare deterministic and real-AI Motor V2 understanding over a sanitized
 * live cohort. The only network boundary is the controlled Gemini provider;
 * no production adapter, sender, operational store or action executor is used.
 */
import { proposedCalls } from "../../phase18/shadow/would_call.ts";
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import {
  type ControlledAiObservation,
  ControlledGeminiUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/gemini.ts";
import { MotorV2Runtime } from "../../santana-conversation-domain/motor-v2/runtime.ts";
import { sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";
import { understandMessages } from "../../santana-conversation-domain/motor-v2/understanding.ts";
import type {
  AdministrativeGaps,
  MotorV2LabInput,
  MotorV2LabResult,
  MotorV2Message,
  SeededFact,
  SeededTrack,
} from "../../santana-conversation-domain/motor-v2/types.ts";

interface CohortMessage extends MotorV2Message {
  captured_at: string;
  source_event_ref: string;
  media_omitted: boolean;
  redaction_classes: string[];
}

interface CohortEpisode {
  episode_id: string;
  conversation_ref: string;
  started_at: string;
  ended_at: string;
  decision_turn_index: number;
  observed_current_end_index: number;
  messages: CohortMessage[];
}

interface LiveCohort {
  schema_version: "phase18b-live-shadow-cohort/1.0.0";
  mode: "LIVE_PASSIVE";
  cohort_id: string;
  cohort_hash: string;
  source: Record<string, unknown>;
  safety: {
    respond_allowed: false;
    action_allowed: false;
    official_write_allowed: false;
    tools_mode: "would_call_only";
    raw_content_persisted: false;
    raw_identifiers_persisted: false;
  };
  episodes: CohortEpisode[];
}

interface Options {
  cohort: string;
  output: string;
  model: string;
  timeoutMs: number;
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    values.set(key.slice(2), value);
  }
  const cohort = values.get("cohort");
  const output = values.get("output");
  const model = values.get("model") ?? Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
  const timeoutMs = Number(values.get("timeout-ms") ?? "12000");
  if (!cohort || !output) throw new Error("--cohort and --output are required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new Error("invalid timeout");
  return { cohort, output, model, timeoutMs };
}

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) throw new Error(`${label} contains missing or extra fields`);
}

async function readCohort(path: string): Promise<LiveCohort> {
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) throw new Error("cohort must be a regular file");
  const cohort = JSON.parse(await Deno.readTextFile(path)) as LiveCohort;
  exactKeys(cohort, ["schema_version", "mode", "cohort_id", "cohort_hash", "source", "safety", "episodes"], "cohort");
  if (cohort.schema_version !== "phase18b-live-shadow-cohort/1.0.0" || cohort.mode !== "LIVE_PASSIVE") {
    throw new Error("unexpected cohort schema or mode");
  }
  const withoutHash = structuredClone(cohort) as unknown as Record<string, unknown>;
  delete withoutHash.cohort_hash;
  if (await sha256(canonicalJson(withoutHash)) !== cohort.cohort_hash) throw new Error("cohort hash mismatch");
  if (cohort.episodes.length < 20 || cohort.episodes.length > 100) throw new Error("cohort size outside bounds");
  if (
    cohort.safety.respond_allowed !== false || cohort.safety.action_allowed !== false ||
    cohort.safety.official_write_allowed !== false || cohort.safety.tools_mode !== "would_call_only"
  ) throw new Error("cohort safety contract is not closed");
  const seen = new Set<string>();
  for (const episode of cohort.episodes) {
    exactKeys(
      episode,
      [
        "episode_id",
        "conversation_ref",
        "started_at",
        "ended_at",
        "decision_turn_index",
        "observed_current_end_index",
        "messages",
      ],
      "episode",
    );
    if (!/^live_episode_[a-f0-9]{24}$/.test(episode.episode_id) || seen.has(episode.episode_id)) {
      throw new Error("invalid or duplicate episode id");
    }
    seen.add(episode.episode_id);
    if (!/^conversation_[a-f0-9]{24}$/.test(episode.conversation_ref)) throw new Error("invalid conversation ref");
    if (!Number.isInteger(episode.decision_turn_index) || !Number.isInteger(episode.observed_current_end_index)) {
      throw new Error("invalid decision bounds");
    }
    if (
      episode.decision_turn_index < 0 || episode.observed_current_end_index <= episode.decision_turn_index + 1 ||
      episode.observed_current_end_index > episode.messages.length || episode.messages.length > 40
    ) throw new Error("decision window outside episode");
    if (episode.messages[episode.decision_turn_index]?.role !== "user") throw new Error("decision must end on inbound");
    if (
      episode.messages.slice(episode.decision_turn_index + 1, episode.observed_current_end_index).some((row) =>
        row.role !== "assistant"
      )
    ) throw new Error("observed current response must be outbound only");
  }
  return cohort;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

function deriveFacts(messages: readonly MotorV2Message[]): SeededFact[] {
  const rules: Array<[string, RegExp]> = [
    ["reference_already_provided", /\b(?:quadra|terreno|gaveta|referencia)\b/],
    ["family_relation_declared", /\b(?:familia|familiar|herdeiro|herdeiros)\b/],
    ["destination_already_provided", /\b(?:ossuario|ossario|cremacao|traslado|reinumacao)\b/],
    ["prior_contact_declared", /\b(?:contato|aguardando|reclamacao)\b/],
    ["schedule_status_provided", /\b(?:agendamento|confirmado)\b/],
  ];
  const facts: SeededFact[] = [];
  for (const [key, pattern] of rules) {
    const source = messages.find((message) => message.role === "user" && pattern.test(normalize(message.content)));
    if (source) facts.push({ key, value: true, source_turn: source.turn_id, status: "user_provided" });
  }
  return facts;
}

function deriveTracks(messages: readonly MotorV2Message[]): SeededTrack[] {
  const result = understandMessages(messages);
  const journeys = result.journeys.filter((journey) => journey !== "DESCONHECIDA_AMBIGUA");
  return (journeys.length ? journeys : ["DESCONHECIDA_AMBIGUA"]).map((journey) => ({
    track_id: `track_${journey.toLocaleLowerCase("pt-BR")}`,
    label: journey,
    status: "active" as const,
  }));
}

const CLOSED_GAPS: AdministrativeGaps = {
  current_deadline: "requires_current_policy",
  current_value: "requires_current_policy",
  current_documents: "requires_current_policy",
  family_authorization: "requires_current_policy",
  current_schedule: "requires_current_policy",
  eligibility: "requires_current_policy",
  current_procedure: "requires_current_policy",
};

function inputFor(episode: CohortEpisode): MotorV2LabInput {
  const decisionMessage = episode.messages[episode.decision_turn_index];
  if (!decisionMessage) throw new Error("decision message missing");
  const messages = episode.messages.slice(0, episode.decision_turn_index + 1).map(({ turn_id, role, content }) => ({
    turn_id,
    role,
    content,
  }));
  const facts = deriveFacts(messages);
  return {
    case_id: episode.episode_id,
    conversation_id: episode.conversation_ref,
    inbound_id: decisionMessage.source_event_ref,
    messages,
    known_facts: facts,
    do_not_ask_again: facts.map((fact) => fact.key),
    track_states: deriveTracks(messages),
    administrative_gaps: structuredClone(CLOSED_GAPS),
    fixed_clock: {
      instant: decisionMessage.captured_at,
      timezone: "America/Sao_Paulo",
    },
  };
}

async function projection(result: MotorV2LabResult) {
  return {
    provider: result.provider,
    journeys: result.state.understanding.journeys,
    subintents: result.state.understanding.subintents,
    transverse_states: result.state.understanding.transverse_states,
    intent_changed: result.state.understanding.intent_changed,
    complexity: result.state.understanding.complexity,
    risk: result.state.understanding.risk,
    confidence: result.state.understanding.confidence,
    reused_fact_keys: result.trace.reused_fact_keys,
    asked_fact_keys: result.trace.asked_fact_keys,
    handoff: result.trace.handoff,
    response_proposed: result.trace.reply,
    would_call: await proposedCalls(result),
    receipts_required: result.state.policy.required_receipt_types,
    current_policy_refs: result.state.policy.current_policy_refs,
    policy_gaps: result.state.policy.policy_gaps,
    case_closed: result.trace.case_closed,
    closure_basis: result.trace.closure_basis,
    claims: result.trace.claims,
    actions_executed_real: [],
  };
}

function differences(left: Awaited<ReturnType<typeof projection>>, right: Awaited<ReturnType<typeof projection>>) {
  const codes: string[] = [];
  const compare = (field: string, a: unknown, b: unknown) => {
    if (canonicalJson(a) !== canonicalJson(b)) codes.push(field);
  };
  compare("JOURNEYS", [...left.journeys].sort(), [...right.journeys].sort());
  compare("SUBINTENTS", [...left.subintents].sort(), [...right.subintents].sort());
  compare("TRANSVERSE_STATES", [...left.transverse_states].sort(), [...right.transverse_states].sort());
  compare("INTENT_CHANGE", left.intent_changed, right.intent_changed);
  compare("RISK", left.risk, right.risk);
  compare("HANDOFF", left.handoff, right.handoff);
  compare("NEXT_RESPONSE", left.response_proposed, right.response_proposed);
  compare("WOULD_CALL", left.would_call, right.would_call);
  return codes;
}

async function privateWrite(path: string, value: unknown): Promise<void> {
  const slash = path.lastIndexOf("/");
  if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp.${crypto.randomUUID().replaceAll("-", "")}`;
  await Deno.writeTextFile(temporary, canonicalJson(value) + "\n", { createNew: true, mode: 0o600 });
  await Deno.rename(temporary, path);
  await Deno.chmod(path, 0o600);
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const cohort = await readCohort(options.cohort);
  const cases = [];
  const observations: ControlledAiObservation[] = [];
  for (const episode of cohort.episodes) {
    const input = inputFor(episode);
    const deterministic = await new MotorV2Runtime().runLabCase(input);
    const localObservations: ControlledAiObservation[] = [];
    const provider = new ControlledGeminiUnderstandingProvider({
      apiKey,
      model: options.model,
      timeoutMs: options.timeoutMs,
      observe: (event) => localObservations.push(event),
    });
    const ai = await new MotorV2Runtime(provider).runLabCase(input);
    const observation = localObservations[0];
    if (localObservations.length !== 1 || !observation?.provider_attempted) {
      throw new Error("provider observation missing or duplicated");
    }
    observations.push(observation);
    const deterministicProjection = await projection(deterministic);
    const aiProjection = await projection(ai);
    const currentObserved = episode.messages.slice(
      episode.decision_turn_index + 1,
      episode.observed_current_end_index,
    ).map((message) => message.content).join("\n");
    cases.push({
      episode_id: episode.episode_id,
      conversation_ref: episode.conversation_ref,
      decision_at: input.fixed_clock.instant,
      decision_input_turns: input.messages.length,
      current_workflow_observed: {
        source: "real_outbound_observed_by_passive_companion",
        response_sanitized: currentObserved,
        response_sha256: await sha256(currentObserved),
        raw_content_persisted: false,
      },
      deterministic: deterministicProjection,
      ai: aiProjection,
      deterministic_vs_ai: {
        divergence_codes: differences(deterministicProjection, aiProjection),
        provider_observation: observation,
      },
      candidate_evidence: true,
      human_validated: false,
    });
  }
  const byOutcome = Object.fromEntries(
    [...new Set(observations.map((event) => event.outcome))].sort().map((outcome) => [
      outcome,
      observations.filter((event) => event.outcome === outcome).length,
    ]),
  );
  const result = {
    schema_version: "phase18b-live-ai-shadow-run/1.0.0",
    mode: "LIVE_PASSIVE_NO_EFFECTS",
    cohort_id: cohort.cohort_id,
    cohort_hash: cohort.cohort_hash,
    provider: {
      id: "controlled-gemini-understanding-v1",
      model: options.model,
      uses_ai: true,
      schema_guarded: true,
      attempted_count: observations.length,
      llm_valid_count: observations.filter((event) => event.outcome === "llm_valid").length,
      fallback_count: observations.filter((event) => event.fallback_used).length,
      outcomes: byOutcome,
    },
    comparison: {
      deterministic_vs_ai_cases: cases.length,
      exact_semantic_match_cases: cases.filter((item) => item.deterministic_vs_ai.divergence_codes.length === 0).length,
      divergent_cases: cases.filter((item) => item.deterministic_vs_ai.divergence_codes.length > 0).length,
    },
    cases,
    zero_effects: {
      shadow_messages_sent: 0,
      real_actions_executed: 0,
      official_state_writes: 0,
      production_deploys: 0,
      action_executor_loaded: false,
      production_adapter_loaded: false,
      network_allowlist: ["generativelanguage.googleapis.com"],
      would_call_only: true,
    },
  };
  if (result.provider.llm_valid_count < 1) throw new Error("real AI provider produced no valid structured result");
  if (cases.some((item) => item.ai.actions_executed_real.length || item.ai.claims.length)) {
    throw new Error("shadow result contains an executed action or unverified claim");
  }
  await privateWrite(options.output, result);
  console.log(canonicalJson({
    cases: cases.length,
    provider: result.provider,
    comparison: result.comparison,
    zero_effects: result.zero_effects,
  }));
}

if (import.meta.main) await main();
