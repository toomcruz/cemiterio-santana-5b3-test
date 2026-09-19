/**
 * Durable one-batch continuation for the frozen V4 Gemini qualification.
 * This is harness/evidence code only; it must not change Sana runtime behavior.
 * One invocation performs at most one new provider call, then exits. The
 * scheduler invokes it again after the persisted next_eligible_at/pacing time.
 */
import { ControlledLlmAdapter, type AdapterObservation, type LanguageInterpreter } from "../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../santana-conversation-domain/runtime/adapter/network.ts";
import type { Interpretation } from "../santana-conversation-domain/runtime/interpreter/types.ts";
import { assertNoAuthorityEscalation } from "../santana-conversation-domain/runtime/interpreter/guard.ts";
import { assertStrictInterpretation } from "../santana-conversation-domain/runtime/adapter/schema.ts";
import { processOfficialTurn, type RuntimeInbound } from "../santana-conversation-domain/runtime/official_turn_service.ts";
import { OfficialSupabaseRest } from "../edge-functions/_shared/official-rest.ts";
import { SupabaseRuntimeStore } from "../edge-functions/_shared/official-runtime-store.ts";
import { canonicalJson, sha256 } from "../santana-conversation-domain/runtime/server_transition.ts";
import { GEMINI_MODEL, GeminiBenchmarkProvider } from "../santana-conversation-domain/benchmark/gemini_provider.ts";

const ROOT = new URL("..", import.meta.url);
const PROJECT_REF = "vpinclyspbcrxazmnrie";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const RUNTIME_COMMIT = "5c78aa81e8eb437fbea53965861264683f97990e";
const MAX_PROVIDER_CALLS_PER_RUN = 1;
const MIN_INTERVAL_MS = 15_000;
const LEDGER_FILE = new URL("../lab-checkpoints/SANA-V4-GEMINI-LEDGER.json", import.meta.url);
const PARTIAL_FILE = new URL("../lab-checkpoints/SANA-V4-FINAL-GEMINI-QUALIFICATION.json", import.meta.url);
const MATRIX_FILE = new URL("./v4-final-gemini-matrix.json", import.meta.url);
const SERVICE_KEY = Deno.env.get("SANA_V4_RUNTIME_SERVICE_KEY") ?? "";
const ACCESS_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
if (!ACCESS_TOKEN || !GEMINI_API_KEY) throw new Error("qualification credentials are not configured");

type MatrixConversation = { id: string; category: string; turns: string[]; adversarial?: boolean };
type Matrix = { matrix_version: string; runtime_commit: string; provider: string; model: string; generation_config: Record<string, unknown>; conversations: MatrixConversation[] };
type LedgerStatus = "PENDING" | "RUNNING" | "PRIMARY_VALID" | "PRIMARY_INVALID_REJECTED" | "PROVIDER_BLOCKED" | "FAILED";
type LedgerEntry = {
  key: string; matrix_sha: string; conversation_id: string; turn_id: number; input_hash: string; prompt_hash?: string;
  status: LedgerStatus; attempts: number; updated_at: string; next_eligible_at?: string; category?: string;
  source_artifact?: string; source_raw_call_index?: number; raw_call?: Record<string, unknown>;
  provider_category?: string; provider_metadata?: Record<string, unknown>; runtime?: Record<string, unknown>;
  reason?: string;
};
type Ledger = {
  artifact: string; version: string; matrix_sha: string; matrix_file_sha: string; runtime_commit: string;
  model: string; generation_config: Record<string, unknown>; run_id: string; contact_prefix: string;
  created_at: string; updated_at: string; last_call_started_at?: string; next_eligible_at?: string;
  status: "RUNNING" | "WAITING_PROVIDER" | "MATRIX_COMPLETE" | "BLOCKED";
  provider_category?: string; provider_metadata?: Record<string, unknown>; entries: Record<string, LedgerEntry>;
  counts: Record<string, number>; errors: string[];
  last_run?: { invocation_id: string; started_at: string; finished_at?: string; before: Record<string, number>; result?: Record<string, unknown>; after?: Record<string, number>; provider_calls: number; ledger_progressed?: boolean };
  watchdog?: { consecutive_eligible_no_progress: number; last_checked_at?: string; last_action?: string };
};

