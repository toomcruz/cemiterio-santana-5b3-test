import {
  type ControlledAiObservation,
  ControlledGeminiUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/gemini.ts";
import type { LanguageInterpreter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import { MotorV2OfficialInterpreter } from "./motor-v2-official-interpreter.ts";

export type MotorV2GeminiObservation = ControlledAiObservation;

/** Gemini-only Motor V2 boundary. Provider failures never downgrade silently. */
export function createMotorV2GeminiInterpreter(
  apiKey: string,
  model: string,
  observe?: (event: MotorV2GeminiObservation) => void,
  observeUnderstanding?: ConstructorParameters<typeof MotorV2OfficialInterpreter>[1],
): LanguageInterpreter {
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey,
    model,
    timeoutMs: 12_000,
    maxOutputTokens: 1024,
    failOnFallback: true,
    observe,
  });
  return new MotorV2OfficialInterpreter(provider, observeUnderstanding);
}
