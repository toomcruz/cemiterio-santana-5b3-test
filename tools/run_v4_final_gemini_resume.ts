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
const MAX_PROVIDER_CALLS_PER_RUN = 2;
const MIN_INTERVAL_MS = 15_000;
const LEDGER_FILE = new URL("../lab-checkpoints/SANA-V4-GEMINI-LEDGER.json", import.meta.url);
const LEDGER_LOCK_FILE = new URL("../lab-checkpoints/SANA-V4-GEMINI-LEDGER.lock", import.meta.url);
const PARTIAL_FILE = new URL("../lab-checkpoints/SANA-V4-FINAL-GEMINI-QUALIFICATION.json", import.meta.url);
const MATRIX_FILE = new URL("./v4-final-gemini-matrix.json", import.meta.url);
const SERVICE_KEY = Deno.env.get("SANA_V4_RUNTIME_SERVICE_KEY") ?? "";
const ACCESS_TOKEN = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_API_KEY_GATE2 = Deno.env.get("GEMINI_API_KEY_GATE2") ?? "";
if (!ACCESS_TOKEN || !GEMINI_API_KEY || !GEMINI_API_KEY_GATE2) throw new Error("qualification credentials are not configured");

type MatrixConversation = { id: string; category: string; turns: string[]; adversarial?: boolean };
type Matrix = { matrix_version: string; runtime_commit: string; provider: string; model: string; generation_config: Record<string, unknown>; conversations: MatrixConversation[] };
type LedgerStatus = "PENDING" | "RUNNING" | "PRIMARY_VALID" | "PRIMARY_INVALID_REJECTED" | "PROVIDER_BLOCKED" | "FAILED";
type LedgerEntry = {
  key: string; matrix_sha: string; conversation_id: string; turn_id: number; input_hash: string; prompt_hash?: string;
  status: LedgerStatus; attempts: number; updated_at: string; next_eligible_at?: string; category?: string;
  source_artifact?: string; source_raw_call_index?: number; raw_call?: Record<string, unknown>;
  credential_attempts?: Array<Record<string, unknown>>; credential_next_eligible_at?: Record<string, string>;
  attempts_by_credential?: Record<string, number>;
  provider_category?: string; provider_metadata?: Record<string, unknown>; runtime?: Record<string, unknown>;
  reason?: string;
};
type Ledger = {
  artifact: string; version: string; revision: number; matrix_sha: string; matrix_file_sha: string; runtime_commit: string;
  model: string; generation_config: Record<string, unknown>; run_id: string; contact_prefix: string;
  created_at: string; updated_at: string; last_call_started_at?: string; next_eligible_at?: string;
  status: "RUNNING" | "WAITING_PROVIDER" | "MATRIX_COMPLETE" | "BLOCKED";
  provider_category?: string; provider_metadata?: Record<string, unknown>; entries: Record<string, LedgerEntry>;
  counts: Record<string, number>; errors: string[];
  reconciliations?: Array<Record<string, unknown>>;
  project_relationship?: string;
  credential_slots?: Record<string, { fingerprint: string; kind: string }>;
  last_provider_call?: { invocation_id: string; conversation_id: string; turn_id: number; started_at: string; finished_at?: string; http_status?: number | null; outcome?: string | null; provider_category?: string | null; credential_slot?: CredentialSlot; credential_fingerprint?: string };
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
class LedgerCommitError extends Error { constructor(message: string) { super(`FINALIZER_LEDGER_COMMIT_ERROR: ${message}`); } }
async function acquireLedgerLock(): Promise<() => Promise<void>> {
  const deadline = Date.now() + 8_000;
  while (true) {
    try {
      const handle = await Deno.open(LEDGER_LOCK_FILE, { create: true, createNew: true, write: true });
      await handle.write(new TextEncoder().encode(JSON.stringify({ pid: Deno.pid, acquired_at: nowIso() }) + "\n"));
      handle.close();
      return async () => { try { await Deno.remove(LEDGER_LOCK_FILE); } catch { /* already released */ } };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      try {
        const stat = await Deno.stat(LEDGER_LOCK_FILE);
        if (Date.now() - stat.mtime!.getTime() > 120_000) { await Deno.remove(LEDGER_LOCK_FILE); continue; }
      } catch { continue; }
      if (Date.now() >= deadline) throw new LedgerCommitError("ledger lock timeout");
      await sleep(100);
    }
  }
}
async function readLedgerFromDisk(): Promise<Ledger | null> {
  try { return JSON.parse(await readText(LEDGER_FILE)) as Ledger; } catch { return null; }
}
let ledger: Ledger;
async function writeLedgerAtomic(reason: string): Promise<void> {
  const release = await acquireLedgerLock();
  try {
    const disk = await readLedgerFromDisk();
    const expectedRevision = Number(ledger.revision ?? 0);
    const actualRevision = Number(disk?.revision ?? 0);
    if (disk && actualRevision !== expectedRevision) throw new LedgerCommitError(`revision conflict (${reason}): expected ${expectedRevision}, found ${actualRevision}`);
    const next = { ...ledger, revision: expectedRevision + 1, updated_at: nowIso() };
    await writeJsonAtomic(LEDGER_FILE, next);
    ledger = next;
  } finally { await release(); }
}
async function recordCommitError(error: unknown): Promise<void> {
  const release = await acquireLedgerLock();
  try {
    const disk = await readLedgerFromDisk();
    if (!disk) throw error;
    const message = error instanceof Error ? error.message : String(error);
    disk.status = "BLOCKED";
    disk.errors = [...(disk.errors ?? []), message].slice(-100);
    disk.last_run = { ...(disk.last_run ?? { invocation_id: "unknown", started_at: nowIso(), before: disk.counts ?? {}, provider_calls: 0 }), finished_at: nowIso(), result: { status: "BLOCKED", error: "FINALIZER_LEDGER_COMMIT_ERROR" } };
    disk.revision = Number(disk.revision ?? 0) + 1;
    disk.updated_at = nowIso();
    await writeJsonAtomic(LEDGER_FILE, disk);
    ledger = disk;
  } finally { await release(); }
}
function nowIso(): string { return new Date().toISOString(); }
function msUntil(value?: string): number { return value ? Math.max(0, Date.parse(value) - Date.now()) : 0; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function q(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

async function sha256Text(text: string): Promise<string> { return await sha256(text); }
function rawJson(raw: string): Record<string, unknown> { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } }
const credentialFingerprintA = await sha256Text(GEMINI_API_KEY).then((value) => value.slice(0, 12));
const credentialFingerprintB = await sha256Text(GEMINI_API_KEY_GATE2).then((value) => value.slice(0, 12));
const CREDENTIALS = {
  A: { slot: "A", key: GEMINI_API_KEY, fingerprint: credentialFingerprintA },
  B: { slot: "B", key: GEMINI_API_KEY_GATE2, fingerprint: credentialFingerprintB },
} as const;
type CredentialSlot = keyof typeof CREDENTIALS;
function countStatuses(entries: Record<string, LedgerEntry>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of Object.values(entries)) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}
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
const providers = {
  A: new GeminiBenchmarkProvider(GEMINI_MODEL, CREDENTIALS.A.key, geminiSchema(schema) as Record<string, unknown>),
  B: new GeminiBenchmarkProvider(GEMINI_MODEL, CREDENTIALS.B.key, geminiSchema(schema) as Record<string, unknown>),
} satisfies Record<CredentialSlot, GeminiBenchmarkProvider>;
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
  return { artifact: "SANA V4 FINAL GEMINI LEDGER", version: "2", revision: 0, matrix_sha: matrixSha, matrix_file_sha: matrixSha, runtime_commit: RUNTIME_COMMIT, model: GEMINI_MODEL, generation_config: matrix.generation_config, run_id: runId, contact_prefix: `SANA-V4-GEMINI-${runId}`, created_at: nowIso(), updated_at: nowIso(), status: "RUNNING", project_relationship: "USER_CONFIRMED_DISTINCT_PROJECTS", credential_slots: { A: { fingerprint: credentialFingerprintA, kind: "standard_api_key" }, B: { fingerprint: credentialFingerprintB, kind: "standard_api_key" } }, entries, counts, errors: [] };
}
try { ledger = JSON.parse(await readText(LEDGER_FILE)) as Ledger; } catch { ledger = await buildInitialLedger(); await writeLedgerAtomic("initial-ledger"); }
if (ledger.matrix_sha !== matrixSha || ledger.runtime_commit !== RUNTIME_COMMIT) throw new Error("ledger identity mismatch");
ledger.revision = Number(ledger.revision ?? 0);
ledger.project_relationship ??= "USER_CONFIRMED_DISTINCT_PROJECTS";
ledger.credential_slots ??= { A: { fingerprint: credentialFingerprintA, kind: "standard_api_key" }, B: { fingerprint: credentialFingerprintB, kind: "standard_api_key" } };
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

