/** Synthetic, bounded compatibility probe for the existing NVIDIA key. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";

interface Candidate {
  model: string;
  settings: Record<string, unknown>;
}

const candidates: Candidate[] = [
  {
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    settings: { temperature: 0, chat_template_kwargs: { enable_thinking: false } },
  },
  {
    model: "qwen/qwen3.5-122b-a10b",
    settings: { temperature: 0.7, top_p: 0.8, chat_template_kwargs: { enable_thinking: false } },
  },
  {
    model: "deepseek-ai/DeepSeek-V4-Pro-0813",
    settings: { temperature: 1, reasoning_effort: "low" },
  },
];

function safeError(body: string): { provider_status: string | null; diagnostic: string | null } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; type?: unknown; message?: unknown };
      detail?: unknown;
    };
    const error = parsed.error;
    const status = typeof error?.type === "string" && /^[A-Za-z0-9_.-]+$/.test(error.type)
      ? error.type
      : typeof error?.code === "string" && /^[A-Za-z0-9_.-]+$/.test(error.code)
      ? error.code
      : null;
    const raw = typeof error?.message === "string"
      ? error.message
      : typeof parsed.detail === "string"
      ? parsed.detail
      : "";
    const diagnostic = raw
      .replace(/"[^"]*"/g, '"[VALUE]"')
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(/[^A-Za-z0-9_ .:[\]-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    return { provider_status: status, diagnostic: diagnostic || null };
  } catch {
    return { provider_status: null, diagnostic: "UNPARSEABLE_PROVIDER_ERROR" };
  }
}

function validSyntheticResult(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") return false;
    const result = JSON.parse(content) as { label?: unknown };
    return result.label === "TEST";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const key = Deno.env.get("NVIDIA_API_KEY") ?? "";
  const output = Deno.args[0];
  if (!key || !output) throw new Error("provider key and output path are required");
  const rows = [];
  let selectedModel: string | null = null;
  for (const candidate of candidates) {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: candidate.model,
        messages: [{ role: "user", content: 'Return only this JSON object: {"label":"TEST"}' }],
        response_format: { type: "json_object" },
        max_tokens: 512,
        stream: false,
        ...candidate.settings,
      }),
    });
    const body = await response.text();
    const valid = response.ok && validSyntheticResult(body);
    rows.push({
      model: candidate.model,
      http_status: response.status,
      success: valid,
      ...(response.ok ? { structured_output_valid: valid } : safeError(body)),
    });
    if (valid) {
      selectedModel = candidate.model;
      break;
    }
    if ([401, 403, 429].includes(response.status)) break;
  }
  const result = {
    schema_version: "phase18b-nvidia-compatibility-probe/1.0.0",
    synthetic_input_only: true,
    credentials_persisted: false,
    call_count: rows.length,
    max_calls: candidates.length,
    selected_model: selectedModel,
    results: rows,
  };
  await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
  console.log(canonicalJson(result));
  if (!selectedModel) Deno.exit(2);
}

if (import.meta.main) await main();
