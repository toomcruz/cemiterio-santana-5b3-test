import { assert, assertEquals, assertRejects } from "../../tests/fixtures/assert.ts";
import { type CurrentWorkflowLabInput, runCurrentWorkflowLabCase } from "../current-adapter/mod.ts";

const HASH = "a".repeat(64);
const FIXED_CLOCK = { instant: "2026-09-13T12:00:00-03:00", timezone: "America/Sao_Paulo" };

function fixture(overrides: Partial<CurrentWorkflowLabInput> = {}): CurrentWorkflowLabInput {
  return {
    caseId: "current_adapter_test",
    caseHash: HASH,
    fixedClock: FIXED_CLOCK,
    messages: [
      { turnId: "t01", role: "user", content: "Preciso atualizar o cadastro do jazigo" },
      { turnId: "t02", role: "assistant", content: "Qual é a identificação da concessão?" },
      { turnId: "t03", role: "user", content: "Não tenho essa informação" },
    ],
    ...overrides,
  };
}

Deno.test("current adapter executes the isolated official path and proves idempotency", async () => {
  const result = await runCurrentWorkflowLabCase(fixture());

  assertEquals(result.status, "COMPLETED");
  assertEquals(result.trace.schema_version, "benchmark-trace-v1.0.0");
  assert(result.audit.runtime_path.includes("processOfficialTurn"));
  assertEquals(result.metrics.user_turns, 2);
  assertEquals(result.metrics.committed_turns, 2);
  assertEquals(result.metrics.external_tool_calls, 0);
  assertEquals(result.metrics.semantic_receipts, 0);
  assertEquals(result.idempotency_probe.duplicate_kind, "DUPLICATE");
  assertEquals(result.idempotency_probe.duplicate_reply_is_null, true);
  assertEquals(result.idempotency_probe.revision_unchanged, true);
  assertEquals(result.idempotency_probe.commits_unchanged, true);
  assertEquals(result.idempotency_probe.outbox_unchanged, true);
  assertEquals(result.trace.tool_calls, []);
  assertEquals(result.trace.receipts_used, []);
});

Deno.test("compat-v1 reproduces Phase 15 assistant-context concatenation without putting raw input in audit", async () => {
  const result = await runCurrentWorkflowLabCase(fixture());
  const second = result.audit.turns[1];

  assert(second);
  assertEquals(second.input.assistant_context_count, 1);
  assertEquals(second.input.assistant_context_injected, true);
  assert(second.input.content_characters > "Não tenho essa informação".length);
  assert(!JSON.stringify(result.audit).includes("Qual é a identificação da concessão?"));
  assert(!JSON.stringify(result.audit).includes("Não tenho essa informação"));
});

Deno.test("role-aware-v1 never submits an assistant message as citizen input", async () => {
  const result = await runCurrentWorkflowLabCase(fixture({ mode: "role-aware-v1" }));
  const assistant = result.audit.input.find((item) => item.role === "assistant");
  const second = result.audit.turns[1];

  assert(assistant);
  assert(second);
  assertEquals(assistant.submitted_to_runtime, false);
  assertEquals(second.input.assistant_context_count, 1);
  assertEquals(second.input.assistant_context_injected, false);
  assertEquals(second.input.content_characters, "Não tenho essa informação".length);
  assert(result.audit.unsupported_capabilities.includes("assistant-role history ingestion (role-aware-v1)"));
});

Deno.test("current adapter rejects malformed benchmark identity and duplicate turns", async () => {
  await assertRejects(
    () => runCurrentWorkflowLabCase(fixture({ caseHash: "not-a-hash" })),
    /caseHash must be lowercase SHA-256/,
  );
  await assertRejects(
    () =>
      runCurrentWorkflowLabCase(fixture({
        messages: [
          { turnId: "same", role: "user", content: "Quero recadastro" },
          { turnId: "same", role: "user", content: "Continuar" },
        ],
      })),
    /turnId must be unique/,
  );
});

Deno.test("current adapter emits unique reused fact keys across multiple goals", async () => {
  const result = await runCurrentWorkflowLabCase(fixture({
    caseId: "current_adapter_unique_facts",
    messages: [
      {
        turnId: "t01",
        role: "user",
        content: "A exumação já está agendada e a reclamação sobre a lápide continua sem resposta.",
      },
      {
        turnId: "t02",
        role: "user",
        content: "Preciso que a reclamação avance sem repetir o agendamento.",
      },
    ],
  }));
  assertEquals(result.trace.reused_fact_keys.length, new Set(result.trace.reused_fact_keys).size);
});