const storedCounts = JSON.stringify(ledger.counts ?? {});
const actualCounts = countStatuses(ledger.entries);
if (storedCounts !== JSON.stringify(actualCounts)) {
  const reconciledAt = nowIso();
  const reconciled = Object.values(ledger.entries)
    .filter((entry) => entry.status === "PRIMARY_VALID" && entry.raw_call?.http_status === 200 && (entry.raw_call.observation as Record<string, unknown> | undefined)?.outcome === "llm_valid")
    .map((entry) => ({ at: reconciledAt, conversation_id: entry.conversation_id, turn_id: entry.turn_id, key: entry.key, from_counts: ledger.counts, to_counts: actualCounts, reason: "authoritative terminal entry reconciled from stale denormalized counters", http_status: entry.raw_call?.http_status }));
  ledger.reconciliations = [...(ledger.reconciliations ?? []), ...reconciled].slice(-100);
  ledger.counts = actualCounts;
  ledger.updated_at = reconciledAt;
  await writeLedgerAtomic("reconcile-denormalized-counts");
}
const entriesById = new Map<string, LedgerEntry>(); for (const entry of Object.values(ledger.entries)) entriesById.set(`${entry.conversation_id}:${entry.turn_id}`, entry);
const rawByKey = new Map<string, Record<string, unknown>>(); for (const entry of Object.values(ledger.entries)) if (entry.raw_call) rawByKey.set(`${entry.conversation_id}:${entry.turn_id}`, entry.raw_call);
const traces: Record<string, unknown>[] = [];
function hasEligibleBlocked(entries: Record<string, LedgerEntry>): boolean {
  return Object.values(entries).some((entry) => entry.status === "PROVIDER_BLOCKED" && (msUntil(entry.credential_next_eligible_at?.A ?? entry.next_eligible_at) <= 0 || msUntil(entry.credential_next_eligible_at?.B ?? entry.next_eligible_at) <= 0));
}
function eligibleCredential(entry: LedgerEntry): CredentialSlot | null {
  if (msUntil(entry.credential_next_eligible_at?.A ?? entry.next_eligible_at) <= 0) return "A";
  if (msUntil(entry.credential_next_eligible_at?.B ?? entry.next_eligible_at) <= 0) return "B";
  return null;
}
function credentialEligible(entry: LedgerEntry, slot: CredentialSlot): boolean {
  // Legacy blocked entries have one shared cooldown from the original
  // single-credential runner. Apply it to A, while B remains independently
  // eligible unless B has its own recorded cooldown.
  const next = slot === "A"
    ? entry.credential_next_eligible_at?.A ?? entry.next_eligible_at
    : entry.credential_next_eligible_at?.B;
  return msUntil(next) <= 0;
}
function slotsForEntry(entry: LedgerEntry): CredentialSlot[] {
  if (entry.status !== "PROVIDER_BLOCKED") return ["A", "B"];
  const slots: CredentialSlot[] = [];
  if (credentialEligible(entry, "A")) slots.push("A");
  if (credentialEligible(entry, "B")) slots.push("B");
  return slots;
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

// Quota backoff is a ledger-wide provider gate. A scheduled wake during the
// backoff window must checkpoint and exit without selecting a pending item;
// otherwise a fresh PENDING turn could bypass the 429 cooldown.
const persistedProviderWaitMs = msUntil(ledger.next_eligible_at);
if (persistedProviderWaitMs > 0) {
  const invocationId = `scheduler-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = nowIso();
  const beforeCounts = countStatuses(ledger.entries);
  ledger.status = "WAITING_PROVIDER";
  ledger.last_run = { invocation_id: invocationId, started_at: startedAt, before: beforeCounts, provider_calls: 0 };
  ledger.updated_at = startedAt;
  await writeLedgerAtomic("wait-start");
  const finishedAt = nowIso();
  ledger.last_run = { ...ledger.last_run, finished_at: finishedAt, after: beforeCounts, provider_calls: 0, ledger_progressed: false, result: { status: "WAITING_PROVIDER", provider_category: ledger.provider_category ?? null } };
  ledger.updated_at = finishedAt;
  await writeLedgerAtomic("wait-finish");
  console.log(JSON.stringify({ status: "WAITING_PROVIDER", invocation_id: invocationId, max_provider_calls_per_run: MAX_PROVIDER_CALLS_PER_RUN, new_calls: 0, before: beforeCounts, result: { provider_category: ledger.provider_category ?? null, next_eligible_at: ledger.next_eligible_at }, after: beforeCounts, ledger_progressed: false, counts: beforeCounts, next_eligible_at: ledger.next_eligible_at }));
  Deno.exit(0);
}

const ordered = orderedEntries();
const eligibleBlocked = ordered.find((entry) => entry.status === "PROVIDER_BLOCKED" && eligibleCredential(entry) !== null && canReplayContext(entry));
const firstPending = ordered.find((entry) => entry.status === "PENDING");
const targetKey = (eligibleBlocked ?? firstPending)?.key;
const invocationId = `scheduler-run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const beforeCounts = countStatuses(ledger.entries);
const invocationStartedAt = nowIso();
ledger.last_run = { invocation_id: invocationId, started_at: invocationStartedAt, before: beforeCounts, provider_calls: 0 };
ledger.updated_at = invocationStartedAt;
await writeLedgerAtomic("run-start");
let providerCalls = 0; let paused = false; let pauseCategory: string | undefined; let pauseMetadata: Record<string, unknown> | undefined; let inputTokens = 0; let outputTokens = 0; let lastStart = ledger.last_call_started_at ? Date.parse(ledger.last_call_started_at) : 0;

class QuotaPause extends Error { constructor(readonly category: string, readonly metadata: Record<string, unknown>, readonly credentialSlot: CredentialSlot) { super(category); } }
class ReplayInterpreter implements LanguageInterpreter { constructor(private readonly interpretation: Interpretation) {} async interpret(): Promise<Interpretation> { return this.interpretation; } }
class NewGeminiInterpreter implements LanguageInterpreter {
  private readonly statusBeforeCall: LedgerStatus;
  private readonly countsBeforeCall: Record<string, number>;
  constructor(private readonly conversationId: string, private readonly matrixId: string, private readonly turnNumber: number, private readonly entry: LedgerEntry, private readonly credentialSlot: CredentialSlot) {
    this.statusBeforeCall = entry.status;
    this.countsBeforeCall = countStatuses(ledger.entries);
  }
  async interpret(input: Parameters<LanguageInterpreter["interpret"]>[0]): Promise<Interpretation> {
    if (providerCalls >= MAX_PROVIDER_CALLS_PER_RUN) throw new Error("MAX_PROVIDER_CALLS_PER_RUN exceeded");
    providerCalls++;
    const credential = CREDENTIALS[this.credentialSlot];
    const callStartedAt = nowIso();
    // The ledger item identity remains matrix/conversation/turn/input hash.
    // Runtime inbound dedupe is a separate idempotency boundary: a retry of a
    // provider-blocked item must use a fresh synthetic inbound id, otherwise
    // processOfficialTurn returns DUPLICATE before invoking Gemini again.
    const providerAttemptMessageId = `${ledger.run_id}-${invocationId}-${this.conversationId}-${this.turnNumber}-${this.credentialSlot}`;
    const trace: Record<string, unknown> = { matrix_id: this.matrixId, conversation_id: this.conversationId, turn: this.turnNumber, invocation_id: invocationId, provider_attempt_message_id: providerAttemptMessageId, credential_slot: credential.slot, credential_fingerprint: credential.fingerprint, call_started_at: callStartedAt, input: { message_id: input.message_id, text: input.text, context: input.context }, provider: "gemini", model: GEMINI_MODEL, request_body: null, response_body: null, http_status: null, retry_count: 0, provider_output: null, interpretation: null, validation: null, observation: null };
    this.entry.status = "RUNNING"; this.entry.attempts++; this.entry.attempts_by_credential = { ...(this.entry.attempts_by_credential ?? {}), [credential.slot]: ((this.entry.attempts_by_credential ?? {})[credential.slot] ?? 0) + 1 }; this.entry.updated_at = nowIso(); ledger.last_call_started_at = nowIso(); ledger.updated_at = nowIso(); await writeLedgerAtomic("provider-call-start");
    if (lastStart) await sleep(Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastStart))); lastStart = Date.now();
    const provider = providers[this.credentialSlot];
    const adapter = new ControlledLlmAdapter({ enabled: true, timeoutMs: 30_000, provider, network: async (request, signal) => { trace.request_body = JSON.parse(request.body); trace.prompt_hash = await sha256Text(String((trace.request_body as Record<string, unknown>).contents ?? "")); const response = await fetchBoundary(request, signal); trace.http_status = response.status; trace.response_body = response.body; if (response.status >= 200 && response.status < 300) { const usage = provider.usageFromResponse(response.body); if (usage) { inputTokens += usage.input_tokens; outputTokens += usage.output_tokens; } } try { trace.provider_output = provider.extractText(response.body); } catch { /* raw body retained */ } return response; }, observe: (event: AdapterObservation) => { trace.observation = event; } });
    let result: Interpretation;
    try { result = await adapter.interpret(input); } catch (error) { trace.error = String(error); traces.push(trace); throw error; }
    trace.interpretation = result; trace.call_finished_at = nowIso(); const responseStatus = Number(trace.http_status ?? 0); const observation = trace.observation as AdapterObservation | null;
    ledger.last_provider_call = { invocation_id: invocationId, conversation_id: this.matrixId, turn_id: this.turnNumber, started_at: callStartedAt, finished_at: String(trace.call_finished_at), http_status: responseStatus, outcome: observation?.outcome ?? null, provider_category: responseStatus === 429 ? "SHORT_WINDOW_RATE_LIMIT" : null, credential_slot: credential.slot, credential_fingerprint: credential.fingerprint };
    if (responseStatus === 429) { const parsed = classify429(String(trace.response_body ?? "")); ledger.last_provider_call = { ...ledger.last_provider_call!, provider_category: parsed.category }; trace.provider_metadata = parsed.metadata; trace.validation = { status: "provider_blocked", category: parsed.category }; this.entry.status = "PROVIDER_BLOCKED"; this.entry.provider_category = parsed.category; this.entry.provider_metadata = parsed.metadata; const nextEligibleAt = new Date(Date.now() + (parsed.retryMs ?? 15 * 60_000)).toISOString(); this.entry.next_eligible_at = nextEligibleAt; this.entry.credential_next_eligible_at = { ...(this.entry.credential_next_eligible_at ?? {}), [credential.slot]: nextEligibleAt }; this.entry.raw_call = trace; this.entry.credential_attempts = [...(this.entry.credential_attempts ?? []), trace]; this.entry.prompt_hash = String(trace.prompt_hash); this.entry.updated_at = nowIso(); ledger.status = "WAITING_PROVIDER"; ledger.provider_category = parsed.category; ledger.provider_metadata = parsed.metadata; ledger.next_eligible_at = Object.values(this.entry.credential_next_eligible_at).sort()[0]; ledger.updated_at = nowIso(); traces.push(trace); await writeLedgerAtomic("provider-429"); throw new QuotaPause(parsed.category, parsed.metadata, credential.slot); }
    const valid = responseStatus >= 200 && responseStatus < 300 && observation?.outcome === "llm_valid";
    if (valid) { try { assertStrictInterpretation(result); assertNoAuthorityEscalation(result); trace.validation = { status: "accepted", fact_boundary: "PASS" }; this.entry.status = "PRIMARY_VALID"; } catch (error) { trace.validation = { status: "rejected", fact_boundary: "FAIL", reason: String(error) }; this.entry.status = "PRIMARY_INVALID_REJECTED"; } }
    else if (observation?.outcome === "fallback_invalid") { trace.validation = { status: "rejected_safely", fact_boundary: "PASS" }; this.entry.status = "PRIMARY_INVALID_REJECTED"; }
    else { trace.validation = { status: "provider_failure", fallback: true }; this.entry.status = "FAILED"; }
    this.entry.raw_call = trace; this.entry.credential_attempts = [...(this.entry.credential_attempts ?? []), trace]; this.entry.credential_next_eligible_at = undefined; this.entry.provider_category = undefined; this.entry.provider_metadata = undefined; this.entry.next_eligible_at = undefined; this.entry.prompt_hash = String(trace.prompt_hash); this.entry.updated_at = nowIso(); ledger.updated_at = nowIso(); ledger.next_eligible_at = undefined; ledger.provider_category = undefined; ledger.provider_metadata = undefined; traces.push(trace); const revisionBefore = ledger.revision; await writeLedgerAtomic("provider-result");
    if (this.entry.status === "PRIMARY_VALID" && trace.http_status === 200 && observation?.outcome === "llm_valid") {
      const committedCounts = countStatuses(ledger.entries);
      const expectedPrimary = this.statusBeforeCall === "PRIMARY_VALID" ? this.countsBeforeCall.PRIMARY_VALID : (this.countsBeforeCall.PRIMARY_VALID ?? 0) + 1;
      const expectedPending = this.statusBeforeCall === "PENDING" ? Math.max(0, (this.countsBeforeCall.PENDING ?? 0) - 1) : (this.countsBeforeCall.PENDING ?? 0);
      if (ledger.revision !== revisionBefore + 1 || committedCounts.PRIMARY_VALID !== expectedPrimary || committedCounts.PENDING !== expectedPending) throw new LedgerCommitError(`PRIMARY_VALID commit invariant failed for ${this.matrixId}/${this.turnNumber}`);
    }
    return result;
  }
}

