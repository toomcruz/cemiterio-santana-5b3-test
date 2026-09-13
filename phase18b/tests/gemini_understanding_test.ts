import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type ControlledAiObservation,
  ControlledGeminiUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/gemini.ts";
import type { UnderstandingResult } from "../../santana-conversation-domain/motor-v2/types.ts";
import type { NetworkBoundary } from "../../santana-conversation-domain/runtime/adapter/network_types.ts";

const messages = [{ turn_id: "turn_1", role: "user" as const, content: "Preciso de exumação." }];

function response(result: unknown): string {
  return JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(result) }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
  });
}

const valid: UnderstandingResult = {
  schema_version: "motor-v2-understanding/1.0.0",
  journeys: ["RESTOS_MORTAIS"],
  subintents: ["EXUMACAO"],
  transverse_states: [],
  intent_changed: false,
  complexity: "low",
  risk: { level: "none", signals: [] },
  confidence: "high",
  evidence_turns: ["turn_1"],
};

Deno.test("controlled Gemini provider uses valid structured AI output and fixed egress", async () => {
  const observations: unknown[] = [];
  const network: NetworkBoundary = (request) => {
    assertEquals(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    assertEquals(request.headers["x-goog-api-key"], "test-secret");
    assert(!request.body.includes("test-secret"));
    const body = JSON.parse(request.body);
    assertEquals(body.generationConfig.temperature, 0);
    assertEquals(body.generationConfig.responseMimeType, "application/json");
    assert(!request.body.includes("uniqueItems"));
    return Promise.resolve({ status: 200, body: response(valid) });
  };
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey: "test-secret",
    model: "gemini-test",
    network,
    observe: (event) => observations.push(event),
  });
  assertEquals(await provider.understand(messages), valid);
  assertEquals(provider.metadata.uses_ai, true);
  assertEquals(observations.length, 1);
  assertEquals((observations[0] as { outcome: string }).outcome, "llm_valid");
});

Deno.test("controlled Gemini provider falls back after unknown label", async () => {
  const observations: ControlledAiObservation[] = [];
  const network: NetworkBoundary = () =>
    Promise.resolve({
      status: 200,
      body: response({ ...valid, subintents: ["REGRA_INVENTADA"] }),
    });
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey: "test-secret",
    model: "gemini-test",
    network,
    observe: (event) => observations.push(event),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(observations.length, 1);
  assertEquals(observations[0]?.outcome, "fallback_invalid");
  assertEquals(observations[0]?.provider_attempted, true);
  assertEquals(observations[0]?.ai_output_used, false);
  assertEquals(observations[0]?.fallback_used, true);
  assertEquals(observations[0]?.rejection_code, "STRUCTURED_OUTPUT_REJECTED");
});

Deno.test("controlled Gemini provider falls back on timeout", async () => {
  const outcomes: string[] = [];
  const network: NetworkBoundary = (_request, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey: "test-secret",
    model: "gemini-test",
    timeoutMs: 250,
    network,
    observe: (event) => outcomes.push(event.outcome),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(outcomes, ["fallback_timeout"]);
});

Deno.test("controlled Gemini provider falls back on HTTP error without response leakage", async () => {
  const rejections: Array<string | null> = [];
  const provider = new ControlledGeminiUnderstandingProvider({
    apiKey: "test-secret",
    model: "gemini-test",
    network: () => Promise.resolve({ status: 429, body: "private provider body" }),
    observe: (event) => rejections.push(event.rejection_code),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(rejections, ["PROVIDER_QUOTA"]);
});
