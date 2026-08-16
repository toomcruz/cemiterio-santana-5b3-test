import { interpret as deterministicInterpret } from "../interpreter/deterministic.ts";
import { guardInterpretation } from "../interpreter/guard.ts";
import type { Interpretation, InterpreterInput } from "../interpreter/types.ts";
import type { NetworkBoundary } from "./network.ts";
import { buildPrompt, PROMPT_VERSION } from "./prompt.ts";
import { assertStrictInterpretation, parseStrictInterpretation } from "./schema.ts";

export const ADAPTER_VERSION = "santana-llm-adapter/1.0.0";
export const DEFAULT_LLM_ENABLED = false;

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  createRequest(prompt: string): { url: string; headers: Readonly<Record<string, string>>; body: string };
  extractText(responseBody: string): string;
  /** Optional, provider-specific accounting extracted after the response is received. */
  usageFromResponse?(responseBody: string): { input_tokens: number; output_tokens: number } | null;
}

export interface AdapterObservation {
  outcome: "llm_valid" | "fallback_disabled" | "fallback_timeout" | "fallback_error" | "fallback_invalid";
  adapter_version: string;
  prompt_version: string;
  provider: string;
  model: string;
  duration_ms: number;
  // Deliberately excludes message, prompt, response, headers, URL, and error detail.
}

export interface AdapterOptions {
  enabled?: boolean;
  timeoutMs?: number;
  provider: LlmProvider;
  network: NetworkBoundary;
  observe?: (event: AdapterObservation) => void;
}

export interface LanguageInterpreter {
  interpret(input: InterpreterInput): Promise<Interpretation>;
}

export class ControlledLlmAdapter implements LanguageInterpreter {
  constructor(private readonly options: AdapterOptions) {}

  async interpret(input: InterpreterInput): Promise<Interpretation> {
    const started = performance.now();
    if (!(this.options.enabled ?? DEFAULT_LLM_ENABLED)) return this.fallback(input, "fallback_disabled", started);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 3_000);
    try {
      const request = this.options.provider.createRequest(buildPrompt(input));
      const response = await this.options.network(request, controller.signal);
      if (response.status < 200 || response.status >= 300) throw new Error("provider HTTP failure");
      const parsed = parseStrictInterpretation(this.options.provider.extractText(response.body), input);
      const guarded = guardInterpretation(parsed);
      const unsafeToAdvance = guarded.overall_confidence === "LOW" || guarded.ambiguities.some((a) => a.blocking) ||
        guarded.facts.some((f) => f.requires_confirmation) || guarded.case_reference.kind === "AMBIGUOUS";
      const result = unsafeToAdvance
        ? {
          ...guarded,
          needs_clarification: true,
          clarification_reason: guarded.clarification_reason ?? "interpretacao ambigua ou de baixa confianca",
        }
        : guarded;
      assertStrictInterpretation(result);
      this.emit("llm_valid", started);
      return result;
    } catch (error) {
      const outcome = error instanceof DOMException && error.name === "AbortError"
        ? "fallback_timeout"
        : error instanceof Error && error.name === "InvalidInterpretationError"
        ? "fallback_invalid"
        : "fallback_error";
      return this.fallback(input, outcome, started);
    } finally {
      clearTimeout(timer);
    }
  }

  private fallback(input: InterpreterInput, outcome: AdapterObservation["outcome"], started: number): Interpretation {
    this.emit(outcome, started);
    const result = guardInterpretation(deterministicInterpret(input));
    assertStrictInterpretation(result);
    return result;
  }

  private emit(outcome: AdapterObservation["outcome"], started: number): void {
    this.options.observe?.({
      outcome,
      adapter_version: ADAPTER_VERSION,
      prompt_version: PROMPT_VERSION,
      provider: this.options.provider.name,
      model: this.options.provider.model,
      duration_ms: Math.max(0, performance.now() - started),
    });
  }
}
