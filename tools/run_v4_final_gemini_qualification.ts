import { ControlledLlmAdapter, type AdapterObservation, type LanguageInterpreter } from "../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../santana-conversation-domain/runtime/adapter/network.ts";
import { buildPrompt } from "../santana-conversation-domain/runtime/adapter/prompt.ts";
import { assertStrictInterpretation } from "../santana-conversation-domain/runtime/adapter/schema.ts";
import type { Interpretation } from "../santana-conversation-domain/runtime/interpreter/types.ts";
import { assertNoAuthorityEscalation } from "../santana-conversation-domain/runtime/interpreter/guard.ts";
import { toConversationEvents } from "../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { processOfficialTurn, type RuntimeInbound, type RuntimeTurnResult } from "../santana-conversation-domain/runtime/official_turn_service.ts";
import { OfficialSupabaseRest } from "../edge-functions/_shared/official-rest.ts";
import { SupabaseRuntimeStore } from "../edge-functions/_shared/official-runtime-store.ts";
import { canonicalJson, sha256 } from "../santana-conversation-domain/runtime/server_transition.ts";
import { GEMINI_MODEL, GeminiBenchmarkProvider } from "../santana-conversation-domain/benchmark/gemini_provider.ts";

const PROJECT_REF = "vpinclyspbcrxazmnrie";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const LAB_SERVICE_KEY = Deno.env.get("SANA_V4_RUNTIME_SERVICE_KEY") ?? "";
const ACCESS_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
if (!LAB_SERVICE_KEY || !ACCESS_TOKEN || !GEMINI_API_KEY) throw new Error("qualification credentials are not configured");

type Matrix = { matrix_version: string; runtime_commit: string; provider: string; model: string; generation_config: Record<string, unknown>; conversations: Array<{ id: string; category: string; turns: string[]; adversarial?: boolean }> };
const matrix = JSON.parse(await Deno.readTextFile(new URL("./v4-final-gemini-matrix.json", import.meta.url))) as Matrix;
const matrixHash = await sha256(canonicalJson(matrix));
if (matrix.runtime_commit !== "5c78aa81e8eb437fbea53965861264683f97990e") throw new Error("matrix/runtime commit mismatch");

const schema = JSON.parse(await Deno.readTextFile(new URL("../santana-conversation-domain/runtime/interpretation.schema.json", import.meta.url))) as Record<string, unknown>;
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (Array.isArray(source.type)) {
    const { type, ...rest } = source;
    return { anyOf: type.map((entry) => geminiSchema({ ...rest, type: entry })) };
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "$schema" || key === "minLength") continue;
    if (key === "const") { result.enum = [child]; continue; }
    result[key] = geminiSchema(child);
  }
  return result;
}