let processedRuntime = 0;
let commitError: LedgerCommitError | null = null;
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
        if (providerCalls >= MAX_PROVIDER_CALLS_PER_RUN) break;
        if (entry.status === "PROVIDER_BLOCKED" && eligibleCredential(entry) === null) { ledger.status = "WAITING_PROVIDER"; ledger.next_eligible_at = Object.values(entry.credential_next_eligible_at ?? { A: entry.next_eligible_at ?? nowIso() }).sort()[0]; await writeLedgerAtomic("entry-backoff"); paused = true; break; }
      }
      // A raw 429 may contain the adapter's fallback interpretation, but it is
      // not a terminal Gemini result and must never be replayed as one. Only
      // terminal ledger states are eligible for context replay; blocked items
      // must make a fresh provider call on a later scheduler run.
      const replayInterpretation = (["PRIMARY_VALID", "PRIMARY_INVALID_REJECTED"] as LedgerStatus[]).includes(status)
        ? raw?.interpretation as Interpretation | undefined
        : undefined;
      if (replayInterpretation) {
        try {
          const inbound: RuntimeInbound = { external_message_id: `${ledger.run_id}-${conversation.id}-${turn}`, phone_e164: phone, contact_name: `${ledger.contact_prefix}-${conversation.id}`, body: conversation.turns[turn - 1]!, message_type: "text", metadata: { lab_only: true, qualification_run_id: ledger.run_id, matrix_id: conversation.id, turn } };
          const result = await processOfficialTurn(inbound, new SupabaseRuntimeStore(rest), new ReplayInterpreter(replayInterpretation), { automatic_replies_allowed: true });
          conversationId ??= result.conversation_id; processedRuntime++;
        } catch (error) {
          entry.status = "FAILED"; entry.reason = error instanceof Error ? error.message : String(error); entry.updated_at = nowIso(); ledger.errors.push(`${entry.key}: ${entry.reason}`); ledger.updated_at = nowIso(); await writeLedgerAtomic("runtime-replay-failure"); throw error;
        }
        continue;
      }
      const slots = slotsForEntry(entry);
      let runtimeSucceeded = false;
      for (const credentialSlot of slots) {
        if (providerCalls >= MAX_PROVIDER_CALLS_PER_RUN) break;
        const interpreter = new NewGeminiInterpreter(conversationId ?? "pending", conversation.id, turn, entry, credentialSlot);
        try {
          const inbound: RuntimeInbound = { external_message_id: `${ledger.run_id}-${invocationId}-${conversation.id}-${turn}-${credentialSlot}`, phone_e164: phone, contact_name: `${ledger.contact_prefix}-${conversation.id}`, body: conversation.turns[turn - 1]!, message_type: "text", metadata: { lab_only: true, qualification_run_id: ledger.run_id, matrix_id: conversation.id, turn, credential_slot: credentialSlot, provider_attempt_message_id: `${ledger.run_id}-${invocationId}-${conversation.id}-${turn}-${credentialSlot}` } };
          const result = await processOfficialTurn(inbound, new SupabaseRuntimeStore(rest), interpreter, { automatic_replies_allowed: true });
          // planTurn fail-closed catches provider exceptions and returns an
          // unavailable interpretation. The interpreter has already persisted
          // the raw 429 and marked the ledger item blocked, so inspect the
          // ledger status here instead of treating that runtime result as a
          // successful turn. This is the hand-off point for A -> B failover.
          if (entry.status === "PROVIDER_BLOCKED") {
            paused = true;
            pauseCategory = entry.provider_category;
            pauseMetadata = entry.provider_metadata;
            if (credentialSlot === "A" && slots.includes("B") && providerCalls < MAX_PROVIDER_CALLS_PER_RUN) continue;
            break;
          }
          conversationId ??= result.conversation_id; entry.runtime = { conversation_id: result.conversation_id, kind: result.kind, revision: result.revision, event_kind: result.event_kind, inbound_message_id: result.inbound_message_id, reply_body_present: result.reply_body !== null, outbox_id: result.outbox_id, credential_slot: credentialSlot, credential_fingerprint: CREDENTIALS[credentialSlot].fingerprint }; await deliver(rest, result.outbox_id, `${conversation.id}-${turn}`, ledger.run_id); entry.updated_at = nowIso(); ledger.updated_at = nowIso(); ledger.status = "RUNNING"; paused = false; pauseCategory = undefined; pauseMetadata = undefined; await writeLedgerAtomic("runtime-result"); runtimeSucceeded = true; processedRuntime++; break;
        } catch (error) {
          if (error instanceof QuotaPause) { paused = true; pauseCategory = error.category; pauseMetadata = error.metadata; if (credentialSlot === "A" && providerCalls < MAX_PROVIDER_CALLS_PER_RUN) continue; break; }
          entry.status = "FAILED"; entry.reason = error instanceof Error ? error.message : String(error); entry.updated_at = nowIso(); ledger.errors.push(`${entry.key}: ${entry.reason}`); ledger.updated_at = nowIso(); await writeLedgerAtomic("runtime-failure"); throw error;
        }
      }
      if (!runtimeSucceeded && entry.status === "PROVIDER_BLOCKED") paused = true;
    }
    if (paused || providerCalls >= MAX_PROVIDER_CALLS_PER_RUN) break;
  }
} catch (error) {
  if (error instanceof LedgerCommitError) { commitError = error; try { await recordCommitError(error); } catch { /* preserve the original failure for the scheduler */ } }
  else { ledger.status = "BLOCKED"; ledger.errors.push(error instanceof Error ? error.message : String(error)); }
}

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
ledger.last_run = { ...ledger.last_run!, finished_at: nowIso(), after: afterCounts, provider_calls: providerCalls, ledger_progressed: ledgerProgressed, result: { status: ledger.status, provider_category: pauseCategory ?? ledger.provider_category ?? null } };
ledger.updated_at = nowIso();
try { await writeLedgerAtomic("run-finish"); } catch (error) { await recordCommitError(error); }
const output = { status: ledger.status, matrix_sha: matrixSha, invocation_id: invocationId, target_key: targetKey ?? null, max_provider_calls_per_run: MAX_PROVIDER_CALLS_PER_RUN, new_calls: providerCalls, provider_calls: providerCalls, processed_runtime: processedRuntime, before: beforeCounts, result: { provider_category: pauseCategory ?? ledger.provider_category ?? null, provider_metadata: pauseMetadata ?? ledger.provider_metadata ?? null }, after: afterCounts, ledger_progressed: ledgerProgressed, watchdog: ledger.watchdog, counts: ledger.counts, next_eligible_at: ledger.next_eligible_at ?? null, provider_category: pauseCategory ?? ledger.provider_category ?? null, provider_metadata: pauseMetadata ?? ledger.provider_metadata ?? null, run_id: ledger.run_id };
console.log(JSON.stringify(output));
if (commitError) Deno.exit(2);
if (ledger.status === "BLOCKED") Deno.exit(2);
