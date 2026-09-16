/** Synthetic, no-private-data compatibility probe for the existing Gemini key. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";

interface Variant {
  id: string;
  generationConfig: Record<string, unknown>;
}

const variants: Variant[] = [
  {
    id: "response_json_schema_minimal",
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: { label: { type: "string", enum: ["TEST"] } },
        required: ["label"],
        additionalProperties: false,
      },
      temperature: 0,
    },
  },
  {
    id: "response_schema_legacy_minimal",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { label: { type: "STRING", enum: ["TEST"] } },
        required: ["label"],
      },
      temperature: 0,
    },
  },
  {
    id: "json_mime_without_schema",
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  },
];

function safeError(body: string): { provider_status: string | null; diagnostic: string | null } {
  try {
    const error = (JSON.parse(body) as { error?: { status?: unknown; message?: unknown } }).error;
    const status = typeof error?.status === "string" && /^[A-Z_]+$/.test(error.status) ? error.status : null;
    const message = typeof error?.message === "string" ? error.message : "";
    const diagnostic = message
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

async function main(): Promise<void> {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
  const output = Deno.args[0];
  if (!key || !output) throw new Error("provider key and output path are required");
  const rows = [];
  for (const variant of variants) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Return the single label TEST as JSON." }] }],
          generationConfig: variant.generationConfig,
        }),
      },
    );
    const body = await response.text();
    rows.push({
      variant: variant.id,
      http_status: response.status,
      success: response.ok,
      ...(response.ok ? { structured_text_present: /\{/.test(body) } : safeError(body)),
    });
  }
  const result = {
    schema_version: "phase18b-gemini-compatibility-probe/1.0.0",
    model,
    synthetic_input_only: true,
    credentials_persisted: false,
    results: rows,
  };
  await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
  console.log(canonicalJson(result));
  if (!rows.some((row) => row.success)) Deno.exit(2);
}

if (import.meta.main) await main();