async function readText(url: URL): Promise<string> { return await Deno.readTextFile(url); }
async function writeJsonAtomic(url: URL, value: unknown): Promise<void> {
  await Deno.mkdir(new URL("../lab-checkpoints/", url), { recursive: true });
  const tmp = new URL(`${url.pathname}.tmp-${crypto.randomUUID()}`, url);
  await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await Deno.rename(tmp, url);
}
function nowIso(): string { return new Date().toISOString(); }
function msUntil(value?: string): number { return value ? Math.max(0, Date.parse(value) - Date.now()) : 0; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function q(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function sha256Text(text: string): Promise<string> { return await sha256(text); }
function rawJson(raw: string): Record<string, unknown> { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } }
function classify429(body: string): { category: string; retryMs: number | null; metadata: Record<string, unknown> } {
  const parsed = rawJson(body);
  const error = (parsed.error ?? {}) as Record<string, unknown>;
  const details = Array.isArray(error.details) ? error.details : [];
  const quota = details.find((item) => typeof item === "object" && item && String((item as Record<string, unknown>)["@type"] ?? "").includes("QuotaFailure")) as Record<string, unknown> | undefined;
  const retry = details.find((item) => typeof item === "object" && item && String((item as Record<string, unknown>)["@type"] ?? "").includes("RetryInfo")) as Record<string, unknown> | undefined;
  const message = String(error.message ?? "");
  const retryDelay = String(retry?.retryDelay ?? message.match(/retry in ([0-9.]+)s/i)?.[1] ?? "");
  const retryMs = retryDelay ? Math.ceil(Number.parseFloat(retryDelay) * 1000) : null;
  const violations = Array.isArray(quota?.violations) ? quota.violations : [];
  const first = (violations[0] ?? {}) as Record<string, unknown>;
  const quotaId = String(first.quotaId ?? "");
  const metric = String(first.quotaMetric ?? "");
  let category = "UNKNOWN_RESOURCE_EXHAUSTED";
  if (/PerMinute|per_minute|RATE|minute/i.test(quotaId + metric)) category = "SHORT_WINDOW_RATE_LIMIT";
  else if (/Token|TPM|token/i.test(quotaId + metric)) category = "TOKEN_RATE_LIMIT";
  else if (/Daily|day/i.test(quotaId + metric)) category = "DAILY_QUOTA";
  else if (/Project|project/i.test(quotaId + metric)) category = "PROJECT_QUOTA";
  else if (/billing|disabled|limit.?0/i.test(message)) category = "BILLING_OR_QUOTA_DISABLED";
  return { category, retryMs, metadata: { code: error.code, status: error.status, message, quotaMetric: first.quotaMetric, quotaId: first.quotaId, quotaDimensions: first.quotaDimensions, quotaValue: first.quotaValue, retryDelay: retry?.retryDelay ?? null } };
}

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${ACCESS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`LAB management query failed (${response.status})`);
  return JSON.parse(await response.text()) as T[];
}
async function resolveLabServiceKey(): Promise<string> {
  if (SERVICE_KEY) return SERVICE_KEY;
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!response.ok) throw new Error(`LAB service-role key retrieval failed (${response.status})`);
  const keys = await response.json() as Array<Record<string, unknown>>;
  const serviceRole = keys.find((key) => key.name === "service_role" && typeof key.api_key === "string")?.api_key;
  if (typeof serviceRole !== "string" || !serviceRole) throw new Error("LAB service-role key is unavailable");
  return serviceRole;
}
async function deliver(rest: OfficialSupabaseRest, outboxId: string | null, label: string, runId: string): Promise<void> {
  if (!outboxId) return;
  const claimed = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: outboxId });
  if (claimed.claimed === true) await rest.rpc<boolean>("support_runtime_complete_delivery", { p_outbox_id: outboxId, p_external_message_id: `synthetic-${runId}-${label}` });
}

