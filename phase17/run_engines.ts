/**
 * Executes both isolated workflows against the immutable Phase 15 fixtures.
 *
 * The process is intentionally run without --allow-net. It writes only to the
 * caller-selected result directory and never imports a production adapter.
 */
import { runCurrentWorkflowLabCase } from "./current-adapter/mod.ts";
import { MotorV2Runtime } from "../santana-conversation-domain/motor-v2/runtime.ts";
import { canonicalJson, sha256 } from "../santana-conversation-domain/runtime/server_transition.ts";

const EXPECTED_FIXTURE_SHA256 = "aab857a982b8e5db841e8a0681504cc2d00266daff992889f131a7fca905fa37";
const EXPECTED_RANKS = [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 18, 22, 25, 32, 33, 35, 37, 39, 41, 42];

interface FixtureMessage {
  turn_id: string;
  role: "user" | "assistant";
  content: string;
  synthetic: true;
}

interface Fixture {
  schema_version: "gold-fixture-v2.1.0";
  case_id: string;
  case_hash: string;
  review_rank: number;
  input: {
    messages: FixtureMessage[];
    known_facts: Array<{
      key: string;
      value: string | number | boolean | null;
      source_turn: string;
      status: "user_provided" | "system_observed" | "synthetic_fixture";
    }>;
    do_not_ask_again: string[];
    track_states: Array<{
      track_id: string;
      label: string;
      status: "new" | "active" | "blocked" | "pending_handoff" | "handoff_accepted" | "handled" | "closed" | "inactive";
    }>;
    administrative_gaps: {
      current_deadline: "unknown" | "requires_current_policy" | "human_validation_required";
      current_value: "unknown" | "requires_current_policy" | "human_validation_required";
      current_documents: "unknown" | "requires_current_policy" | "human_validation_required";
      family_authorization: "unknown" | "requires_current_policy" | "human_validation_required";
      current_schedule: "unknown" | "requires_current_policy" | "human_validation_required";
      eligibility: "unknown" | "requires_current_policy" | "human_validation_required";
      current_procedure: "unknown" | "requires_current_policy" | "human_validation_required";
    };
  };
  execution: {
    fixed_clock: { instant: string; timezone: string };
  };
}

interface CliOptions {
  fixtures: string;
  outputDir: string;
  v2Replays: number;
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --key value pairs");
    values.set(key.slice(2), value);
  }
  const fixtures = values.get("fixtures");
  const outputDir = values.get("output-dir");
  const v2Replays = Number(values.get("v2-replays") ?? "3");
  if (!fixtures || !outputDir) throw new Error("--fixtures and --output-dir are required");
  if (!Number.isInteger(v2Replays) || v2Replays < 3 || v2Replays > 10) {
    throw new Error("--v2-replays must be an integer from 3 to 10");
  }
  return { fixtures, outputDir, v2Replays };
}

function parseFixtures(source: string): Fixture[] {
  const rows = source.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Fixture);
  if (rows.length !== 20) throw new Error(`expected 20 fixtures, found ${rows.length}`);
  if (rows.some((row) => row.schema_version !== "gold-fixture-v2.1.0")) throw new Error("fixture schema drift");
  const ranks = rows.map((row) => row.review_rank);
  if (canonicalJson(ranks) !== canonicalJson(EXPECTED_RANKS)) throw new Error("fixture rank set or order drift");
  if (new Set(rows.map((row) => row.case_id)).size !== rows.length) throw new Error("duplicate case id");
  if (new Set(rows.map((row) => row.case_hash)).size !== rows.length) throw new Error("duplicate case hash");
  return rows;
}

function resourceDelta(before: Deno.MemoryUsage, after: Deno.MemoryUsage, outputBytes: number) {
  return {
    heap_used_before_bytes: before.heapUsed,
    heap_used_after_bytes: after.heapUsed,
    heap_used_delta_bytes: after.heapUsed - before.heapUsed,
    rss_before_bytes: before.rss,
    rss_after_bytes: after.rss,
    rss_delta_bytes: after.rss - before.rss,
    output_bytes: outputBytes,
  };
}

