import type { NetworkBoundary } from "../../runtime/adapter/network_types.ts";
import { fetchBoundary } from "../../runtime/adapter/network.ts";
import { canonicalJson } from "../canonical_json.ts";
import type { MotorV2Message, UnderstandingProviderMetadata, UnderstandingResult } from "../types.ts";
import {
  guardUnderstanding,
  type UnderstandingProvider,
  understandingVocabulary,
  understandMessages,
  validateProviderLabelsAndEvidence,
} from "../understanding.ts";

export interface ControlledAiObservation {
  outcome: "llm_valid" | "fallback_timeout" | "fallback_http" | "fallback_invalid" | "fallback_error";
  provider: "gemini";
  model: string;
  provider_attempted: true;
  ai_output_used: boolean;
  fallback_used: boolean;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  rejection_code: string | null;
}

export interface ControlledGeminiUnderstandingOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  network?: NetworkBoundary;
  observe?: (event: ControlledAiObservation) => void;
}

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super("provider HTTP failure");
  }
}

function responseSchema(turnIds: readonly string[]): Record<string, unknown> {
  const vocabulary = understandingVocabulary();
  const stringArray = (values: readonly string[], maxItems = values.length) => ({
    type: "array",
    maxItems,
    items: { type: "string", enum: values },
  });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "journeys",
      "subintents",
      "transverse_states",
      "intent_changed",
      "complexity",
      "risk",
      "confidence",
      "evidence_turns",
    ],
    properties: {
      schema_version: { type: "string", enum: ["motor-v2-understanding/1.0.0"] },
      journeys: stringArray(vocabulary.journeys),
      subintents: stringArray(vocabulary.subintents),
      transverse_states: stringArray(vocabulary.transverse_states),
      intent_changed: { type: "boolean" },
      complexity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      risk: {
        type: "object",
        additionalProperties: false,
        required: ["level", "signals"],
        properties: {
          level: { type: "string", enum: ["none", "P3", "P2", "P1", "P0"] },
          signals: stringArray(vocabulary.risk_signals),
        },
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      evidence_turns: stringArray(turnIds, turnIds.length),
    },
  };
}

function prompt(messages: readonly MotorV2Message[]): string {
  const vocabulary = understandingVocabulary();
  return [
    "Classifique apenas o significado conversacional das mensagens sanitizadas abaixo.",
    "Use exclusivamente os rótulos fornecidos e devolva somente JSON conforme o schema.",
    "Não crie regras administrativas, prazos, valores, documentos, autorizações, elegibilidade ou procedimentos.",
    "Não copie texto da conversa. evidence_turns contém apenas IDs dos turnos que sustentam a classificação.",
    "Jornadas: " + vocabulary.journeys.join(", "),
    "Subintenções: " + vocabulary.subintents.join(", "),
    "Estados transversais: " + vocabulary.transverse_states.join(", "),
    "Sinais de risco: " + vocabulary.risk_signals.join(", "),
    "Mensagens JSON: " + canonicalJson(messages.map(({ turn_id, role, content }) => ({ turn_id, role, content }))),
  ].join("\n");
}

function extractStructuredBody(
  body: string,
): { result: unknown; inputTokens: number | null; outputTokens: number | null } {
  const parsed = JSON.parse(body) as GeminiResponse;
  const candidate = parsed.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new Error("PROVIDER_INCOMPLETE");
  const text = candidate.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("");
  if (!text?.trim()) throw new Error("PROVIDER_EMPTY");
  return {
    result: JSON.parse(text),
    inputTokens: Number.isInteger(parsed.usageMetadata?.promptTokenCount)
      ? parsed.usageMetadata?.promptTokenCount ?? null
      : null,
    outputTokens: Number.isInteger(parsed.usageMetadata?.candidatesTokenCount)
      ? parsed.usageMetadata?.candidatesTokenCount ?? null
      : null,
  };
}

/**
 * Real-AI understanding boundary for LAB/shadow only. Any provider failure,
 * malformed schema, unknown label or invalid evidence falls back to the
 * deterministic understanding provider before the authoritative policy layer.
 */
export class ControlledGeminiUnderstandingProvider implements UnderstandingProvider {
  readonly metadata: UnderstandingProviderMetadata;
  readonly #network: NetworkBoundary;
  readonly #timeoutMs: number;
  readonly #maxOutputTokens: number;

  constructor(private readonly options: ControlledGeminiUnderstandingOptions) {
    if (!options.apiKey.trim()) throw new Error("Gemini credential is missing");
    if (!/^gemini-[a-z0-9.-]+$/.test(options.model)) throw new Error("invalid Gemini model configuration");
    this.#timeoutMs = options.timeoutMs ?? 12_000;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4096;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 250 || this.#timeoutMs > 30_000) {
      throw new Error("invalid provider timeout");
    }
    if (!Number.isInteger(this.#maxOutputTokens) || this.#maxOutputTokens < 256 || this.#maxOutputTokens > 8192) {
      throw new Error("invalid provider output budget");
    }
    this.#network = options.network ?? fetchBoundary;
    this.metadata = {
      id: "controlled-gemini-understanding-v1",
      kind: "controlled_ai",
      uses_ai: true,
      model: options.model,
      schema_guarded: false,
    };
  }

  async understand(messages: readonly MotorV2Message[]): Promise<UnderstandingResult> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    try {
      const response = await this.#network({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${this.options.model}:generateContent`,
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt(messages) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: responseSchema(messages.map((message) => message.turn_id)),
            temperature: 0,
            maxOutputTokens: this.#maxOutputTokens,
          },
        }),
      }, controller.signal);
      if (response.status < 200 || response.status >= 300) throw new ProviderHttpError(response.status);
      const extracted = extractStructuredBody(response.body);
      inputTokens = extracted.inputTokens;
      outputTokens = extracted.outputTokens;
      const result = guardUnderstanding(extracted.result);
      validateProviderLabelsAndEvidence(result, messages);
      this.emit("llm_valid", started, true, false, inputTokens, outputTokens, null);
      return result;
    } catch (error) {
      const timeout = error instanceof DOMException && error.name === "AbortError";
      const outcome: ControlledAiObservation["outcome"] = timeout
        ? "fallback_timeout"
        : error instanceof ProviderHttpError
        ? "fallback_http"
        : error instanceof SyntaxError ||
            error instanceof Error && /understanding|label|evidence|PROVIDER_/.test(error.message)
        ? "fallback_invalid"
        : "fallback_error";
      const rejectionCode = timeout
        ? "PROVIDER_TIMEOUT"
        : error instanceof ProviderHttpError
        ? error.status === 429 ? "PROVIDER_QUOTA" : `PROVIDER_HTTP_${error.status}`
        : outcome === "fallback_invalid"
        ? "STRUCTURED_OUTPUT_REJECTED"
        : "PROVIDER_ERROR";
      this.emit(outcome, started, false, true, inputTokens, outputTokens, rejectionCode);
      return understandMessages(messages);
    } finally {
      clearTimeout(timer);
    }
  }

  private emit(
    outcome: ControlledAiObservation["outcome"],
    started: number,
    aiOutputUsed: boolean,
    fallbackUsed: boolean,
    inputTokens: number | null,
    outputTokens: number | null,
    rejectionCode: string | null,
  ): void {
    this.options.observe?.({
      outcome,
      provider: "gemini",
      model: this.options.model,
      provider_attempted: true,
      ai_output_used: aiOutputUsed,
      fallback_used: fallbackUsed,
      duration_ms: Math.max(0, performance.now() - started),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      rejection_code: rejectionCode,
    });
  }
}