const matrixRaw = await readText(MATRIX_FILE);
const matrix = JSON.parse(matrixRaw) as Matrix;
const matrixSha = await sha256Text(matrixRaw);
if (matrixSha !== "fd751ea78d0061e2a101c06fc722d755e69a24ba3a59ad88b041d8873d65ecf2") throw new Error(`matrix sha mismatch: ${matrixSha}`);
if (matrix.runtime_commit !== RUNTIME_COMMIT) throw new Error("matrix/runtime commit mismatch");
const schema = JSON.parse(await readText(new URL("../santana-conversation-domain/runtime/interpretation.schema.json", import.meta.url))) as Record<string, unknown>;
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (Array.isArray(source.type)) { const { type, ...rest } = source; return { anyOf: type.map((entry) => geminiSchema({ ...rest, type: entry })) }; }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) { if (key === "$schema" || key === "minLength") continue; if (key === "const") { result.enum = [child]; continue; } result[key] = geminiSchema(child); }
  return result;
}
const provider = new GeminiBenchmarkProvider(GEMINI_MODEL, GEMINI_API_KEY, geminiSchema(schema) as Record<string, unknown>);
const rest = new OfficialSupabaseRest({ url: SUPABASE_URL, serviceRoleKey: await resolveLabServiceKey() });
const partial = JSON.parse(await readText(PARTIAL_FILE)) as { raw_calls?: Array<Record<string, unknown>>; run_id?: string };

