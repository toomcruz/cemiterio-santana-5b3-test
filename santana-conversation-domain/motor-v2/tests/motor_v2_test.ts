import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { ActionGateway } from "../action_gateway.ts";
import { MotorV2Runtime, runMotorV2LabCase } from "../runtime.ts";
import { CurrentPolicyRegistry } from "../policy.ts";
import { seedFacts, upsertVersionedFact } from "../store.ts";
import type { MotorV2LabInput, UnderstandingProviderMetadata } from "../types.ts";
import { GuardedUnderstandingProvider, LabSemanticUnderstandingProvider } from "../understanding.ts";

const CLOCK = { instant: "2026-09-13T12:00:00-03:00", timezone: "America/Sao_Paulo" } as const;
const GAPS = {
  current_deadline: "unknown",
  current_value: "unknown",
  current_documents: "requires_current_policy",
  family_authorization: "human_validation_required",
  current_schedule: "requires_current_policy",
  eligibility: "human_validation_required",
  current_procedure: "requires_current_policy",
} as const;

function labInput(text: string, tracks = ["primary"]): MotorV2LabInput {
  return {
    case_id: "synthetic_case",
    conversation_id: "synthetic_conversation",
    inbound_id: "synthetic_inbound",
    messages: [{ turn_id: "t01", role: "user", content: text, synthetic: true }],
    known_facts: [{ key: "reference_already_provided", value: true, source_turn: "t01", status: "user_provided" }],
    do_not_ask_again: ["reference_already_provided"],
    track_states: tracks.map((track_id) => ({ track_id, label: track_id, status: "active" as const })),
    administrative_gaps: GAPS,
    fixed_clock: CLOCK,
  };
}

Deno.test("understanding is multilabel and P0 is deterministic without expected labels", async () => {
  const provider = new GuardedUnderstandingProvider(new LabSemanticUnderstandingProvider());
  const result = await provider.understand([{
    turn_id: "t01",
    role: "user",
    content:
      "Recebi orientações incompatíveis de dois canais sobre recadastro e revisão estrutural. Tenho receio de perder um direito.",
    synthetic: true,
  }]);
  assert(result.subintents.includes("RECADASTRO"));
  assert(result.subintents.includes("REGULARIZACAO_ESTRUTURAL"));
  assert(result.subintents.includes("CONTRADICAO_ENTRE_CANAIS"));
  assertEquals(result.risk.level, "P0");
  assertEquals(provider.metadata.uses_ai, false);
  assertEquals(provider.metadata.schema_guarded, true);
});

Deno.test("formal P0 signals fail closed", async () => {
  const provider = new GuardedUnderstandingProvider(new LabSemanticUnderstandingProvider());
  for (
    const content of [
      "Existe conflito familiar e preciso de uma decisão administrativa.",
      "É necessário analisar documento neste caso.",
      "O corpo está semi-intacto.",
      "A morte foi não natural.",
      "É uma situação sensível que não consigo explicar.",
    ]
  ) {
    const result = await provider.understand([{ turn_id: "t01", role: "user", content, synthetic: true }]);
    assertEquals(result.risk.level, "P0", content);
  }
});

Deno.test("current policy registry requires confirmed versioned source and respects validity", () => {
  const registry = new CurrentPolicyRegistry([{
    policy_id: "policy_current_1",
    domain: "synthetic",
    statement: "Regra sintética confirmada para teste isolado.",
    source_ref: "approved-source-v1",
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: "2026-12-31T23:59:59Z",
    temporal_status: "current",
    review_status: "administratively_confirmed",
  }]);
  assertEquals(registry.activeAt("2026-09-13T15:00:00Z").map((rule) => rule.policy_id), ["policy_current_1"]);
  assertEquals(registry.activeAt("2027-01-01T00:00:00Z"), []);
});

Deno.test("guarded provider rejects unknown AI output fields", async () => {
  const metadata: UnderstandingProviderMetadata = {
    id: "unsafe-ai-test",
    kind: "controlled_ai",
    uses_ai: true,
    model: "synthetic",
    schema_guarded: false,
  };
  const runtime = new MotorV2Runtime({
    metadata,
    understand: () =>
      Promise.resolve({
        schema_version: "motor-v2-understanding/1.0.0",
        journeys: [],
        subintents: [],
        transverse_states: [],
        intent_changed: false,
        complexity: "low",
        risk: { level: "none", signals: [] },
        confidence: "low",
        evidence_turns: [],
        unauthorized_action: true,
      }),
  });
  await assertRejects(() => runtime.runLabCase(labInput("Preciso de orientação.")), /unknown fields/);
});

