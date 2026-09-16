/** One synthetic, bounded probe through the production-approved adapter. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import type { MotorV2Message } from "../../santana-conversation-domain/motor-v2/types.ts";
import { fetchBoundary } from "../../santana-conversation-domain/runtime/adapter/network.ts";

const PROBE_TIMEOUT_MS = 60_000;

const syntheticMessages: readonly MotorV2Message[] = [{
  turn_id: "probe-turn-1",
  role: "user",
  content: "Preciso de orientação sobre exumação; não execute nenhuma ação.",
}];

async function main(): Promise<void> {
  const key = (Deno.env.get("NVIDIA_API_KEY") ?? "").trim();
  const output = Deno.args[0];
  if (!key || !output) throw new Error("provider key and output path are required");
  const observations: ControlledNvidiaAiObservation[] = [];
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: key,
    model: CONTROLLED_NVIDIA_MODEL,
    timeoutMs: PROBE_TIMEOUT_MS,
    maxOutputTokens: 1024,
    failOnFallback: true,
    network: fetchBoundary,
    observe: (event) => observations.push(event),
  });
  let success = false;
  let diagnostic: string | null = null;
  try {
    await provider.understand(syntheticMessages);
    success = observations.at(-1)?.outcome === "llm_valid" && observations.at(-1)?.ai_output_used === true;
  } catch (error) {
    diagnostic = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PROVIDER_PROBE_FAILED";
  }
  const observation = observations.at(-1) ?? null;
  const result = {
    schema_version: "phase19c1-nvidia-adapter-probe/2.0.0",
    synthetic_input_only: true,
    credentials_persisted: false,
    call_count: 1,
    max_calls: 1,
    timeout_ms: PROBE_TIMEOUT_MS,
    retries: 0,
    adapter: "ControlledNvidiaUnderstandingProvider",
    provider_attempted: observation?.provider_attempted === true,
    selected_model: success ? CONTROLLED_NVIDIA_MODEL : null,
    uses_ai: observation?.ai_output_used === true,
    structured_output_valid: success,
    fallback_used: observation?.fallback_used === true,
    diagnostic,
    result: observation,
  };
  await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
  console.log(canonicalJson(result));
  if (!success) Deno.exit(2);
}

if (import.meta.main) await main();
