/**
 * Offline, no-effects shadow runner.
 *
 * Real message text is accepted only over stdin and never persisted. The runner
 * imports only the two isolated Phase 17 runtimes and the local durable store.
 */
import { runCurrentWorkflowLabCase } from "../../phase17/current-adapter/mod.ts";
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import { MotorV2Runtime } from "../../santana-conversation-domain/motor-v2/runtime.ts";
import { sha256 } from "../../santana-conversation-domain/runtime/server_transition.ts";
import { understandMessages } from "../../santana-conversation-domain/motor-v2/understanding.ts";
import type {
  AdministrativeGaps,
  MotorV2LabResult,
  MotorV2Message,
  SeededFact,
  SeededTrack,
} from "../../santana-conversation-domain/motor-v2/types.ts";
import { DurableShadowStore } from "./store.ts";
import type { ReplyFeatures, ShadowComparisonRecord, ShadowEngineProjection, ShadowInputEnvelope } from "./types.ts";
import { proposedCalls } from "./would_call.ts";

interface Options {
  mode: "OFF" | "OFFLINE_REPLAY";
  storeDir: string | null;
  cohortId: string | null;
  cohortHash: string | null;
  maxCases: number | null;
}

const SAFE_STORE_PATH = /^phase18\/run\/store-[a-z0-9-]+$/;

const JOURNEYS_BY_INTENT: Record<string, string> = {
  SEPULTAMENTO: "FUNERARIO_IMEDIATO",
  CONTINGENCIA_FUNERARIA_POR_RAMIFICACAO: "FUNERARIO_IMEDIATO",
  ALTERNATIVA_TEMPORARIA_DE_SEPULTAMENTO: "FUNERARIO_IMEDIATO",
  EXUMACAO: "RESTOS_MORTAIS",
  RETIRAR_RESTOS: "RESTOS_MORTAIS",
  DESTINO_OSSUARIO: "RESTOS_MORTAIS",
  DESTINO_RESTOS: "RESTOS_MORTAIS",
  CREMACAO: "RESTOS_MORTAIS",
  RENOVACAO_OSSUARIO: "RESTOS_MORTAIS",
  DIVERGENCIA_FISICO_CADASTRAL: "RESTOS_MORTAIS",
  RESTOS_NAO_ESPERADOS: "RESTOS_MORTAIS",
  LAPIDE_PLACA: "JAZIGO_ESPACO_FISICO",
  LIMPEZA_ZELADORIA: "JAZIGO_ESPACO_FISICO",
  OBRA_REFORMA: "JAZIGO_ESPACO_FISICO",
  IDENTIFICAR_REFERENCIA: "JAZIGO_ESPACO_FISICO",
  RECADASTRO: "DIREITOS_CADASTRO",
  CONCESSAO: "DIREITOS_CADASTRO",
  SUCESSAO: "DIREITOS_CADASTRO",
  ADMINISTRACAO_PROVISORIA: "DIREITOS_CADASTRO",
  TRANSFERENCIA: "DIREITOS_CADASTRO",
  NAO_ASSUNCAO_RESPONSABILIDADE: "DIREITOS_CADASTRO",
  DESISTENCIA_DIREITO_USO: "DIREITOS_CADASTRO",
  CONFLITO_CADASTRAL_DOCUMENTO_LEGADO: "DIREITOS_CADASTRO",
  RECLAMACAO_SEM_RETORNO: "SUPORTE_RECLAMACAO",
  RECLAMACAO_OPERACIONAL: "SUPORTE_RECLAMACAO",
  SUPORTE_DOCUMENTAL: "SUPORTE_RECLAMACAO",
  CORRECAO_DE_AGENDAMENTO: "AGENDAMENTO",
  RECUPERACAO_APOS_FALHA_DE_PAGAMENTO: "PAGAMENTO",
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    values.set(key.slice(2), value);
  }
  const mode = values.get("mode") ?? "OFF";
  if (mode !== "OFF" && mode !== "OFFLINE_REPLAY") throw new Error("shadow mode must be OFF or OFFLINE_REPLAY");
  const max = values.has("max-cases") ? Number(values.get("max-cases")) : null;
  if (max !== null && (!Number.isInteger(max) || max < 1)) throw new Error("invalid --max-cases");
  return {
    mode,
    storeDir: values.get("store-dir") ?? null,
    cohortId: values.get("cohort-id") ?? null,
    cohortHash: values.get("cohort-hash") ?? null,
    maxCases: max,
  };
}

async function readLines(): Promise<string[]> {
  const source = await new Response(Deno.stdin.readable).text();
  return source.split(/\r?\n/).filter((line) => line.trim());
}

