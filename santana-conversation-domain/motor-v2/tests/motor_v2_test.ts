import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { ActionGateway } from "../action_gateway.ts";
import { MotorV2Runtime, runMotorV2LabCase } from "../runtime.ts";
import { CurrentPolicyRegistry } from "../policy.ts";
import { seedFacts, upsertVersionedFact } from "../store.ts";
import { canonicalJson, sha256 } from "../../runtime/server_transition.ts";
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

Deno.test("current policy registry rejects historical or unconfirmed runtime values", () => {
  const base = {
    policy_id: "policy_candidate_1",
    domain: "synthetic",
    statement: "Texto histórico que não pode virar regra vigente.",
    source_ref: "historical-source-v1",
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: null,
    temporal_status: "historical",
    review_status: "rejected",
  };
  const registry = new CurrentPolicyRegistry(
    [
      null,
      base,
      { ...base, policy_id: 123, temporal_status: "current", review_status: "administratively_confirmed" },
      { ...base, policy_id: "policy_candidate_2", temporal_status: "current" },
      { ...base, policy_id: "policy_candidate_3", review_status: "administratively_confirmed" },
    ] as unknown as ConstructorParameters<typeof CurrentPolicyRegistry>[0],
  );
  assertEquals(registry.activeAt("2026-09-13T15:00:00Z"), []);
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

Deno.test("P0 overrides verified-contingency no-handoff exception", async () => {
  const result = await runMotorV2LabCase(labInput(
    "A morte foi não natural. Existe contingência verificada e aceito explicitamente seguir com a contingência.",
    ["preferred_option", "verified_contingency"],
  ));
  assertEquals(result.trace.handoff.offered, true);
  assertEquals(result.trace.handoff.priority, "P0");
  assert(result.trace.handoff.payload_fields.includes("risk_level"));
  assert(result.trace.handoff.payload_fields.includes("risk_signals"));
  assert(result.trace.actions.includes("HANDOFF"));
  assertEquals(result.trace.case_closed, false);
  assert(result.trace.reply.includes("risco P0"));
  assert(result.trace.reply.includes("validação humana prioritária"));
});

Deno.test("P0 overrides versioned-draft no-handoff exception", async () => {
  const result = await runMotorV2LabCase(labInput(
    "Existe um rascunho com TÍTULO, LINHA e NOTA. Altere somente LINHA. Também existe conflito familiar.",
    ["draft_edit", "final_send"],
  ));
  assertEquals(result.trace.handoff.offered, true);
  assertEquals(result.trace.handoff.priority, "P0");
  assert(result.trace.handoff.payload_fields.includes("explicit_unknowns"));
  assertEquals(result.trace.asked_fact_keys, []);
  assert(!result.trace.actions.includes("REQUEST_EXPLICIT_CONFIRMATION"));
  assert(result.trace.actions.includes("HANDOFF"));
  assert(result.trace.reply.includes("risco P0"));
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
    claim_codes: ["PAYMENT_CONFIRMED"],
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
    claim_codes: ["PAYMENT_CONFIRMED"],
  };
  const executed = await gateway.invoke(request);
  assertEquals(executed.outcome, "executed");
  assert(executed.receipt);
  assert(await gateway.verifyReceipt(executed.receipt));
  assertEquals(executed.receipt.bound_claim_codes, ["PAYMENT_CONFIRMED"]);
  const forged = { ...executed.receipt, idempotency_key: "not-in-ledger" };
  const { integrity_hash: _ignored, ...forgedUnsigned } = forged;
  forged.integrity_hash = await sha256(canonicalJson(forgedUnsigned));
  assertEquals(await gateway.verifyReceipt(forged), false);
  const replayed = await gateway.invoke(request);
  assertEquals(replayed.outcome, "replayed");
  assertEquals(replayed.side_effect, false);
  assertEquals(replayed.authorized, true);
  assertEquals(replayed.receipt?.receipt_id, executed.receipt.receipt_id);
  assert(/^[a-p]{24}$/.test(executed.receipt.receipt_id.replace("receipt_", "")));

  const conflicting = await gateway.invoke({ ...request, payload: { amount: 2 } });
  assertEquals(conflicting.outcome, "denied");
  assertEquals(conflicting.side_effect, false);
  assertEquals(conflicting.receipt, null);

  const wrongReceipt = await gateway.invoke({
    ...request,
    idempotency_key: "payment-3",
    required_receipt_type: "document_confirmation",
  });
  assertEquals(wrongReceipt.outcome, "denied");
  assertEquals(wrongReceipt.side_effect, false);

  const unconfirmedConfirmation = await gateway.invoke({
    tool: "confirmation.record",
    idempotency_key: "confirmation-1",
    payload: { version: 1 },
    explicit_confirmation: false,
    required_receipt_type: "explicit_user_confirmation",
    claim_codes: ["DRAFT_CONFIRMED"],
  });
  assertEquals(unconfirmedConfirmation.outcome, "denied");

  await assertRejects(
    () =>
      gateway.invoke(
        {
          ...request,
          idempotency_key: "payment-invalid-confirmation",
          explicit_confirmation: "yes",
        } as unknown as Parameters<ActionGateway["invoke"]>[0],
      ),
    /invalid action request/,
  );

  for (
    const [tool, receiptType] of [
      ["execution.confirm", "execution_confirmation"],
      ["resolution.confirm", "resolution_confirmation"],
    ] as const
  ) {
    const confirmed = await gateway.invoke({
      tool,
      idempotency_key: `${tool}-1`,
      payload: { state: "confirmed" },
      explicit_confirmation: true,
      required_receipt_type: receiptType,
      claim_codes: [`${tool}_claim`],
    });
    assertEquals(confirmed.outcome, "executed");
    assertEquals(confirmed.receipt?.receipt_type, receiptType);
  }
});

Deno.test("action gateway serializes concurrent idempotent calls", async () => {
  let calls = 0;
  const gateway = new ActionGateway(CLOCK, {
    external_effects_allowed: true,
    executor: {
      execute: async () => {
        const call = ++calls;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { accepted: true, reference: `synthetic-reference-${call}` };
      },
    },
  });
  const request = {
    tool: "payment.request" as const,
    idempotency_key: "payment-concurrent",
    payload: { amount: 1 },
    explicit_confirmation: true,
    required_receipt_type: "payment_confirmation" as const,
    claim_codes: ["PAYMENT_CONFIRMED"],
  };
  const [first, second] = await Promise.all([gateway.invoke(request), gateway.invoke(request)]);
  assertEquals(calls, 1);
  assertEquals([first.outcome, second.outcome].sort(), ["executed", "replayed"]);
  assertEquals([first.side_effect, second.side_effect].sort(), [false, true]);
  assertEquals(first.receipt?.receipt_id, second.receipt?.receipt_id);
  assert(first.receipt && await gateway.verifyReceipt(first.receipt));
  assert(second.receipt && await gateway.verifyReceipt(second.receipt));
});

Deno.test("action gateway rejects non-finite numbers before idempotency hashing", async () => {
  let calls = 0;
  const gateway = new ActionGateway(CLOCK, {
    external_effects_allowed: true,
    executor: {
      execute: () => {
        calls += 1;
        return Promise.resolve({ accepted: true, reference: "synthetic-reference" });
      },
    },
  });
  const base = {
    tool: "payment.request" as const,
    idempotency_key: "payment-non-finite",
    explicit_confirmation: true,
    required_receipt_type: "payment_confirmation" as const,
    claim_codes: ["PAYMENT_CONFIRMED"],
  };
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const denied = await gateway.invoke({ ...base, payload: { amount } });
    assertEquals(denied.outcome, "denied");
    assertEquals(denied.side_effect, false);
  }
  const accepted = await gateway.invoke({ ...base, payload: { amount: null } });
  assertEquals(accepted.outcome, "executed");
  assertEquals(calls, 1);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    let rejected = false;
    try {
      canonicalJson(value);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});

Deno.test("action gateway snapshots caller-owned requests before asynchronous hashing", async () => {
  let calls = 0;
  const observedPayloads: Array<Record<string, string | number | boolean | null>> = [];
  const gateway = new ActionGateway(CLOCK, {
    external_effects_allowed: true,
    executor: {
      execute: (request) => {
        calls += 1;
        observedPayloads.push(structuredClone(request.payload));
        return Promise.resolve({ accepted: true, reference: "synthetic-reference" });
      },
    },
  });
  const deniedRequest = {
    tool: "payment.request" as const,
    idempotency_key: "payment-snapshot-denied",
    payload: { amount: 1 },
    explicit_confirmation: false,
    required_receipt_type: "payment_confirmation" as const,
    claim_codes: ["PAYMENT_CONFIRMED"],
  };
  const deniedPromise = gateway.invoke(deniedRequest);
  deniedRequest.explicit_confirmation = true;
  deniedRequest.payload.amount = 2;
  const denied = await deniedPromise;
  assertEquals(denied.outcome, "denied");
  assertEquals(calls, 0);

  const executedRequest = {
    ...deniedRequest,
    idempotency_key: "payment-snapshot-executed",
    payload: { amount: 1 },
    claim_codes: ["PAYMENT_CONFIRMED"],
  };
  const executedPromise = gateway.invoke(executedRequest);
  executedRequest.tool = "document.submit" as unknown as "payment.request";
  executedRequest.payload.amount = 2;
  executedRequest.required_receipt_type = "document_confirmation" as unknown as "payment_confirmation";
  executedRequest.claim_codes[0] = "DOCUMENT_CONFIRMED";
  const executed = await executedPromise;
  assertEquals(executed.outcome, "executed");
  assertEquals(executed.receipt?.tool, "payment.request");
  assertEquals(executed.receipt?.receipt_type, "payment_confirmation");
  assertEquals(executed.receipt?.bound_claim_codes, ["PAYMENT_CONFIRMED"]);
  assertEquals(observedPayloads, [{ amount: 1 }]);
  assertEquals(calls, 1);
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

Deno.test("runtime rejects reuse of an inbound id with changed content", async () => {
  const runtime = new MotorV2Runtime();
  const input = labInput("Preciso tratar uma concessão.", ["concession"]);
  await runtime.runLabCase(input);
  await assertRejects(
    () =>
      runtime.runLabCase({
        ...input,
        messages: [{ turn_id: "t01", role: "user", content: "Agora preciso tratar uma exumação.", synthetic: true }],
      }),
    /inbound id was reused with different content/,
  );
});

Deno.test("runtime store cannot bleed state across conversations", async () => {
  const runtime = new MotorV2Runtime();
  const first = labInput("Preciso tratar uma concessão.", ["concession"]);
  await runtime.runLabCase({ ...first, conversation_id: "conversation_a", inbound_id: "inbound_a" });
  await assertRejects(
    () => runtime.runLabCase({ ...first, conversation_id: "conversation_b", inbound_id: "inbound_b" }),
    /another conversation/,
  );
});

Deno.test("runtime persists newly supplied facts on later inbounds", async () => {
  const runtime = new MotorV2Runtime();
  const first = {
    ...labInput("A alternativa preferida é A.", ["preferred_option"]),
    conversation_id: "conversation_a",
    inbound_id: "inbound_a",
    known_facts: [{
      key: "preferred_option",
      value: "A",
      source_turn: "t01",
      status: "user_provided" as const,
    }],
  };
  await runtime.runLabCase(first);
  const second = await runtime.runLabCase({
    ...first,
    inbound_id: "inbound_b",
    messages: [{ turn_id: "t02", role: "user", content: "Corrigindo: prefiro B.", synthetic: true }],
    known_facts: [{
      key: "preferred_option",
      value: "B",
      source_turn: "t02",
      status: "user_provided" as const,
    }],
  });
  const versions = second.state.facts.filter((fact) => fact.key === "preferred_option");
  assertEquals(versions.length, 2);
  assertEquals(versions[0]?.status, "superseded");
  assertEquals(versions[1]?.value, "B");
  assertEquals(versions[1]?.status, "active");
});

Deno.test("lab boundary rejects fixtures that leak answer labels", async () => {
  const unsafe = {
    ...labInput("Preciso de sepultamento."),
    subintents: ["SEPULTAMENTO"],
  } as unknown as MotorV2LabInput;
  await assertRejects(() => runMotorV2LabCase(unsafe), /forbidden fields/);
});

Deno.test("lab boundary rejects nested answer labels", async () => {
  const unsafe = labInput("Preciso de sepultamento.") as unknown as Record<string, unknown>;
  unsafe.messages = [{
    turn_id: "t01",
    role: "user",
    content: "Preciso de sepultamento.",
    synthetic: true,
    expected_intents: ["SEPULTAMENTO"],
  }];
  await assertRejects(() => runMotorV2LabCase(unsafe as unknown as MotorV2LabInput), /invalid message/);
});

Deno.test("controlled provider cannot suppress or replace deterministic P0 signals", async () => {
  const providerResult = {
    schema_version: "motor-v2-understanding/1.0.0" as const,
    journeys: [],
    subintents: [],
    transverse_states: [],
    intent_changed: false,
    complexity: "low" as const,
    risk: { level: "none" as const, signals: [] },
    confidence: "low" as const,
    evidence_turns: [],
  };
  const provider = {
    metadata: {
      id: "controlled-ai-risk-downgrade-test",
      kind: "controlled_ai",
      uses_ai: true,
      model: "synthetic",
      schema_guarded: false,
    } as const,
    understand: () => Promise.resolve(providerResult),
  };
  for (
    const [content, signal] of [
      ["A morte foi não natural.", "non_natural_death"],
      ["A regra atual está ausente.", "missing_or_conflicting_current_rule"],
      ["A regra atual é conflitante.", "missing_or_conflicting_current_rule"],
    ] as const
  ) {
    const result = await new MotorV2Runtime(provider).runLabCase(labInput(content));
    assertEquals(result.state.understanding.risk.level, "P0");
    assert(result.state.understanding.risk.signals.includes(signal));
    assertEquals(result.trace.handoff.priority, "P0");
  }

  const additiveProvider = {
    ...provider,
    understand: () =>
      Promise.resolve({
        ...providerResult,
        complexity: "critical" as const,
        risk: { level: "P0" as const, signals: ["family_conflict"] },
      }),
  };
  const additive = await new MotorV2Runtime(additiveProvider).runLabCase(labInput("A regra atual está ausente."));
  assertEquals(additive.state.understanding.risk.level, "P0");
  assert(additive.state.understanding.risk.signals.includes("family_conflict"));
  assert(additive.state.understanding.risk.signals.includes("missing_or_conflicting_current_rule"));
});

Deno.test("guarded provider rejects unknown labels and evidence turns", async () => {
  const metadata = {
    id: "controlled-ai-invalid-label-test",
    kind: "controlled_ai",
    uses_ai: true,
    model: "synthetic",
    schema_guarded: false,
  } as const;
  const result = {
    schema_version: "motor-v2-understanding/1.0.0",
    journeys: [],
    subintents: [],
    transverse_states: [],
    intent_changed: false,
    complexity: "low",
    risk: { level: "none", signals: [] },
    confidence: "low",
    evidence_turns: [],
  } as const;

  await assertRejects(
    () =>
      new MotorV2Runtime({
        metadata,
        understand: () => Promise.resolve({ ...result, subintents: ["UNREVIEWED_LABEL"] }),
      }).runLabCase(labInput("Preciso de orientação.")),
    /unknown subintent label/,
  );
  await assertRejects(
    () =>
      new MotorV2Runtime({
        metadata,
        understand: () => Promise.resolve({ ...result, evidence_turns: ["answer_key_turn"] }),
      }).runLabCase(labInput("Preciso de orientação.")),
    /unknown turn/,
  );
});