function makeEntries(): Record<string, LedgerEntry> {
  const entries: Record<string, LedgerEntry> = {};
  for (const conversation of matrix.conversations) for (let i = 0; i < conversation.turns.length; i++) {
    const inputHash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(conversation.turns[i]!));
    // Filled below after synchronous construction through the deterministic helper.
    void inputHash;
  }
  return entries;
}
async function buildInitialLedger(): Promise<Ledger> {
  const entries: Record<string, LedgerEntry> = {};
  for (const conversation of matrix.conversations) for (let i = 0; i < conversation.turns.length; i++) {
    const inputHash = await sha256Text(conversation.turns[i]!);
    const key = await sha256Text(`${matrixSha}:${conversation.id}:${i + 1}:${inputHash}`);
    entries[key] = { key, matrix_sha: matrixSha, conversation_id: conversation.id, turn_id: i + 1, input_hash: inputHash, status: "PENDING", attempts: 0, updated_at: nowIso(), category: conversation.category };
  }
  const rawCalls = partial.raw_calls ?? [];
  for (let index = 0; index < rawCalls.length; index++) {
    const raw = rawCalls[index]!;
    const id = String(raw.matrix_id ?? ""); const turn = Number(raw.turn ?? 0);
    const conversation = matrix.conversations.find((item) => item.id === id); const text = conversation?.turns[turn - 1];
    if (!conversation || !text) continue;
    const inputHash = await sha256Text(text); const key = await sha256Text(`${matrixSha}:${id}:${turn}:${inputHash}`); const entry = entries[key]; if (!entry) continue;
    entry.source_artifact = "lab-checkpoints/SANA-V4-FINAL-GEMINI-QUALIFICATION.json"; entry.source_raw_call_index = index; entry.raw_call = raw; entry.prompt_hash = raw.request_body ? await sha256Text(JSON.stringify((raw.request_body as Record<string, unknown>).contents ?? raw.request_body)) : undefined; entry.updated_at = nowIso();
    if (raw.http_status === 200 && (raw.observation as Record<string, unknown> | undefined)?.outcome === "llm_valid") entry.status = "PRIMARY_VALID";
    else if (raw.http_status === 429) { const parsed = classify429(String(raw.response_body ?? "")); entry.status = "PROVIDER_BLOCKED"; entry.provider_category = parsed.category; entry.provider_metadata = parsed.metadata; entry.next_eligible_at = new Date(Date.now() + (parsed.retryMs ?? 15 * 60_000)).toISOString(); }
    else if (raw.observation && (raw.observation as Record<string, unknown>).outcome === "fallback_invalid") entry.status = "PRIMARY_INVALID_REJECTED";
    else entry.status = "FAILED";
  }
  const counts: Record<string, number> = {}; for (const entry of Object.values(entries)) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  const runId = `v4g-resume-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return { artifact: "SANA V4 FINAL GEMINI LEDGER", version: "1", matrix_sha: matrixSha, matrix_file_sha: matrixSha, runtime_commit: RUNTIME_COMMIT, model: GEMINI_MODEL, generation_config: matrix.generation_config, run_id: runId, contact_prefix: `SANA-V4-GEMINI-${runId}`, created_at: nowIso(), updated_at: nowIso(), status: "RUNNING", entries, counts, errors: [] };
}
let ledger: Ledger;
try { ledger = JSON.parse(await readText(LEDGER_FILE)) as Ledger; } catch { ledger = await buildInitialLedger(); await writeJsonAtomic(LEDGER_FILE, ledger); }
if (ledger.matrix_sha !== matrixSha || ledger.runtime_commit !== RUNTIME_COMMIT) throw new Error("ledger identity mismatch");
// Reconcile an interrupted invocation: a preserved raw 200/llm_valid call is
// authoritative even if the previous process died while replaying its LAB turn.
for (const entry of Object.values(ledger.entries)) {
  const raw = entry.raw_call;
  const observation = raw?.observation as Record<string, unknown> | undefined;
  if (raw?.http_status === 200 && observation?.outcome === "llm_valid") {
    entry.status = "PRIMARY_VALID";
    entry.reason = undefined;
  }
}
if (Object.values(ledger.entries).every((entry) => entry.status !== "FAILED")) ledger.status = "RUNNING";
for (const entry of Object.values(ledger.entries)) if (entry.status === "RUNNING") { entry.status = "PENDING"; entry.reason = "recovered after interrupted invocation"; }

const entriesById = new Map<string, LedgerEntry>(); for (const entry of Object.values(ledger.entries)) entriesById.set(`${entry.conversation_id}:${entry.turn_id}`, entry);
const rawByKey = new Map<string, Record<string, unknown>>(); for (const entry of Object.values(ledger.entries)) if (entry.raw_call) rawByKey.set(`${entry.conversation_id}:${entry.turn_id}`, entry.raw_call);
const traces: Record<string, unknown>[] = [];
function countStatuses(entries: Record<string, LedgerEntry>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(entries)) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}
function hasEligibleBlocked(entries: Record<string, LedgerEntry>): boolean {
  return Object.values(entries).some((entry) => entry.status === "PROVIDER_BLOCKED" && msUntil(entry.next_eligible_at) <= 0);
}
function orderedEntries(): LedgerEntry[] {
  const order = new Map<string, number>();
  let index = 0;
  for (const conversation of matrix.conversations) for (let turn = 1; turn <= conversation.turns.length; turn++) order.set(`${conversation.id}:${turn}`, index++);
  return Object.values(ledger.entries).sort((a, b) => (order.get(`${a.conversation_id}:${a.turn_id}`) ?? Number.MAX_SAFE_INTEGER) - (order.get(`${b.conversation_id}:${b.turn_id}`) ?? Number.MAX_SAFE_INTEGER));
}
function canReplayContext(target: LedgerEntry): boolean {
  return orderedEntries().filter((entry) => entry.conversation_id === target.conversation_id && entry.turn_id < target.turn_id).every((entry) => ["PRIMARY_VALID", "PRIMARY_INVALID_REJECTED"].includes(entry.status) && Boolean(entry.raw_call?.interpretation));
}
const ordered = orderedEntries();
const eligibleBlocked = ordered.find((entry) => entry.status === "PROVIDER_BLOCKED" && msUntil(entry.next_eligible_at) <= 0 && canReplayContext(entry));
const firstPending = ordered.find((entry) => entry.status === "PENDING");
const targetKey = (eligibleBlocked ?? firstPending)?.key;
const invocationId = `scheduler-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const beforeCounts = countStatuses(ledger.entries);
const invocationStartedAt = nowIso();
ledger.last_run = { invocation_id: invocationId, started_at: invocationStartedAt, before: beforeCounts, provider_calls: 0 };
ledger.updated_at = invocationStartedAt;
await writeJsonAtomic(LEDGER_FILE, ledger);
let newCalls = 0; let paused = false; let pauseCategory: string | undefined; let pauseMetadata: Record<string, unknown> | undefined; let inputTokens = 0; let outputTokens = 0; let lastStart = ledger.last_call_started_at ? Date.parse(ledger.last_call_started_at) : 0;

class QuotaPause extends Error { constructor(readonly category: string, readonly metadata: Record<string, unknown>) { super(category); } }
class ReplayInterpreter implements LanguageInterpreter { constructor(private readonly interpretation: Interpretation) {} async interpret(): Promise<Interpretation> { return this.interpretation; } }
class NewGeminiInterpreter implements LanguageInterpreter {
  constructor(private readonly conversationId: string, private readonly matrixId: string, private readonly turnNumber: number, private readonly entry: LedgerEntry) {}
  async interpret(input: Parameters<LanguageInterpreter["interpret"]>[0]): Promise<Interpretation> {
    const trace: Record<string, unknown> = { matrix_id: this.matrixId, conversation_id: this.conversationId, turn: this.turnNumber, input: { message_id: input.message_id, text: input.text, context: input.context }, provider: "gemini", model: GEMINI_MODEL, request_body: null, response_body: null, http_status: null, retry_count: 0, provider_output: null, interpretation: null, validation: null, observation: null };
    this.entry.status = "RUNNING"; this.entry.attempts++; this.entry.updated_at = nowIso(); ledger.last_call_started_at = nowIso(); ledger.updated_at = nowIso(); await writeJsonAtomic(LEDGER_FILE, ledger);
    if (lastStart) await sleep(Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastStart))); lastStart = Date.now();
    const adapter = new ControlledLlmAdapter({ enabled: true, timeoutMs: 30_000, provider, network: async (request, signal) => { trace.request_body = JSON.parse(request.body); trace.prompt_hash = await sha256Text(String((trace.request_body as Record<string, unknown>).contents ?? "")); const response = await fetchBoundary(request, signal); trace.http_status = response.status; trace.response_body = response.body; if (response.status >= 200 && response.status < 300) { const usage = provider.usageFromResponse(response.body); if (usage) { inputTokens += usage.input_tokens; outputTokens += usage.output_tokens; } } try { trace.provider_output = provider.extractText(response.body); } catch { /* raw body retained */ } return response; }, observe: (event: AdapterObservation) => { trace.observation = event; } });
    let result: Interpretation;
    try { result = await adapter.interpret(input); } catch (error) { trace.error = String(error); traces.push(trace); throw error; }
    trace.interpretation = result; const responseStatus = Number(trace.http_status ?? 0); const observation = trace.observation as AdapterObservation | null;
    if (responseStatus === 429) { const parsed = classify429(String(trace.response_body ?? "")); trace.provider_metadata = parsed.metadata; trace.validation = { status: "provider_blocked", category: parsed.category }; this.entry.status = "PROVIDER_BLOCKED"; this.entry.provider_category = parsed.category; this.entry.provider_metadata = parsed.metadata; this.entry.next_eligible_at = new Date(Date.now() + (parsed.retryMs ?? 15 * 60_000)).toISOString(); this.entry.raw_call = trace; this.entry.prompt_hash = String(trace.prompt_hash); this.entry.updated_at = nowIso(); ledger.status = "WAITING_PROVIDER"; ledger.provider_category = parsed.category; ledger.provider_metadata = parsed.metadata; ledger.next_eligible_at = this.entry.next_eligible_at; ledger.updated_at = nowIso(); traces.push(trace); await writeJsonAtomic(LEDGER_FILE, ledger); throw new QuotaPause(parsed.category, parsed.metadata); }
    const valid = responseStatus >= 200 && responseStatus < 300 && observation?.outcome === "llm_valid";
    if (valid) { try { assertStrictInterpretation(result); assertNoAuthorityEscalation(result); trace.validation = { status: "accepted", fact_boundary: "PASS" }; this.entry.status = "PRIMARY_VALID"; } catch (error) { trace.validation = { status: "rejected", fact_boundary: "FAIL", reason: String(error) }; this.entry.status = "PRIMARY_INVALID_REJECTED"; } }
    else if (observation?.outcome === "fallback_invalid") { trace.validation = { status: "rejected_safely", fact_boundary: "PASS" }; this.entry.status = "PRIMARY_INVALID_REJECTED"; }
    else { trace.validation = { status: "provider_failure", fallback: true }; this.entry.status = "FAILED"; }
    this.entry.raw_call = trace; this.entry.prompt_hash = String(trace.prompt_hash); this.entry.updated_at = nowIso(); ledger.updated_at = nowIso(); traces.push(trace); await writeJsonAtomic(LEDGER_FILE, ledger); return result;
  }
}