function assertEnvelope(input: ShadowInputEnvelope, options: Options): void {
  if (input.schema_version !== "phase18-shadow-input/1.2.0" || input.mode !== "OFFLINE_REPLAY") {
    throw new Error("invalid shadow input schema or mode");
  }
  if (input.cohort_id !== options.cohortId || input.cohort_hash !== options.cohortHash) {
    throw new Error("shadow cohort identity mismatch");
  }
  if (!/^[a-z0-9_]{8,160}$/.test(input.event_id) || !/^episode_[a-f0-9]{24}$/.test(input.episode_id)) {
    throw new Error("invalid pseudonymous shadow identity");
  }
  if (!/^[a-f0-9]{64}$/.test(input.source_snapshot_sha256)) throw new Error("invalid source hash");
  if (
    !input.messages.length || input.messages.length > 200 || !input.messages.some((message) => message.role === "user")
  ) {
    throw new Error("invalid complete episode message set");
  }
  if (input.messages.at(-1)?.role !== "user") throw new Error("shadow decision input must end at a user turn");
  if (!Array.isArray(input.observed_followup_messages)) throw new Error("observed follow-up must be an array");
  if (input.observed_followup_messages.some((message) => message.role !== "assistant")) {
    throw new Error("observed follow-up may contain assistant messages only");
  }
  if (input.messages.length + input.observed_followup_messages.length > 200) {
    throw new Error("shadow episode exceeds safety bounds");
  }
  if (
    !Number.isInteger(input.source_episode_message_count) ||
    input.source_episode_message_count < input.messages.length + input.observed_followup_messages.length ||
    input.source_episode_message_count > 200
  ) {
    throw new Error("invalid shadow source episode size");
  }
  if (
    Number.isNaN(Date.parse(input.decision_at)) ||
    Date.parse(input.decision_at) < Date.parse(input.started_at) ||
    Date.parse(input.decision_at) > Date.parse(input.ended_at)
  ) {
    throw new Error("shadow decision timestamp outside episode interval");
  }
}

async function replyFeatures(reply: string): Promise<ReplyFeatures> {
  const normalized = reply.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  return {
    sha256: await sha256(reply),
    characters: reply.length,
    question_count: (reply.match(/\?/g) ?? []).length,
    menu_signal: /escolha|selecione|digite|menu|opcao/.test(normalized),
    completion_claim_signal:
      /(?:pagamento|agendamento|documento|servico|execucao).{0,50}(?:confirmad|concluid|aprovad)/.test(normalized) &&
      !/(?:nao|ainda nao|sem).{0,30}(?:confirmad|concluid|aprovad)/.test(normalized),
  };
}

async function currentProjection(
  result: Awaited<ReturnType<typeof runCurrentWorkflowLabCase>>,
): Promise<ShadowEngineProjection> {
  const first = new Set(result.audit.turns[0]?.classification.goal_codes ?? []);
  const intentChanged = result.audit.turns.slice(1).some((turn) =>
    turn.classification.goal_codes.some((goal) => !first.has(goal))
  );
  const journeys = unique(
    result.trace.recognized_intents.map((intent) => JOURNEYS_BY_INTENT[intent]).filter(
      (journey): journey is string => journey !== undefined,
    ),
  );
  return {
    engine: "current-workflow/role-aware-v1",
    recognized_intents: result.trace.recognized_intents,
    journeys,
    transverse_states: [
      ...(result.trace.recognized_intents.length > 1 ? ["MULTI_INTENT"] : []),
      ...(intentChanged ? ["INTENT_CHANGED"] : []),
    ],
    intent_changed: intentChanged,
    risk_level: "unmodeled",
    risk_signals: [],
    reused_fact_keys: result.trace.reused_fact_keys,
    asked_fact_keys: result.trace.asked_fact_keys,
    actions_proposed: result.trace.actions,
    actions_executed_real: [],
    claim_codes: result.trace.claims.map((claim) => claim.claim_code),
    blocked_claim_codes: [],
    current_policy_refs: [],
    policy_gaps: [],
    handoff: result.trace.handoff,
    would_call: [],
    receipts_required: [],
    receipts_observed: [],
    tracks: result.trace.final_track_states,
    case_closed: result.trace.case_closed,
    closure_basis: result.trace.closure_basis,
    reply: await replyFeatures(result.trace.reply),
    latency_ms: result.metrics.total_duration_ms,
    provider: null,
  };
}

