import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  CONTROLLED_NVIDIA_MODEL,
  type ControlledNvidiaAiObservation,
  ControlledNvidiaUnderstandingProvider,
} from "../../santana-conversation-domain/motor-v2/providers/nvidia.ts";
import { MotorV2Runtime } from "../../santana-conversation-domain/motor-v2/runtime.ts";
import type { UnderstandingResult } from "../../santana-conversation-domain/motor-v2/types.ts";
import type { NetworkBoundary } from "../../santana-conversation-domain/runtime/adapter/network_types.ts";
import { extractModelIds } from "../provider/catalog_nvidia.ts";

const messages = [{ turn_id: "turn_1", role: "user" as const, content: "Preciso de exumação." }];

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

Deno.test("NVIDIA catalog accepts only a closed set of safe public model IDs", () => {
  assertEquals(
    extractModelIds(JSON.stringify({ data: [{ id: "vendor/model-b" }, { id: "vendor/model-a" }] })),
    ["vendor/model-a", "vendor/model-b"],
  );
  assertThrows(() => extractModelIds(JSON.stringify({ data: [{ id: "unsafe model" }] })), Error, "identifiers");
  assertThrows(() => extractModelIds(JSON.stringify({ data: [] })), Error, "identifiers");
});

function response(result: unknown, finishReason = "stop"): string {
  return JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 21, completion_tokens: 11 },
  });
}

Deno.test("controlled NVIDIA provider uses one fixed bounded structured request", async () => {
  const observations: ControlledNvidiaAiObservation[] = [];
  let calls = 0;
  const network: NetworkBoundary = (request, signal) => {
    calls += 1;
    assertEquals(request.url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assertEquals(request.headers.authorization, "Bearer test-secret");
    assertEquals(request.headers["content-type"], "application/json");
    assert(!request.url.includes("test-secret"));
    assert(!request.body.includes("test-secret"));
    assertEquals(signal.aborted, false);
    const body = JSON.parse(request.body);
    assertEquals(body.model, CONTROLLED_NVIDIA_MODEL);
    assertEquals(body.response_format, { type: "json_object" });
    assertEquals(body.max_tokens, 1024);
    assertEquals(body.temperature, 0);
    assertEquals(body.stream, false);
    assertEquals("chat_template_kwargs" in body, false);
    assertEquals(body.messages.length, 1);
    assert(body.messages[0].content.includes("Não crie regras administrativas"));
    assert(body.messages[0].content.includes('"turn_id":"turn_1"'));
    return Promise.resolve({ status: 200, body: response(valid) });
  };
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: "test-secret",
    model: CONTROLLED_NVIDIA_MODEL,
    network,
    observe: (event) => observations.push(event),
  });

  assertEquals(await provider.understand(messages), valid);
  assertEquals(calls, 1);
  assertEquals(provider.metadata, {
    id: "controlled-nvidia-understanding-v1",
    kind: "controlled_ai",
    uses_ai: true,
    model: CONTROLLED_NVIDIA_MODEL,
    schema_guarded: false,
  });
  assert(!JSON.stringify(provider).includes("test-secret"));
  assertEquals(observations.length, 1);
  assertEquals(observations[0]?.outcome, "llm_valid");
  assertEquals(observations[0]?.provider_attempted, true);
  assertEquals(observations[0]?.ai_output_used, true);
  assertEquals(observations[0]?.fallback_used, false);
  assertEquals(observations[0]?.input_tokens, 21);
  assertEquals(observations[0]?.output_tokens, 11);
  assert((observations[0]?.duration_ms ?? -1) >= 0);
});

Deno.test("controlled NVIDIA provider rejects model-created labels, evidence, and administrative rules", async () => {
  const rejected = [
    { ...valid, subintents: ["REGRA_INVENTADA"] },
    { ...valid, evidence_turns: ["turn_inventado"] },
    { ...valid, current_value: "regra administrativa inventada" },
    { ...valid, risk: { ...valid.risk, current_value: "regra aninhada inventada" } },
    { ...valid, complexity: ["low"] },
    { ...valid, confidence: ["high"] },
    { ...valid, risk: { ...valid.risk, level: ["none"] } },
  ];
  for (const output of rejected) {
    let calls = 0;
    const observations: ControlledNvidiaAiObservation[] = [];
    const provider = new ControlledNvidiaUnderstandingProvider({
      apiKey: "test-secret",
      network: () => {
        calls += 1;
        return Promise.resolve({ status: 200, body: response(output) });
      },
      observe: (event) => observations.push(event),
    });
    const result = await provider.understand(messages);
    assert(result.subintents.includes("EXUMACAO"));
    assertEquals(calls, 1);
    assertEquals(observations.length, 1);
    assertEquals(observations[0]?.outcome, "fallback_invalid");
    assertEquals(observations[0]?.ai_output_used, false);
    assertEquals(observations[0]?.fallback_used, true);
    assertEquals(observations[0]?.rejection_code, "STRUCTURED_OUTPUT_REJECTED");
  }
});