Deno.test("runtime preserves tracks, facts and requires priority handoff for urgent multi-intent", async () => {
  const result = await runMotorV2LabCase(labInput(
    "Preciso tratar um sepultamento urgente. Também há limpeza e uma reforma, que podem esperar. A referência já foi informada.",
    ["burial", "cleaning", "construction"],
  ));
  assert(result.trace.recognized_intents.includes("SEPULTAMENTO"));
  assert(result.trace.recognized_intents.includes("LIMPEZA_ZELADORIA"));
  assert(result.trace.recognized_intents.includes("OBRA_REFORMA"));
  assert(result.trace.actions.includes("PRIORITIZE_URGENT"));
  assertEquals(result.trace.handoff.priority, "priority");
  assertEquals(Object.keys(result.trace.final_track_states).length, 3);
  assert(result.trace.reused_fact_keys.includes("reference_already_provided"));
  assertEquals(result.trace.asked_fact_keys.length, 0);
  assertEquals(result.trace.tool_calls.length, 0);
  assertEquals(result.trace.case_closed, false);
  assertEquals(result.provider.uses_ai, false);
});

Deno.test("safe local decisions avoid unnecessary handoff and ask at most one question", async () => {
  const contingency = await runMotorV2LabCase(labInput(
    "Preciso de sepultamento urgente. A alternativa preferida está bloqueada; existe contingência verificada e aceito explicitamente seguir com a contingência.",
    ["preferred_option", "verified_contingency"],
  ));
  assertEquals(contingency.trace.handoff.offered, false);
  assertEquals(contingency.trace.claims.length, 0);

  const draft = await runMotorV2LabCase(labInput(
    "Existe um rascunho com TÍTULO, LINHA e NOTA. Altere somente o campo LINHA e mostre a versão antes do envio.",
    ["draft_edit", "final_send"],
  ));
  assertEquals(draft.trace.handoff.offered, false);
  assertEquals(draft.trace.asked_fact_keys, ["explicit_user_confirmation"]);
  assert(draft.trace.actions.includes("REQUEST_EXPLICIT_CONFIRMATION"));
});

Deno.test("versioned facts supersede rather than overwrite", async () => {
  const seeded = await seedFacts(
    [{ key: "preferred_option", value: "A", source_turn: "t01", status: "user_provided" }],
    CLOCK,
  );
  const changed = await upsertVersionedFact(seeded, {
    key: "preferred_option",
    value: "B",
    value_type: "string",
    source: "user_provided",
    source_ref: "t02",
    confidence: "high",
    observed_at: CLOCK.instant,
    temporal_status: "not_applicable",
  });
  assertEquals(changed.length, 2);
  assertEquals(changed[0]?.status, "superseded");
  assertEquals(changed[1]?.version, 2);
  assertEquals(changed[0]?.superseded_by, changed[1]?.fact_id);
});

Deno.test("action gateway is deny-by-default, confirmation-gated and receipt-verifiable", async () => {
  const deniedGateway = new ActionGateway(CLOCK);
  const denied = await deniedGateway.invoke({
    tool: "payment.request",
    idempotency_key: "payment-1",
    payload: { amount: 1 },
    explicit_confirmation: false,
    required_receipt_type: "payment_confirmation",
  });
  assertEquals(denied.outcome, "denied");
  assertEquals(denied.side_effect, false);

  const gateway = new ActionGateway(CLOCK, {
    external_effects_allowed: true,
    executor: { execute: () => Promise.resolve({ accepted: true, reference: "synthetic-reference" }) },
  });
  const request = {
    tool: "payment.request" as const,
    idempotency_key: "payment-2",
    payload: { amount: 1 },
    explicit_confirmation: true,
    required_receipt_type: "payment_confirmation" as const,
  };
  const executed = await gateway.invoke(request);
  assertEquals(executed.outcome, "executed");
  assert(executed.receipt);
  assert(await gateway.verifyReceipt(executed.receipt));
  const replayed = await gateway.invoke(request);
  assertEquals(replayed.outcome, "replayed");
  assertEquals(replayed.receipt?.receipt_id, executed.receipt.receipt_id);
});

Deno.test("runtime deduplicates the same inbound and hashes every committed state", async () => {
  const runtime = new MotorV2Runtime();
  const input = labInput("Preciso tratar a retirada de restos e uma dúvida sobre concessão.", [
    "remains",
    "concession",
  ]);
  const first = await runtime.runLabCase(input);
  const replay = await runtime.runLabCase(input);
  assertEquals(first.duplicate, false);
  assertEquals(replay.duplicate, true);
  assertEquals(replay.state.revision, first.state.revision);
  assertEquals(replay.state.state_hash, first.state.state_hash);
  assert(first.state.state_hash.length === 64);
  assert(first.audit.some((event) => event.kind === "turn_committed"));
});

Deno.test("lab boundary rejects fixtures that leak answer labels", async () => {
  const unsafe = {
    ...labInput("Preciso de sepultamento."),
    subintents: ["SEPULTAMENTO"],
  } as unknown as MotorV2LabInput;
  await assertRejects(() => runMotorV2LabCase(unsafe), /forbidden fields/);
});
