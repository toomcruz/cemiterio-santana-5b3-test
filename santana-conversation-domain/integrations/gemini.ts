import type { LlmProvider } from "../runtime/adapter/adapter.ts";

const schema: Record<string, unknown> = JSON.parse(
  Deno.readTextFileSync(new URL("../runtime/interpretation.schema.json", import.meta.url)),
);

/** Official server-side transport. The model is configuration, never user input. */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(readonly model: string, private readonly apiKey: string, private readonly maxOutputTokens = 4096) {
    if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error("invalid Gemini model configuration");
    if (!apiKey.trim()) throw new Error("Gemini credential is missing");
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 8192) {
      throw new Error("invalid output token budget");
    }
  }

  createRequest(prompt: string): { url: string; headers: Readonly<Record<string, string>>; body: string } {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0,
          maxOutputTokens: this.maxOutputTokens,
        },
      }),
    };
  }

  extractText(body: string): string {
    const result = JSON.parse(body) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    const candidate = result.candidates?.[0];
    if (candidate?.finishReason !== "STOP") throw new Error("Gemini response is incomplete or blocked");
    const text = candidate.content?.parts?.filter((part) => !part.thought)
      .map((part) => part.text ?? "").join("");
    if (!text?.trim()) throw new Error("Gemini response has no structured content");
    return text;
  }

  classifyErrorResponse(status: number): string {
    // Never propagate provider response text or credential-containing error details.
    return status === 429 ? "PROVIDER_QUOTA" : `PROVIDER_HTTP_${status}`;
  }
}