async function v2Projection(result: MotorV2LabResult): Promise<ShadowEngineProjection> {
  return {
    engine: "motor-v2/offline-shadow",
    recognized_intents: result.trace.recognized_intents,
    journeys: result.state.understanding.journeys,
    transverse_states: result.state.understanding.transverse_states,
    intent_changed: result.state.understanding.intent_changed,
    risk_level: result.state.understanding.risk.level,
    risk_signals: result.state.understanding.risk.signals,
    reused_fact_keys: result.trace.reused_fact_keys,
    asked_fact_keys: result.trace.asked_fact_keys,
    actions_proposed: result.trace.actions,
    actions_executed_real: [],
    claim_codes: result.trace.claims.map((claim) => claim.claim_code),
    blocked_claim_codes: result.state.policy.blocked_claims,
    current_policy_refs: result.state.policy.current_policy_refs,
    policy_gaps: result.state.policy.policy_gaps,
    handoff: result.trace.handoff,
    would_call: await proposedCalls(result),
    receipts_required: result.state.policy.required_receipt_types,
    receipts_observed: [],
    tracks: result.trace.final_track_states,
    case_closed: result.trace.case_closed,
    closure_basis: result.trace.closure_basis,
    reply: await replyFeatures(result.trace.reply),
    latency_ms: result.metrics.duration_ms,
    provider: result.provider,
  };
}

interface DerivedShadowContext {
  knownFacts: SeededFact[];
  doNotAskAgain: string[];
  tracks: SeededTrack[];
  gaps: AdministrativeGaps;
}

function firstUserMatch(messages: readonly MotorV2Message[], pattern: RegExp): MotorV2Message | undefined {
  return messages.find((message) =>
    message.role === "user" && pattern.test(
      message.content.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR"),
    )
  );
}

function deriveShadowContext(messages: readonly MotorV2Message[]): DerivedShadowContext {
  const facts: Array<[string, RegExp]> = [
    ["reference_already_provided", /\b(?:quadra|terreno|gaveta|rua)\b|referencia.{0,30}(?:informad|enviad)/],
    ["family_relation_declared", /\b(?:familia|familiar|filh[oa]|net[oa]|irma[oa]|espos[oa]|viuv[oa]|mae|pai)\b/],
    ["destination_already_provided", /\b(?:ossuario|ossario|cremacao|cremar|traslado|reinumacao|reinumar)\b/],
    ["prior_contact_declared", /\b(?:contato anterior|ja (?:falei|informei|enviei)|sem retorno|sem resposta)\b/],
    ["schedule_status_provided", /\b(?:agendad[oa]|agendamento confirmad[oa])\b/],
  ];
  const knownFacts: SeededFact[] = [];
  for (const [key, pattern] of facts) {
    const source = firstUserMatch(messages, pattern);
    if (source) knownFacts.push({ key, value: true, source_turn: source.turn_id, status: "user_provided" });
  }

  const understanding = understandMessages(messages);
  const tracks = understanding.journeys.filter((journey) => journey !== "DESCONHECIDA_AMBIGUA").map((journey) => ({
    track_id: `journey_${journey.toLocaleLowerCase("pt-BR")}`,
    label: journey,
    status: "active" as const,
  }));
  if (!tracks.length) tracks.push({ track_id: "journey_unknown", label: "DESCONHECIDA_AMBIGUA", status: "active" });

  const userText = (messages.filter((message) => message.role === "user").at(-1)?.content ?? "")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  const requires = (pattern: RegExp) =>
    pattern.test(userText) ? "requires_current_policy" as const : "unknown" as const;
  const gaps: AdministrativeGaps = {
    current_deadline: requires(/\b(?:prazo|quantos? dias|quanto tempo|demora)\b/),
    current_value: requires(/\b(?:valor|preco|pagamento|pagar|pix|boleto|cartao)\b/),
    current_documents: requires(/\b(?:documento|certidao|declaracao|comprovante|assinatura)\b/),
    family_authorization: requires(/\b(?:autoriza|anuencia|todos os herdeiros|conflito familiar)\b/),
    current_schedule: requires(/\b(?:agenda|agendar|horario|data disponivel)\b/),
    eligibility: requires(/\b(?:direito|elegibilidade|pode (?:fazer|solicitar)|titularidade)\b/),
    current_procedure: requires(
      /\b(?:procedimento|como (?:faco|fazer|solicito)|o que preciso fazer|proximo passo|falar com (?:um |uma )?atendente)\b/,
    ),
  };
  return { knownFacts, doNotAskAgain: knownFacts.map((fact) => fact.key), tracks, gaps };
}