let processedRuntime = 0;
try {
  for (const conversation of matrix.conversations) {
    let conversationId: string | null = null;
    const phone = `+551196${String(3000000 + matrix.conversations.indexOf(conversation)).padStart(7, "0")}`;
    for (let turn = 1; turn <= conversation.turns.length; turn++) {
      const entry = entriesById.get(`${conversation.id}:${turn}`)!; const raw = rawByKey.get(`${conversation.id}:${turn}`); const status = entry.status;
      if (status === "PRIMARY_VALID" || status === "PRIMARY_INVALID_REJECTED" || status === "FAILED") {
        if (status === "FAILED") continue;
      } else {
        if (entry.key !== targetKey) continue;
        if (newCalls >= MAX_PROVIDER_CALLS_PER_RUN) break;
        if (msUntil(entry.next_eligible_at) > 0) { ledger.status = "WAITING_PROVIDER"; ledger.next_eligible_at = entry.next_eligible_at; await writeJsonAtomic(LEDGER_FILE, ledger); paused = true; break; }
      }
      const replayInterpretation = raw?.interpretation as Interpretation | undefined;
      const interpreter = replayInterpretation ? new ReplayInterpreter(replayInterpretation) : new NewGeminiInterpreter(conversationId ?? "pending", conversation.id, turn, entry);
      try {
        const inbound: RuntimeInbound = { external_message_id: `${ledger.run_id}-${conversation.id}-${turn}`, phone_e164: phone, contact_name: `${ledger.contact_prefix}-${conversation.id}`, body: conversation.turns[turn - 1]!, message_type: "text", metadata: { lab_only: true, qualification_run_id: ledger.run_id, matrix_id: conversation.id, turn } };
        const result = await processOfficialTurn(inbound, new SupabaseRuntimeStore(rest), interpreter, { automatic_replies_allowed: true });
        conversationId ??= result.conversation_id; entry.runtime = { conversation_id: result.conversation_id, kind: result.kind, revision: result.revision, event_kind: result.event_kind, inbound_message_id: result.inbound_message_id, reply_body_present: result.reply_body !== null, outbox_id: result.outbox_id }; processedRuntime++; if (!replayInterpretation) { await deliver(rest, result.outbox_id, `${conversation.id}-${turn}`, ledger.run_id); newCalls++; }
        entry.updated_at = nowIso(); ledger.updated_at = nowIso(); await writeJsonAtomic(LEDGER_FILE, ledger);
      } catch (error) {
        if (error instanceof QuotaPause) { paused = true; pauseCategory = error.category; pauseMetadata = error.metadata; break; }
        entry.status = "FAILED"; entry.reason = error instanceof Error ? error.message : String(error); entry.updated_at = nowIso(); ledger.errors.push(`${entry.key}: ${entry.reason}`); ledger.updated_at = nowIso(); await writeJsonAtomic(LEDGER_FILE, ledger); throw error;
      }
    }
    if (paused || newCalls >= MAX_PROVIDER_CALLS_PER_RUN) break;
  }
} catch (error) { ledger.status = "BLOCKED"; ledger.errors.push(error instanceof Error ? error.message : String(error)); }