async function runCurrent(
  fixture: Fixture,
  mode: "compat-v1" | "role-aware-v1",
  runId: string,
) {
  const before = Deno.memoryUsage();
  const result = await runCurrentWorkflowLabCase({
    caseId: fixture.case_id,
    caseHash: fixture.case_hash,
    fixedClock: fixture.execution.fixed_clock,
    mode,
    messages: fixture.input.messages.map((message) => ({
      turnId: message.turn_id,
      role: message.role,
      content: message.content,
    })),
  });
  const after = Deno.memoryUsage();
  const auditHash = await sha256(canonicalJson(result.audit));
  const row = {
    schema_version: "phase17-engine-run-v1.0.0",
    engine: { id: `current-workflow/${mode}`, runtime: "santana-conversation-domain/v1" },
    execution: { run_id: runId, replay: 1, engine_instance_scope: "fresh_per_case" },
    case_id: fixture.case_id,
    case_hash: fixture.case_hash,
    status: result.status,
    trace: result.trace,
    idempotency_probe: result.idempotency_probe,
    environment: { isolated: true, network_access: false, production_access: false },
    runtime: { network_allowed: false, production_adapters_loaded: false, external_side_effects: false },
    receipt_evidence: [],
    operational: {
      latency_ms: result.metrics.total_duration_ms,
      retries: result.metrics.retries,
      network_calls: 0,
      resources: resourceDelta(before, after, 0),
    },
    audit_summary: {
      audit_sha256: auditHash,
      event_count: result.audit.turns.length,
      final_state_sha256: result.audit.final_state_hash,
      committed_turns: result.metrics.committed_turns,
      outbox_count: result.audit.outbox_count,
      unsupported_capabilities: result.audit.unsupported_capabilities,
    },
  };
  row.operational.resources.output_bytes = new TextEncoder().encode(JSON.stringify(row)).length;
  return row;
}

async function runV2(fixture: Fixture, runId: string, replay: number) {
  const runtime = new MotorV2Runtime();
  const input = {
    case_id: fixture.case_id,
    conversation_id: `lab_conversation_${fixture.case_hash.slice(0, 16)}`,
    inbound_id: `lab_inbound_${fixture.case_hash.slice(16, 32)}`,
    messages: fixture.input.messages,
    known_facts: fixture.input.known_facts,
    do_not_ask_again: fixture.input.do_not_ask_again,
    track_states: fixture.input.track_states,
    administrative_gaps: fixture.input.administrative_gaps,
    fixed_clock: fixture.execution.fixed_clock,
  } as const;
  const before = Deno.memoryUsage();
  const first = await runtime.runLabCase(input);
  const revision = first.state.revision;
  const stateHash = first.state.state_hash;
  const auditCount = first.audit.length;
  const duplicate = await runtime.runLabCase(input);
  const after = Deno.memoryUsage();
  const auditHash = await sha256(canonicalJson(first.audit));
  const row = {
    schema_version: "phase17-engine-run-v1.0.0",
    engine: {
      id: "motor-v2/isolated-lab",
      runtime: first.state.schema_version,
      understanding_provider: first.provider,
    },
    execution: { run_id: runId, replay, engine_instance_scope: "fresh_per_case" },
    case_id: fixture.case_id,
    case_hash: fixture.case_hash,
    status: "COMPLETED" as const,
    trace: first.trace,
    idempotency_probe: {
      duplicate_detected: duplicate.duplicate,
      revision_unchanged: duplicate.state.revision === revision,
      state_hash_unchanged: duplicate.state.state_hash === stateHash,
      audit_unchanged: duplicate.audit.length === auditCount,
      trace_unchanged: canonicalJson(duplicate.trace) === canonicalJson(first.trace),
    },
    environment: { isolated: true, network_access: false, production_access: false },
    runtime: { network_allowed: false, production_adapters_loaded: false, external_side_effects: false },
    receipt_evidence: first.state.receipts.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      receipt_type: receipt.receipt_type,
      tool: receipt.tool,
      idempotency_key: receipt.idempotency_key,
      issued_at: receipt.issued_at,
      payload_hash: receipt.payload_hash,
      executor_reference_hash: receipt.executor_reference_hash,
      integrity_hash: receipt.integrity_hash,
      bound_claim_codes: receipt.bound_claim_codes,
    })),
    operational: {
      latency_ms: first.metrics.duration_ms,
      retries: first.metrics.retry_count,
      network_calls: 0,
      resources: resourceDelta(before, after, 0),
    },
    audit_summary: {
      audit_sha256: auditHash,
      event_count: first.audit.length,
      final_state_sha256: first.state.state_hash,
      track_count: first.metrics.track_count,
      fact_count: first.state.facts.length,
      policy_gap_count: first.state.policy.policy_gaps.length,
      tool_call_count: first.metrics.tool_call_count,
      receipt_count: first.state.receipts.length,
      provider_uses_ai: first.provider.uses_ai,
    },
  };
  row.operational.resources.output_bytes = new TextEncoder().encode(JSON.stringify(row)).length;
  return row;
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await Deno.writeTextFile(path, body, { create: true });
  await Deno.chmod(path, 0o600);
}