function divergences(
  reference: ShadowInputEnvelope["reference"],
  current: ShadowEngineProjection,
  v2: ShadowEngineProjection,
): string[] {
  const codes: string[] = [];
  const currentJourneys = new Set(current.journeys);
  const v2Journeys = new Set(v2.journeys);
  if (canonicalJson([...currentJourneys].sort()) !== canonicalJson([...v2Journeys].sort())) {
    codes.push("ENGINE_JOURNEY_DISAGREEMENT");
  }
  if (reference.journeys.some((journey) => !currentJourneys.has(journey))) {
    codes.push("CURRENT_MISSED_REFERENCE_JOURNEY");
  }
  if (
    reference.journeys.some((journey) => journey !== "DESCONHECIDA_AMBIGUA" && !v2Journeys.has(journey))
  ) codes.push("V2_MISSED_REFERENCE_JOURNEY");
  if (reference.multi_intent !== v2.transverse_states.includes("MULTI_INTENT")) {
    codes.push("V2_MULTI_INTENT_DISAGREEMENT");
  }
  if (reference.intent_changed !== v2.intent_changed) codes.push("V2_INTENT_CHANGE_DISAGREEMENT");
  if (current.handoff.offered !== v2.handoff.offered) {
    codes.push(current.handoff.offered ? "CURRENT_ONLY_HANDOFF" : "V2_ONLY_HANDOFF");
  }
  if (v2.risk_level === "P0" && !current.handoff.offered) codes.push("V2_P0_CURRENT_NO_HANDOFF");
  if (v2.risk_level === "P0" && !v2.handoff.offered) codes.push("V2_P0_HANDOFF_MISSING");
  if (v2.reply.completion_claim_signal && v2.receipts_observed.length === 0) {
    codes.push("V2_PREMATURE_COMPLETION_SIGNAL");
  }
  if (v2.would_call.some((call) => call.effect_permitted !== false)) codes.push("V2_EFFECT_PATH_PRESENT");
  return unique(codes);
}

function candidateEvidence(codes: readonly string[], reference: ShadowInputEnvelope["reference"]): string[] {
  return unique([
    ...codes.filter((code) =>
      [
        "ENGINE_JOURNEY_DISAGREEMENT",
        "V2_P0_CURRENT_NO_HANDOFF",
        "CURRENT_ONLY_HANDOFF",
        "V2_ONLY_HANDOFF",
        "V2_MULTI_INTENT_DISAGREEMENT",
        "V2_INTENT_CHANGE_DISAGREEMENT",
        "V2_PREMATURE_COMPLETION_SIGNAL",
      ].includes(code)
    ),
    ...(reference.risk_flags.length ? ["HEURISTIC_SENSITIVE_SIGNAL_REQUIRES_OFFLINE_ADJUDICATION"] : []),
  ]);
}