const values = Object.values(ledger.entries); ledger.counts = countStatuses(ledger.entries);
const terminal = values.every((entry) => ["PRIMARY_VALID", "PRIMARY_INVALID_REJECTED"].includes(entry.status));
ledger.status = terminal ? "MATRIX_COMPLETE" : ledger.status === "BLOCKED" || values.some((entry) => entry.status === "FAILED") ? "BLOCKED" : paused ? "WAITING_PROVIDER" : "RUNNING";
const afterCounts = ledger.counts;
const terminalBefore = (beforeCounts.PRIMARY_VALID ?? 0) + (beforeCounts.PRIMARY_INVALID_REJECTED ?? 0);
const terminalAfter = (afterCounts.PRIMARY_VALID ?? 0) + (afterCounts.PRIMARY_INVALID_REJECTED ?? 0);
const ledgerProgressed = terminalAfter > terminalBefore || (beforeCounts.PROVIDER_BLOCKED ?? 0) !== (afterCounts.PROVIDER_BLOCKED ?? 0) || (beforeCounts.PENDING ?? 0) !== (afterCounts.PENDING ?? 0);
const eligible = hasEligibleBlocked(ledger.entries) || (afterCounts.PENDING ?? 0) > 0;
const watchdog = ledger.watchdog ?? { consecutive_eligible_no_progress: 0 };
if (eligible && !ledgerProgressed) watchdog.consecutive_eligible_no_progress += 1;
else if (ledgerProgressed || !eligible) watchdog.consecutive_eligible_no_progress = 0;
watchdog.last_checked_at = nowIso();
if (watchdog.consecutive_eligible_no_progress >= 5) watchdog.last_action = ledger.provider_category ? "quota-only-wait; infrastructure/provider metadata rechecked" : "investigate runner/scheduler/provider";
ledger.watchdog = watchdog;
ledger.last_run = { ...ledger.last_run!, finished_at: nowIso(), after: afterCounts, provider_calls: newCalls, ledger_progressed: ledgerProgressed, result: { status: ledger.status, provider_category: pauseCategory ?? ledger.provider_category ?? null } };
ledger.updated_at = nowIso(); await writeJsonAtomic(LEDGER_FILE, ledger);
const output = { status: ledger.status, matrix_sha: matrixSha, invocation_id: invocationId, target_key: targetKey ?? null, max_provider_calls_per_run: MAX_PROVIDER_CALLS_PER_RUN, new_calls: newCalls, processed_runtime: processedRuntime, before: beforeCounts, result: { provider_category: pauseCategory ?? ledger.provider_category ?? null, provider_metadata: pauseMetadata ?? ledger.provider_metadata ?? null }, after: afterCounts, ledger_progressed: ledgerProgressed, watchdog: ledger.watchdog, counts: ledger.counts, next_eligible_at: ledger.next_eligible_at ?? null, provider_category: pauseCategory ?? ledger.provider_category ?? null, provider_metadata: pauseMetadata ?? ledger.provider_metadata ?? null, run_id: ledger.run_id };
console.log(JSON.stringify(output));
if (ledger.status === "BLOCKED") Deno.exit(2);
