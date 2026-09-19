import { ControlledLlmAdapter, type AdapterObservation, type LanguageInterpreter } from "../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../santana-conversation-domain/runtime/adapter/network.ts";
import { processOfficialTurn, type RuntimeInbound } from "../santana-conversation-domain/runtime/official_turn_service.ts";
import { GeminiProvider } from "../santana-conversation-domain/integrations/gemini.ts";
import { evaluateScenario } from "./evaluator.ts";
import { SimulatedCitizen } from "./citizen.ts";
import { DEVELOPMENT_SCENARIOS, NOVEL_SCENARIOS, type Scenario } from "./scenarios.ts";
import { LabStore } from "./store.ts";

const mode = Deno.env.get("SIM_PROVIDER") ?? "deterministic";
const model = Deno.env.get("SUPPORT_RUNTIME_GEMINI_MODEL") ?? "gemini-flash-lite-latest";
const batch = Deno.env.get("SIM_BATCH") ?? "smoke";
const maxTurns = Math.min(Number(Deno.env.get("SIM_MAX_TURNS") ?? "30"), 30);
const output = Deno.env.get("SIM_OUTPUT") ?? `simulation/runs/${batch}-${mode}.json`;

type Telemetry = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  observations: AdapterObservation[];
  errors: string[];
  http_statuses: Record<string, number>;
  network_errors: Record<string, number>;
  started_at: string;
};

const telemetry: Telemetry = {
  calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  observations: [],
  errors: [],
  http_statuses: {},
  network_errors: {},
  started_at: new Date().toISOString(),
};

function uuidFromScenario(id: string): string {
  const hex = [...new TextEncoder().encode(id)].map((byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function deterministicAdapter(): LanguageInterpreter {
  return new ControlledLlmAdapter({
    enabled: false,
    provider: { name: "deterministic", model: "deterministic", createRequest: () => ({ url: "", headers: {}, body: "" }), extractText: () => "{}" },
    network: fetchBoundary,
    observe: (event) => telemetry.observations.push(event),
  });
}

function geminiAdapter(): LanguageInterpreter {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!key) throw new Error("GEMINI_API_KEY is required for SIM_PROVIDER=gemini");
  const provider = new GeminiProvider(model, key);
  return new ControlledLlmAdapter({
    enabled: true,
    timeoutMs: 12000,
    provider,
    network: async (request, signal) => {
      telemetry.calls += 1;
      let response;
      try {
        response = await fetchBoundary(request, signal);
        const status = String(response.status);
        telemetry.http_statuses[status] = (telemetry.http_statuses[status] ?? 0) + 1;
      } catch (error) {
        const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "UnknownError";
        telemetry.network_errors[name] = (telemetry.network_errors[name] ?? 0) + 1;
        throw error;
      }
      try {
        const body = JSON.parse(response.body) as Record<string, unknown>;
        const usage = body.usageMetadata as Record<string, unknown> | undefined;
        telemetry.input_tokens += Number(usage?.promptTokenCount ?? 0);
        telemetry.output_tokens += Number(usage?.candidatesTokenCount ?? 0);
        telemetry.total_tokens += Number(usage?.totalTokenCount ?? 0);
      } catch { /* provider failures are already represented by status/body category */ }
      return response;
    },
    observe: (event) => telemetry.observations.push(event),
  });
}

function scenariosForBatch(): Scenario[] {
  if (batch === "smoke") return DEVELOPMENT_SCENARIOS.slice(0, 5);
  if (batch === "ten") return DEVELOPMENT_SCENARIOS.slice(0, 10);
  if (batch === "novel") return NOVEL_SCENARIOS;
  return DEVELOPMENT_SCENARIOS;
}

async function runScenario(scenario: Scenario) {
  const store = new LabStore(uuidFromScenario(scenario.id));
  const citizen = new SimulatedCitizen(scenario);
  const interpreter = mode === "gemini" ? geminiAdapter() : deterministicAdapter();
  let visibleReply: string | null = null;
  const started = performance.now();
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const body = citizen.next(visibleReply);
    if (!body) break;
    const inbound: RuntimeInbound = {
      external_message_id: `${scenario.id}-m${turn + 1}`,
      phone_e164: "+5511000000000",
      contact_name: "Munícipe Simulado",
      body,
      message_type: "text",
      metadata: { simulation: true, scenario_id: scenario.id },
    };
    try {
      const result = await processOfficialTurn(inbound, store, interpreter, { automatic_replies_allowed: true });
      visibleReply = result.reply_body;
      if (result.kind === "HUMAN_ACTIVE") break;
    } catch (error) {
      telemetry.errors.push(`${scenario.id}: ${error instanceof Error ? error.message : "unknown"}`);
      break;
    }
  }
  return {
    scenario: { id: scenario.id, group: scenario.group, title: scenario.title, tags: scenario.tags, truth: scenario.truth },
    turns: store.turns,
    final_state: store.state,
    evaluation: evaluateScenario(scenario, store.turns),
    metrics: { turn_count: store.turns.length, revision: store.revision, outbox_count: store.outbox.size, duration_ms: Math.round(performance.now() - started) },
  };
}

const started = performance.now();
const results = [];
for (const scenario of scenariosForBatch()) results.push(await runScenario(scenario));
const failed = results.filter((result) => result.evaluation.deterministic_failures.length > 0).length;
const payload = {
  schema_version: "sana/simulation-lab/1.0.0",
  generated_at: new Date().toISOString(),
  batch,
  provider_mode: mode,
  model_requested: mode === "gemini" ? model : "deterministic",
  runtime_entrypoint: "processOfficialTurn",
  transport: "synthetic inbound + LabStore + QUEUE_ONLY fake outbox",
  divergences: ["Frozen runtime uses Gemini for interpretation only; reply.ts is the official response renderer and there is no separate Gemini draft stage in this source cut."],
  safety: { production_changed: false, whatsapp_sent: 0, edge_published: false, gateway_changed: false, wapi_changed: false, external_delivery: false },
  limits: { max_conversations: 100, max_turns_per_conversation: 30, max_estimated_cost_usd: 2 },
  telemetry: { ...telemetry, elapsed_ms: Math.round(performance.now() - started), estimated_standard_paid_text_cost_usd: (telemetry.input_tokens * 0.1 + telemetry.output_tokens * 0.4) / 1_000_000 },
  summary: { conversations: results.length, turns: results.reduce((sum, result) => sum + result.metrics.turn_count, 0), failed_conversations: failed, complete: results.length === scenariosForBatch().length },
  results,
};
await Deno.writeTextFile(output, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ output, batch, provider_mode: mode, conversations: results.length, turns: payload.summary.turns, failed_conversations: failed, gemini_calls: telemetry.calls, tokens: telemetry.total_tokens, estimated_cost_usd: payload.telemetry.estimated_standard_paid_text_cost_usd, production_changed: false, whatsapp_sent: 0 }));