/** Preserve UUID entropy while preventing generated identifiers from resembling CPF/phone data. */
export function privacySafeExecutionId(uuid: string = crypto.randomUUID()): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error("execution id source must be a UUID");
  }
  const alphabet = "abcdefghijklmnop";
  const token = [...uuid.replaceAll("-", "")]
    .map((character) => alphabet[Number.parseInt(character, 16)])
    .join("");
  return `run_${token}`;
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);
  const stat = await Deno.lstat(options.fixtures);
  if (!stat.isFile || stat.isSymlink) throw new Error("fixtures must be a regular non-symlink file");
  const fixtureText = await Deno.readTextFile(options.fixtures);
  if (await sha256(fixtureText) !== EXPECTED_FIXTURE_SHA256) throw new Error("immutable fixture file SHA-256 mismatch");
  const fixtures = parseFixtures(fixtureText);
  await Deno.mkdir(options.outputDir, { recursive: true, mode: 0o700 });
  const executionId = privacySafeExecutionId();

  const current = [];
  const currentRoleAware = [];
  for (const fixture of fixtures) {
    current.push(await runCurrent(fixture, "compat-v1", `${executionId}:current-compat-v1`));
    currentRoleAware.push(await runCurrent(fixture, "role-aware-v1", `${executionId}:current-role-aware-v1`));
  }
  await writeJsonl(`${options.outputDir}/current-workflow-compat-v1.jsonl`, current);
  await writeJsonl(`${options.outputDir}/current-workflow-role-aware-v1.jsonl`, currentRoleAware);

  for (let replay = 1; replay <= options.v2Replays; replay += 1) {
    const rows = [];
    const runId = `${executionId}:motor-v2-replay-${replay}`;
    for (const fixture of fixtures) rows.push(await runV2(fixture, runId, replay));
    await writeJsonl(`${options.outputDir}/motor-v2-replay-${replay}.jsonl`, rows);
  }
  const summary = {
    schema_version: "phase17-engine-execution-summary-v1.0.0",
    fixture_sha256: EXPECTED_FIXTURE_SHA256,
    fixture_count: fixtures.length,
    execution_id: executionId,
    current_modes: ["compat-v1", "role-aware-v1"],
    v2_replays: options.v2Replays,
    environment: { isolated: true, network_access: false, production_access: false },
  };
  const summaryPath = `${options.outputDir}/execution-summary.json`;
  await Deno.writeTextFile(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  await Deno.chmod(summaryPath, 0o600);
  console.log(JSON.stringify(summary));
}

if (import.meta.main) await main();
