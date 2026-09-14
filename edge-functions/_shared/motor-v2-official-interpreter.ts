import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import type { UnderstandingProvider } from "../../santana-conversation-domain/motor-v2/understanding.ts";
import type { UnderstandingResult } from "../../santana-conversation-domain/motor-v2/types.ts";
import { interpret as deterministicInterpret } from "../../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../../santana-conversation-domain/runtime/interpreter/guard.ts";
import type { LanguageInterpreter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import type { Interpretation, InterpreterInput } from "../../santana-conversation-domain/runtime/interpreter/types.ts";

export type MotorV2Observation = ControlledNvidiaAiObservation;

/**
 * Bridges the approved V2 understanding boundary into the official reducer.
 * The reducer/store/outbox remain authoritative; V2 can only supply semantic
 * risk and confidence signals, never administrative facts or direct delivery.
 */
export class MotorV2OfficialInterpreter implements LanguageInterpreter {
  constructor(
    private readonly provider: UnderstandingProvider,
  ) {}

  async interpret(input: InterpreterInput): Promise<Interpretation> {
    const understanding = await this.provider.understand([
      { turn_id: input.message_id, role: "user", content: input.text },
    ]) as UnderstandingResult;
    const base = guardInterpretation(deterministicInterpret(input));
    const p0 = understanding.risk.level === "P0";
    const mediaNeedsReview = understanding.transverse_states.includes("MEDIA_NOT_ANALYZED");
    if (p0) {
      return guardInterpretation({
        ...base,
        primary_event: { event_kind: "HUMAN_REQUEST", confidence: "HIGH", evidence: input.text },
        overall_confidence: "HIGH",
        needs_clarification: false,
        clarification_reason: null,
        produced_by: "motor-v2-official-interpreter",
      });
    }
    if (mediaNeedsReview) {
      return guardInterpretation({
        ...base,
        needs_clarification: true,
        clarification_reason: "mídia essencial ainda não analisada",
        produced_by: "motor-v2-official-interpreter",
      });
    }
    return guardInterpretation({ ...base, produced_by: "motor-v2-official-interpreter" });
  }
}

export function createMotorV2OfficialInterpreter(
  apiKey: string,
  observe?: (event: MotorV2Observation) => void,
): MotorV2OfficialInterpreter {
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey,
    model: CONTROLLED_NVIDIA_MODEL,
    timeoutMs: 60_000,
    maxOutputTokens: 1024,
    failOnFallback: true,
    observe,
  });
  return new MotorV2OfficialInterpreter(provider);
}
