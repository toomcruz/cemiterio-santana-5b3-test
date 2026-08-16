import type { LlmProvider } from "../runtime/adapter/adapter.ts";

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODEL = "gemini-2.5-flash";

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

  usageFromResponse(responseBody: string): { input_tokens: number; output_tokens: number } | null {
    const usage =
      (JSON.parse(responseBody) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
        .usageMetadata;
    if (!usage || typeof usage.promptTokenCount !== "number" || typeof usage.candidatesTokenCount !== "number") {
      return null;
    }
    return { input_tokens: usage.promptTokenCount, output_tokens: usage.candidatesTokenCount };
  }
}
