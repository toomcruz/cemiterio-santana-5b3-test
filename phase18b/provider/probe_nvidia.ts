/** Synthetic, bounded compatibility probe for the existing NVIDIA key. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import { CONTROLLED_NVIDIA_MODEL } from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";

const PROBE_TIMEOUT_MS = 90_000;

function safeError(body: string): { provider_status: string | null; diagnostic: string | null } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; type?: unknown };
    };
    const error = parsed.error;
    const status = typeof error?.type === "string" && /^[A-Za-z0-9_.-]+$/.test(error.type)
      ? error.type
      : typeof error?.code === "string" && /^[A-Za-z0-9_.-]+$/.test(error.code)
      ? error.code
      : null;
    return { provider_status: status, diagnostic: "PROVIDER_HTTP_ERROR" };
  } catch {
    return { provider_status: null, diagnostic: "UNPARSEABLE_PROVIDER_ERROR" };
  }
}

function validSyntheticResult(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
    };
    const choice = parsed.choices?.[0];
    if (choice?.finish_reason !== "stop") return false;
    const content = choice.message?.content;
    if (typeof content !== "string") return false;
    const result = JSON.parse(content) as unknown;
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    return canonicalJson(Object.keys(result).sort()) === canonicalJson(["label"]) &&
      (result as Record<string, unknown>).label === "TEST";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const key = (Deno.env.get("NVIDIA_API_KEY") ?? "").trim();
  const output = Deno.args[0];
  if (!key || !output) throw new Error("provider key and output path are required");
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let row: Record<string, unknown>;
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: CONTROLLED_NVIDIA_MODEL,
        messages: [{ role: "user", content: 'Return only this JSON object: {"label":"TEST"}' }],
        response_format: { type: "json_object" },
        max_tokens: 512,
        temperature: 0,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const valid = response.ok && validSyntheticResult(body);
    row = {
      model: CONTROLLED_NVIDIA_MODEL,
      http_status: response.status,
      success: valid,
      duration_ms: Math.max(0, performance.now() - started),
      ...(response.ok ? { structured_output_valid: valid } : safeError(body)),
    };
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "AbortError";
    row = {
      model: CONTROLLED_NVIDIA_MODEL,
      http_status: null,
      success: false,
      duration_ms: Math.max(0, performance.now() - started),
      provider_status: null,
      diagnostic: timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
    };
  } finally {
    clearTimeout(timer);
  }
  const selectedModel = row.success === true ? CONTROLLED_NVIDIA_MODEL : null;
  const result = {
    schema_version: "phase18b-nvidia-compatibility-probe/1.0.0",
    synthetic_input_only: true,
    credentials_persisted: false,
    call_count: 1,
    max_calls: 1,
    timeout_ms: PROBE_TIMEOUT_MS,
    retries: 0,
    selected_model: selectedModel,
    results: [row],
  };
  await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
  console.log(canonicalJson(result));
  if (!selectedModel) Deno.exit(2);
}

if (import.meta.main) await main();