const provider = new GeminiBenchmarkProvider(GEMINI_MODEL, GEMINI_API_KEY, geminiSchema(schema) as Record<string, unknown>);
const rest = new OfficialSupabaseRest({ url: SUPABASE_URL, serviceRoleKey: LAB_SERVICE_KEY });
const store = new SupabaseRuntimeStore(rest);
const runId = `v4g-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const contactPrefix = `SANA-V4-GEMINI-${runId}`;
const traces: Array<Record<string, unknown>> = [];
const runtimeTurns: Array<Record<string, unknown>> = [];
const runtimeConversations = new Set<string>();
const statusCounts: Record<string, number> = {};
const fallbackCounts: Record<string, number> = {};
const safety = { authority_escalation: 0, authoritative_fact: 0, invalid_primary: 0, cross_case: 0 };
const durations: number[] = [];
let inputTokens = 0;
let outputTokens = 0;
let retries = 0;
let quota429 = 0;
let http5xx = 0;
let timeouts = 0;
let primaryValid = 0;
let invalidRejected = 0;
let fallbackProvider = 0;
let stopForQuota = false;

function q(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`LAB management query failed (${response.status})`);
  return JSON.parse(await response.text()) as T[];
}
async function cleanup(): Promise<number | null> {
  await sql(`do $$ declare ids uuid[]; begin
    select array_agg(id) into ids from public.support_conversations where contact_name like ${q(contactPrefix + "%")};
    if ids is null then return; end if;
    delete from support_runtime.operator_events where conversation_id=any(ids);
    delete from support_runtime.turn_events where conversation_id=any(ids);
    delete from support_runtime.outbound_queue where conversation_id=any(ids);
    delete from support_runtime.sana_collected_facts where conversation_id=any(ids);
    delete from support_runtime.sana_handoff_requests where conversation_id=any(ids);
    delete from support_runtime.subject_bindings where conversation_id=any(ids);
    delete from support_runtime.attachments where conversation_id=any(ids);
    delete from support_runtime.inbound_receipts where conversation_id=any(ids);
    delete from support_runtime.conversation_state where conversation_id=any(ids);
    delete from public.support_documents where conversation_id=any(ids);
    delete from public.support_service_requests where conversation_id=any(ids);
    delete from public.support_events where conversation_id=any(ids);
    delete from public.support_messages where conversation_id=any(ids);
    delete from public.support_conversations where id=any(ids);
  end $$;`);
  const rows = await sql<{ residue: number }>(`select count(*)::int residue from public.support_conversations where contact_name like ${q(contactPrefix + "%")}`);
  return rows[0]?.residue ?? null;
}

class GeminiTraceInterpreter implements LanguageInterpreter {
  constructor(private readonly conversationId: string, private readonly matrixId: string, private readonly turnNumber: number) {}
  async interpret(input: Parameters<LanguageInterpreter["interpret"]>[0]): Promise<Interpretation> {
    const trace: Record<string, unknown> = {
      matrix_id: this.matrixId,
      conversation_id: this.conversationId,
      turn: this.turnNumber,
      input: { message_id: input.message_id, text: input.text, context: input.context },
      provider: "gemini",
      model: GEMINI_MODEL,
      request_body: null,
      response_body: null,
      http_status: null,
      retry_count: 0,
      provider_output: null,
      interpretation: null,
      validation: null,
      observation: null,
    };
    const adapter = new ControlledLlmAdapter({
      enabled: true,
      timeoutMs: 30000,
      provider,
      network: async (request, signal) => {
        trace.request_body = JSON.parse(request.body);
        const response = await fetchBoundary(request, signal);
        trace.http_status = response.status;
        trace.response_body = response.body;
        statusCounts[String(response.status)] = (statusCounts[String(response.status)] ?? 0) + 1;
        if (response.status === 429) { quota429++; stopForQuota = true; }
        if (response.status >= 500 && response.status <= 599) http5xx++;
        const usage = provider.usageFromResponse(response.body);
        if (usage) { inputTokens += usage.input_tokens; outputTokens += usage.output_tokens; }
        try { trace.provider_output = provider.extractText(response.body); } catch { /* preserved raw body is authoritative */ }
        return response;
      },
      observe: (event: AdapterObservation) => {
        trace.observation = event;
        durations.push(event.duration_ms);
        if (event.outcome === "llm_valid") primaryValid++;
        else {
          fallbackCounts[event.outcome] = (fallbackCounts[event.outcome] ?? 0) + 1;
          if (event.outcome === "fallback_invalid") invalidRejected++;
          else fallbackProvider++;
          if (event.outcome === "fallback_timeout") timeouts++;
        }
      },
    });
    const result = await adapter.interpret(input);
    trace.interpretation = result;
    const observation = trace.observation as AdapterObservation | null;
    if (observation?.outcome === "llm_valid") {
      try {
        assertStrictInterpretation(result);
        assertNoAuthorityEscalation(result);
        toConversationEvents(result);
        trace.validation = { status: "accepted", fact_boundary: "PASS", reducer_boundary: "PASS" };
      } catch (error) {
        safety.invalid_primary++;
        trace.validation = { status: "rejected", fact_boundary: "FAIL", reason: error instanceof Error ? error.message : "validation failure" };
      }
      if (result.facts.some((fact) => fact.source !== "USER_EXPLICIT" && fact.source !== "USER_CORRECTION")) safety.authority_escalation++;
    } else {
      trace.validation = { status: "provider_output_rejected_or_unavailable", fallback_used: true };
    }
    traces.push(trace);
    return result;
  }
}

async function deliver(outboxId: string | null, label: string) {
  if (!outboxId) return;
  const claimed = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: outboxId });
  if (claimed.claimed === true) {
    await rest.rpc<boolean>("support_runtime_complete_delivery", { p_outbox_id: outboxId, p_external_message_id: `synthetic-${runId}-${label}` });
  }
}

let status: "PASS" | "BLOCKED" = "PASS";
let failure: string | null = null;
let evidence: Array<Record<string, unknown>> = [];
try {
  await cleanup();
  for (let conversationIndex = 0; conversationIndex < matrix.conversations.length; conversationIndex++) {
    const conversation = matrix.conversations[conversationIndex]!;
    const phone = `+551196${String(3000000 + conversationIndex).padStart(7, "0")}`;
    let conversationId: string | null = null;
    for (let turnNumber = 0; turnNumber < conversation.turns.length; turnNumber++) {
      if (stopForQuota) break;
      const body = conversation.turns[turnNumber]!;
      const interpreter = new GeminiTraceInterpreter(conversationId ?? "pending", conversation.id, turnNumber + 1);
      const inbound: RuntimeInbound = {
        external_message_id: `${runId}-${conversation.id}-${turnNumber + 1}`,
        phone_e164: phone,
        contact_name: `${contactPrefix}-${conversation.id}`,
        body,
        message_type: "text",
        metadata: { lab_only: true, qualification_run_id: runId, matrix_id: conversation.id, turn: turnNumber + 1 },
      };
      const result: RuntimeTurnResult = await processOfficialTurn(inbound, store, interpreter, { automatic_replies_allowed: true });
      conversationId ??= result.conversation_id;
      runtimeConversations.add(result.conversation_id);
      runtimeTurns.push({ matrix_id: conversation.id, turn: turnNumber + 1, body, runtime: result });
      await deliver(result.outbox_id, `${conversation.id}-${turnNumber + 1}`);
    }
  }
  evidence = await sql<Record<string, unknown>>(`select c.id conversation_id,c.contact_name,c.automation_mode,s.revision,s.state,
    (select jsonb_agg(jsonb_build_object('status',r.status,'external_message_id',r.external_message_id) order by r.created_at) from support_runtime.inbound_receipts r where r.conversation_id=c.id) receipts,
    (select jsonb_agg(jsonb_build_object('revision',e.revision,'event_kind',e.event_kind,'outbox_id',e.outbox_id) order by e.revision) from support_runtime.turn_events e where e.conversation_id=c.id) events,
    (select jsonb_agg(jsonb_build_object('outbox_id',o.outbox_id,'status',o.status,'attempts',o.attempts) order by o.created_at) from support_runtime.outbound_queue o where o.conversation_id=c.id) outbox
    from public.support_conversations c join support_runtime.conversation_state s on s.conversation_id=c.id
    where c.contact_name like ${q(contactPrefix + "%")} order by c.contact_name`);
  if (quota429 > 0) { status = "BLOCKED"; failure = "429 provider quota response"; }
  if (primaryValid === 0) { status = "BLOCKED"; failure = "no PRIMARY GEMINI SUCCESS"; }
  if (safety.authority_escalation > 0 || safety.invalid_primary > 0) { status = "BLOCKED"; failure = "Gemini output crossed validation/fact boundary"; }
} catch (error) {
  status = "BLOCKED";
  failure = error instanceof Error ? error.message : String(error);
} finally {
  const residue = await cleanup();
  const report = {
    artifact: "SANA V4 FINAL GEMINI QUALIFICATION",
    run_id: runId,
    runtime_commit: "5c78aa81e8eb437fbea53965861264683f97990e",
    matrix_version: matrix.matrix_version,
    matrix_sha256: matrixHash,
    matrix_conversations: matrix.conversations.length,
    matrix_turns: matrix.conversations.reduce((sum, item) => sum + item.turns.length, 0),
    model: GEMINI_MODEL,
    generation_config: matrix.generation_config,
    status,
    failure,
    primary_gemini_success: primaryValid,
    gemini_invalid_rejected: invalidRejected,
    fallback_counts: fallbackCounts,
    fallback_provider: fallbackProvider,
    http_status_counts: statusCounts,
    http_429: quota429,
    http_5xx: http5xx,
    timeouts,
    retries,
    tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    latency_ms: { calls: durations.length, mean: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0, p95: durations.length ? [...durations].sort((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1] : 0 },
    estimated_cost_usd: (inputTokens * 0.30 + outputTokens * 2.50) / 1_000_000,
    safety,
    runtime: { turns: runtimeTurns, conversations: runtimeConversations.size, evidence, residue, whatsapp_messages_sent: 0 },
    raw_calls: traces,
    production_changes: "NONE",
    generated_at: new Date().toISOString(),
  };
  await Deno.mkdir("lab-checkpoints", { recursive: true });
  await Deno.writeTextFile("lab-checkpoints/SANA-V4-FINAL-GEMINI-QUALIFICATION.json", JSON.stringify(report, null, 2) + "\n");
}

console.log(JSON.stringify({ status, failure, matrix: matrix.conversations.length, calls: traces.length, primary_gemini_success: primaryValid, invalid_rejected: invalidRejected, fallback_provider: fallbackProvider, http_429: quota429, http_5xx: http5xx, retries, tokens: { input: inputTokens, output: outputTokens }, estimated_cost_usd: (inputTokens * 0.30 + outputTokens * 2.50) / 1_000_000, run_id: runId }));
if (status !== "PASS") Deno.exit(1);