function assertNoPersistedSensitiveContent(record: ShadowComparisonRecord): void {
  const forbidden: Array<[string, RegExp]> = [
    ["url", /https?:\/\//i],
    ["jid", /@(?:s\.whatsapp\.net|lid)\b/i],
    ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ["cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    ["formatted_phone", /(?:\+55[ .()-]*|\(\d{2}\)[ .-]*)9?\d{4}[ .-]?\d{4}/],
    ["unformatted_phone", /(^|\D)\d{10,13}(\D|$)/],
  ];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      // Cryptographic and pseudonymous identity fields are validated by their
      // own closed schemas and must not be interpreted as contact numbers.
      const leaf = path.split(".").at(-1) ?? "";
      if (/(?:^|_)(?:sha256|hash|id|ids|ref|refs)$/.test(leaf)) return;
      for (const [kind, pattern] of forbidden) {
        if (pattern.test(value)) throw new Error(`privacy validation rejected ${kind} at ${path}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(record, "record");
}

async function evaluate(input: ShadowInputEnvelope, inputHash: string): Promise<ShadowComparisonRecord> {
  const caseHash = await sha256(`${input.cohort_hash}:${input.event_id}`);
  const currentResult = await runCurrentWorkflowLabCase({
    caseId: input.event_id,
    caseHash,
    fixedClock: { instant: input.decision_at, timezone: "America/Sao_Paulo" },
    mode: "role-aware-v1",
    messages: input.messages.map((message) => ({
      turnId: message.turn_id,
      role: message.role,
      content: message.content,
    })),
  });
  const shadowContext = deriveShadowContext(input.messages);
  const runtime = new MotorV2Runtime();
  const v2Result = await runtime.runLabCase({
    case_id: input.event_id,
    conversation_id: `shadow_conversation_${caseHash.slice(0, 20)}`,
    inbound_id: `shadow_inbound_${caseHash.slice(20, 40)}`,
    messages: input.messages,
    known_facts: shadowContext.knownFacts,
    do_not_ask_again: shadowContext.doNotAskAgain,
    track_states: shadowContext.tracks,
    administrative_gaps: shadowContext.gaps,
    fixed_clock: { instant: input.decision_at, timezone: "America/Sao_Paulo" },
  });
  const current = await currentProjection(currentResult);
  const v2 = await v2Projection(v2Result);
  const divergenceCodes = divergences(input.reference, current, v2);
  const inbound = input.messages.filter((message) => message.role === "user").length;
  const outbound = input.messages.length - inbound;
  const outboundMessages = input.observed_followup_messages;
  const normalized = outboundMessages.map((message) => message.content).join("\n").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  const lastOutbound = outboundMessages.at(-1);
  const lastOutboundFeatures = lastOutbound ? await replyFeatures(lastOutbound.content) : null;
  const record: ShadowComparisonRecord = {
    schema_version: "phase18-shadow-record/1.2.0",
    mode: "OFFLINE_REPLAY",
    event_id: input.event_id,
    episode_id: input.episode_id,
    input_hash: inputHash,
    cohort_id: input.cohort_id,
    cohort_hash: input.cohort_hash,
    source_snapshot_sha256: input.source_snapshot_sha256,
    started_at: input.started_at,
    ended_at: input.ended_at,
    decision_at: input.decision_at,
    decision_input_message_count: input.messages.length,
    observed_followup_count: input.observed_followup_messages.length,
    post_observation_tail_count: input.source_episode_message_count - input.messages.length -
      input.observed_followup_messages.length,
    source_message_count: input.source_episode_message_count,
    reference: input.reference,
    observed_current: {
      inbound_count: inbound,
      outbound_count: outbound,
      last_direction: input.observed_followup_messages.length ? "outbound" : "inbound",
      observed_handoff_signal: /encaminh|administracao|setor responsavel|equipe responsavel|aguard.{0,30}retorno/.test(
        normalized,
      ),
      observed_menu_signal: /escolha|selecione|digite|menu|opcao/.test(normalized),
      observed_completion_claim_signal: lastOutboundFeatures?.completion_claim_signal ?? false,
      last_outbound_reply: lastOutboundFeatures,
      raw_content_persisted: false,
    },
    current_workflow_replay: current,
    motor_v2_shadow: v2,
    divergence_codes: divergenceCodes,
    candidate_evidence: candidateEvidence(divergenceCodes, input.reference),
    zero_effects: {
      network_allowed: false,
      production_adapters_loaded: false,
      real_messages_sent: 0,
      real_tools_executed: 0,
      official_state_writes: 0,
      simulated_current_outbox_only: true,
    },
    provenance: {
      input_source: "immutable_whatsapp_snapshot",
      current_result_kind: "isolated_current_workflow_replay",
      v2_result_kind: "offline_shadow_proposal",
      reference_kind: "unreviewed_window_aligned_heuristic_candidate_evidence",
    },
  };
  assertNoPersistedSensitiveContent(record);
  return record;
}

async function main(): Promise<void> {
  const options = parseOptions(Deno.args);
  if (options.mode === "OFF") {
    console.log(JSON.stringify({ status: "OFF", processed: 0, persisted: 0, real_effects: 0 }));
    return;
  }
  if (!options.storeDir || !options.cohortId || !options.cohortHash) throw new Error("store/cohort arguments required");
  if (!SAFE_STORE_PATH.test(options.storeDir)) throw new Error("shadow store must remain under phase18/run/store-*");
  const store = await DurableShadowStore.open(options.storeDir, options.cohortId, options.cohortHash);
  let processed = 0;
  let duplicates = 0;
  for (const line of await readLines()) {
    if (options.maxCases !== null && processed >= options.maxCases) break;
    const input = JSON.parse(line) as ShadowInputEnvelope;
    assertEnvelope(input, options);
    const inputHash = await sha256(canonicalJson(input));
    const existing = await store.get(input.event_id);
    if (existing) {
      if (existing.input_hash !== inputHash) throw new Error("shadow event id reused with different content");
      duplicates += 1;
      processed += 1;
      continue;
    }
    const result = await evaluate(input, inputHash);
    await store.commit(input.event_id, inputHash, result, input.ended_at);
    processed += 1;
  }
  const checkpoint = await store.checkpoint();
  console.log(JSON.stringify({
    status: "COMPLETED",
    mode: options.mode,
    processed,
    duplicates,
    persisted: checkpoint.completed_count,
    checkpoint_rebuilt: checkpoint.rebuilt_from_records,
    real_messages_sent: 0,
    real_tools_executed: 0,
    official_state_writes: 0,
  }));
}

if (import.meta.main) await main();
