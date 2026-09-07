import type { LlmProvider } from "./adapter.ts";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Controlled Gemini transport for the official interpretation adapter. */
export class GeminiProvider implements LlmProvider {
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
    const result = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof result !== "string") throw new Error("Gemini response did not contain structured text");
    return result;
  }

  usageFromResponse(responseBody: string): { input_tokens: number; output_tokens: number } | null {
    const usage =
      (JSON.parse(responseBody) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
        .usageMetadata;
    if (!usage || typeof usage.promptTokenCount !== "number" || typeof usage.candidatesTokenCount !== "number") {
      return null;
    }
    return { input_tokens: usage.promptTokenCount, output_tokens: usage.candidatesTokenCount };
  }

  classifyErrorResponse(status: number, responseBody: string): string {
    try {
      const code = (JSON.parse(responseBody) as { error?: { status?: unknown } }).error?.status;
      if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return `PROVIDER_${code}`;
    } catch {
      // The aggregate HTTP category is intentionally sufficient and safe.
    }
    return `PROVIDER_HTTP_${status}`;
  }
}
