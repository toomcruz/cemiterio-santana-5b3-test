import type { LlmProvider } from "../runtime/adapter/adapter.ts";
import type { NetworkBoundary, NetworkRequest } from "../runtime/adapter/network.ts";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

const STABLE_FLASH_PREFERENCE = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

export interface GeminiModelSummary {
  id: string;
  supports_generate_content: boolean;
}

export class GeminiProviderError extends Error {
  constructor(readonly category: string) {
    super(category);
  }
}

export function classifyGeminiError(status: number, responseBody: string, scope: "models_list" | "model_call"): string {
  try {
    const code = (JSON.parse(responseBody) as { error?: { status?: unknown } }).error?.status;
    if (scope === "model_call" && code === "NOT_FOUND") return "PROVIDER_MODEL_NOT_FOUND";
    if (code === "RESOURCE_EXHAUSTED") return "PROVIDER_QUOTA";
    if (code === "UNAUTHENTICATED") return "PROVIDER_HTTP_401";
    if (code === "PERMISSION_DENIED") return "PROVIDER_HTTP_403";
    if (code === "INVALID_ARGUMENT") return "PROVIDER_INVALID_ARGUMENT";
  } catch {
    // The aggregate HTTP category below is intentionally sufficient and safe.
  }
  return status >= 500 ? "PROVIDER_HTTP_5XX" : `PROVIDER_HTTP_${status}`;
}

export function selectStableFlashModels(models: readonly GeminiModelSummary[]): string[] {
  const available = new Set(
    models.filter((model) => model.supports_generate_content).map((model) => model.id),
  );
  return STABLE_FLASH_PREFERENCE.filter((model) => available.has(model));
}

export async function listGeminiModels(
  apiKey: string,
  network: NetworkBoundary,
  signal: AbortSignal,
): Promise<GeminiModelSummary[]> {
  const request: NetworkRequest = {
    method: "GET",
    url: GEMINI_API_ROOT,
    headers: { "x-goog-api-key": apiKey },
    body: "",
  };
  const response = await network(request, signal);
  if (response.status < 200 || response.status >= 300) {
    throw new GeminiProviderError(classifyGeminiError(response.status, response.body, "models_list"));
  }
  try {
    const parsed = JSON.parse(response.body) as {
      models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
    };
    if (!Array.isArray(parsed.models)) throw new Error("models missing");
    return parsed.models.flatMap((model) => {
      if (typeof model.name !== "string" || !model.name.startsWith("models/")) return [];
      const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
      return [{
        id: model.name.slice("models/".length),
        supports_generate_content: methods.includes("generateContent"),
      }];
    });
  } catch {
    throw new GeminiProviderError("PROVIDER_MODELS_LIST_PARSE_ERROR");
  }
}

/**
 * Provider implementation used only by the manually-dispatched benchmark.
 * The key is supplied by the runner and is never returned, logged, or persisted.
 */
export class GeminiBenchmarkProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly responseSchema: Record<string, unknown>,
  ) {}

  createRequest(prompt: string): { url: string; headers: Readonly<Record<string, string>>; body: string } {
    return {
      url: `${GEMINI_API_ROOT}/${encodeURIComponent(this.model)}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: this.responseSchema,
          temperature: 0,
        },
      }),
    };
  }

  extractText(responseBody: string): string {
    const response = JSON.parse(responseBody) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Gemini response did not contain structured text");
    return text;
  }

  usageFromResponse(responseBody: string): { input_tokens: number; output_tokens: number; total_tokens: number } | null {
    const usage =
      (JSON.parse(responseBody) as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      })
        .usageMetadata;
    if (!usage || typeof usage.promptTokenCount !== "number" || typeof usage.candidatesTokenCount !== "number") {
      return null;
    }
    return {
      input_tokens: usage.promptTokenCount,
      output_tokens: usage.candidatesTokenCount,
      total_tokens: typeof usage.totalTokenCount === "number"
        ? usage.totalTokenCount
        : usage.promptTokenCount + usage.candidatesTokenCount,
    };
  }

  classifyErrorResponse(status: number, responseBody: string): string {
    try {
      return classifyGeminiError(status, responseBody, "model_call");
    } catch {
      return `PROVIDER_HTTP_${status}`;
    }
  }
}
