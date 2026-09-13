/** One-call, read-only inventory of model IDs visible to the existing NVIDIA key. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";

const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
const CATALOG_TIMEOUT_MS = 20_000;

export function extractModelIds(body: string): string[] {
  const decoded = JSON.parse(body) as { data?: Array<{ id?: unknown }> };
  if (!decoded || typeof decoded !== "object" || !Array.isArray(decoded.data)) {
    throw new Error("invalid NVIDIA model catalog");
  }
  const ids = decoded.data.map((entry) => entry?.id).filter(
    (id): id is string => typeof id === "string" && /^[A-Za-z0-9._/-]{1,160}$/.test(id),
  );
  const unique = [...new Set(ids)].sort();
  if (!unique.length || unique.length > 1_000 || unique.length !== decoded.data.length) {
    throw new Error("invalid NVIDIA model identifiers");
  }
  return unique;
}

async function main(): Promise<void> {
  const key = (Deno.env.get("NVIDIA_API_KEY") ?? "").trim();
  const output = Deno.args[0];
  if (!key || !output) throw new Error("provider key and output path are required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetch(NVIDIA_MODELS_URL, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NVIDIA catalog HTTP ${response.status}`);
    const models = extractModelIds(await response.text());
    const result = {
      schema_version: "phase18b-nvidia-model-catalog/1.0.0",
      endpoint_host: "integrate.api.nvidia.com",
      credentials_persisted: false,
      call_count: 1,
      retries: 0,
      model_count: models.length,
      models,
    };
    await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
    console.log(canonicalJson({ model_count: models.length, schema_version: result.schema_version }));
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.main) await main();