Deno.test("controlled NVIDIA provider rejects incomplete output without retry", async () => {
  let calls = 0;
  const observations: ControlledNvidiaAiObservation[] = [];
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: "test-secret",
    network: () => {
      calls += 1;
      return Promise.resolve({ status: 200, body: response(valid, "length") });
    },
    observe: (event) => observations.push(event),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(calls, 1);
  assertEquals(observations[0]?.outcome, "fallback_invalid");
  assertEquals(observations[0]?.input_tokens, 21);
  assertEquals(observations[0]?.output_tokens, 11);
});

Deno.test("controlled NVIDIA provider times out once and falls back deterministically", async () => {
  let calls = 0;
  const observations: ControlledNvidiaAiObservation[] = [];
  const network: NetworkBoundary = (_request, signal) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: "test-secret",
    timeoutMs: 250,
    network,
    observe: (event) => observations.push(event),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(calls, 1);
  assertEquals(observations.length, 1);
  assertEquals(observations[0]?.outcome, "fallback_timeout");
  assertEquals(observations[0]?.rejection_code, "PROVIDER_TIMEOUT");
});

Deno.test("controlled NVIDIA provider maps safe HTTP telemetry without retry or body leakage", async () => {
  let calls = 0;
  const observations: ControlledNvidiaAiObservation[] = [];
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: "test-secret",
    network: () => {
      calls += 1;
      return Promise.resolve({ status: 429, body: "private provider body" });
    },
    observe: (event) => observations.push(event),
  });
  const result = await provider.understand(messages);
  assert(result.subintents.includes("EXUMACAO"));
  assertEquals(calls, 1);
  assertEquals(observations.length, 1);
  assertEquals(observations[0]?.outcome, "fallback_http");
  assertEquals(observations[0]?.rejection_code, "PROVIDER_QUOTA");
  assert(!JSON.stringify(observations).includes("private provider body"));
});

Deno.test("controlled NVIDIA provider configuration is closed and bounded", () => {
  assertThrows(
    () => new ControlledNvidiaUnderstandingProvider({ apiKey: "", model: CONTROLLED_NVIDIA_MODEL }),
    Error,
    "credential",
  );
  assertThrows(
    () => new ControlledNvidiaUnderstandingProvider({ apiKey: "test", model: "another/model" }),
    Error,
    "model",
  );
  assertThrows(
    () => new ControlledNvidiaUnderstandingProvider({ apiKey: "test", timeoutMs: 60_001 }),
    Error,
    "timeout",
  );
  assertThrows(
    () => new ControlledNvidiaUnderstandingProvider({ apiKey: "test", maxOutputTokens: 255 }),
    Error,
    "output budget",
  );
});

Deno.test("NVIDIA semantics remain behind deterministic P0 risk and policy", async () => {
  const provider = new ControlledNvidiaUnderstandingProvider({
    apiKey: "test-only",
    network: () =>
      Promise.resolve({
        status: 200,
        body: response({
          ...valid,
          subintents: ["CORPO_SEMI_INTACTO"],
          evidence_turns: ["turn_one"],
        }),
      }),
  });
  const result = await new MotorV2Runtime(provider).runLabCase({
    case_id: "case_test_nvidia_p0",
    conversation_id: "conversation_test_nvidia_p0",
    inbound_id: "inbound_test_nvidia_p0",
    messages: [{ turn_id: "turn_one", role: "user", content: "corpo semi intacto" }],
    known_facts: [],
    do_not_ask_again: [],
    track_states: [{ track_id: "track_restos", label: "RESTOS_MORTAIS", status: "active" }],
    administrative_gaps: {
      current_deadline: "requires_current_policy",
      current_value: "requires_current_policy",
      current_documents: "requires_current_policy",
      family_authorization: "requires_current_policy",
      current_schedule: "requires_current_policy",
      eligibility: "requires_current_policy",
      current_procedure: "requires_current_policy",
    },
    fixed_clock: { instant: "2026-09-13T12:00:00Z", timezone: "America/Sao_Paulo" },
  });
  assertEquals(result.provider.uses_ai, true);
  assertEquals(result.provider.schema_guarded, true);
  assertEquals(result.state.understanding.risk.level, "P0");
  assertEquals(result.state.policy.handoff.priority, "P0");
  assertEquals(result.trace.tool_calls, []);
  assertEquals(result.metrics.tool_call_count, 0);
  assertEquals(result.metrics.retry_count, 0);
});
