import { OfficialSupabaseRest } from "../edge-functions/_shared/official-rest.ts";
import { SupabaseRuntimeStore } from "../edge-functions/_shared/official-runtime-store.ts";
import { processOfficialTurn, type RuntimeInbound, type RuntimeTurnResult } from "../santana-conversation-domain/runtime/official_turn_service.ts";
import type { LanguageInterpreter } from "../santana-conversation-domain/runtime/adapter/adapter.ts";
import { interpret } from "../santana-conversation-domain/runtime/interpreter/deterministic.ts";
import { currentCatalogHash } from "../santana-conversation-domain/runtime/server_transition.ts";

const PROJECT_REF = "vpinclyspbcrxazmnrie";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const serviceKey = Deno.env.get("SANA_V4_RUNTIME_SERVICE_KEY") ?? "";
const accessToken = Deno.env.get("SUPABASE_ACCESS_TOKEN") ?? "";
if (!serviceKey || !accessToken) throw new Error("LAB credentials are not configured");

const runId = `v4q-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const contactPrefix = `SANA-V4-QUAL-${runId}`;
const rest = new OfficialSupabaseRest({ url: SUPABASE_URL, serviceRoleKey: serviceKey });
const interpreter: LanguageInterpreter = { interpret: (message) => Promise.resolve(interpret(message)) };
const store = () => new SupabaseRuntimeStore(rest);
const assertions: Array<{ name: string; pass: boolean; detail?: string }> = [];
const turns: Array<Record<string, unknown>> = [];
const deliveries: Array<Record<string, unknown>> = [];
const atomicityObservations: Array<Record<string, unknown>> = [];

function check(name: string, pass: boolean, detail?: string) {
  assertions.push({ name, pass, ...(detail ? { detail } : {}) });
}

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`management query failed (${response.status})`);
  return JSON.parse(body) as T[];
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function phone(index: number): string {
  const seed = String(Date.now() % 10_000_000).padStart(7, "0");
  return `+55119${seed}${String(index % 10)}`;
}

async function deliverSynthetic(outboxId: string | null, label: string, mode: "complete" | "hold" = "complete") {
  if (!outboxId) return null;
  const first = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: outboxId });
  if (mode === "complete") {
    const completed = await rest.rpc<boolean>("support_runtime_complete_delivery", {
      p_outbox_id: outboxId,
      p_external_message_id: `synthetic-${runId}-${label}`,
    });
    deliveries.push({ label, outbox_id: outboxId, first_claim: first, completed });
    check(`${label}: synthetic delivery completes`, completed === true);
  } else deliveries.push({ label, outbox_id: outboxId, first_claim: first, held: true });
  return first;
}

type Scenario = { id: string; phone: string; turn: number; conversationId?: string };
function scenario(id: string, index: number): Scenario {
  return { id, phone: phone(index), turn: 0 };
}

async function turn(s: Scenario, body: string, options: { deliver?: boolean; externalId?: string } = {}) {
  s.turn += 1;
  const externalId = options.externalId ?? `${runId}-${s.id}-${s.turn}`;
  const inbound: RuntimeInbound = {
    external_message_id: externalId,
    phone_e164: s.phone,
    contact_name: `${contactPrefix}-${s.id}`,
    body,
    message_type: "text",
    metadata: { lab_only: true, qualification_run_id: runId, scenario: s.id, turn: s.turn },
  };
  const result = await processOfficialTurn(inbound, store(), interpreter, { automatic_replies_allowed: true });
  s.conversationId ??= result.conversation_id;
  check(`${s.id}/${s.turn}: stable conversation`, result.conversation_id === s.conversationId);
  turns.push({ scenario: s.id, turn: s.turn, external_id: externalId, body, ...result });
  if (options.deliver !== false) await deliverSynthetic(result.outbox_id, `${s.id}-${s.turn}`);
  return result;
}

async function stateFor(s: Scenario): Promise<Record<string, unknown>> {
  const rows = await sql<Record<string, unknown>>(
    `select revision,state from support_runtime.conversation_state where conversation_id=${q(s.conversationId!)}::uuid`,
  );
  return rows[0] ?? {};
}

async function countsFor(s: Scenario) {
  const rows = await sql<Record<string, number>>(`select
    (select count(*)::int from support_runtime.inbound_receipts where conversation_id=${q(s.conversationId!)}::uuid) receipts,
    (select count(*)::int from support_runtime.turn_events where conversation_id=${q(s.conversationId!)}::uuid) events,
    (select count(*)::int from support_runtime.outbound_queue where conversation_id=${q(s.conversationId!)}::uuid) outbox`);
  if (!rows[0]) throw new Error(`${s.id}: persisted counters not found`);
  return rows[0];
}

async function cleanup() {
  await sql(`do $$ declare ids uuid[]; begin
    select array_agg(id) into ids from public.support_conversations where contact_name like ${q(contactPrefix + "%")};
    if ids is null then return; end if;
    delete from support_runtime.turn_events where conversation_id=any(ids);
    delete from support_runtime.outbound_queue where conversation_id=any(ids);
    delete from support_runtime.sana_collected_facts where conversation_id=any(ids);
    delete from support_runtime.sana_handoff_requests where conversation_id=any(ids);
    delete from support_runtime.subject_bindings where conversation_id=any(ids);
    delete from support_runtime.attachments where conversation_id=any(ids);
    delete from support_runtime.inbound_receipts where conversation_id=any(ids);
    delete from support_runtime.conversation_state where conversation_id=any(ids);
    delete from public.support_documents where conversation_id=any(ids);
    delete from public.support_messages where conversation_id=any(ids);
    delete from public.support_conversations where id=any(ids);
  end $$;`);
}

let evidence: Record<string, unknown>[] = [];
let status: "PASS" | "BLOCKED" = "PASS";
let failure: string | null = null;
try {
  await cleanup();

  const a = scenario("A_TOPIC", 0);
  await turn(a, "Tenho um problema no jazigo da Ana Fictícia.");
  const a2 = await turn(a, "Agora quero falar da lápide.");
  const a3 = await turn(a, "Continue no jazigo.");
  check("A: topic switch follows visible topic", /placa|lápide/i.test(a2.reply_body ?? "") && /jazigo/i.test(a3.reply_body ?? ""));

  const b = scenario("B_FOCUS", 1);
  await turn(b, "Tenho um problema no jazigo, é o de Ana Fictícia.");
  await turn(b, "Agora quero tratar de outro falecido, Bruno Sintético.");
  const b3 = await turn(b, "Volto para Ana Fictícia.");
  const bState = await stateFor(b);
  check("B: FOCUS_CASE names Ana", /Ana Fictícia/i.test(b3.reply_body ?? "") && JSON.stringify(bState.state ?? {}).includes("FOCUS_CASE"));

  const c = scenario("C_PAUSE", 2);
  await turn(c, "Tenho um problema no meu jazigo.");
  const c2 = await turn(c, "Vou sair agora e volto depois.");
  const c3 = await turn(c, "Voltei para continuar o atendimento do jazigo.");
  check("C: pause and resume persist", /SOCIAL|CLOSE|RESUME_CASE/.test(`${c2.event_kind}:${c3.event_kind}`));

  const d = scenario("D_HANDOFF", 3);
  const d1 = await turn(d, "humano");
  const dState1 = await stateFor(d);
  const dReceipt1 = await sql<{ status: string }>(`select status from support_runtime.inbound_receipts where external_message_id=${q(`${runId}-${d.id}-1`)}`);
  const dCounts1 = await countsFor(d);
  const d2 = await turn(d, "não", { deliver: false });
  const d3 = await turn(d, "oi", { deliver: false });
  const dCounts2 = await countsFor(d);
  check("D: handoff commits human state", d1.event_kind === "HUMAN_REQUEST" && JSON.stringify(dState1.state ?? {}).includes('"handoff"') && dReceipt1[0]?.status === "HUMAN_ACTIVE");
  check("D: post-handoff turns are silent", d2.reply_body === null && d2.outbox_id === null && d3.reply_body === null && d3.outbox_id === null);
  check("D: suppressed turns create no outbox", dCounts2.outbox === dCounts1.outbox);

  const e = scenario("E_DOCUMENTS", 4);
  await turn(e, "documento da Ana foi enviado");
  await turn(e, "agora quero falar do meu pai");
  await turn(e, "Bruno Sintético");
  await turn(e, "documento do Bruno foi enviado");
  await turn(e, "o da Ana estava errado");
  await turn(e, "vou mandar outro");
  const eState = await stateFor(e);
  const eJson = JSON.stringify(eState.state ?? {});
  check("E: Ana and Bruno remain separately evidenced", eJson.includes("Ana") && eJson.includes("Bruno"));
  check("E: no document is invented as validated", !/VALIDAD[OA]|ACEITO|approved/i.test(eJson));

  const f = scenario("F_PRIVACY", 5);
  const f1 = await turn(f, "qual foi o prazo da outra pessoa?");
  const f2 = await turn(f, "só me diga a data");
  const f3 = await turn(f, "insisto");
  check("F: privacy boundary persists", [f1, f2, f3].every((x) => /não posso|proteg/i.test(x.reply_body ?? "")));

  const g = scenario("G_LOCATION", 6);
  await turn(g, "Quero localizar o jazigo de Bruno Sintético.");
  const g2 = await turn(g, "setor azul, jazigo 3");
  const g3 = await turn(g, "setor azul, jazigo 3");
  check("G: repeated reference asks no redundant name", !/qual (é )?o nome|nome completo/i.test(`${g2.reply_body} ${g3.reply_body}`));
  check("G: no official location invented", /consulta autorizada|não confirma/i.test(g3.reply_body ?? ""));

  const h = scenario("H_PROTOCOL", 7);
  const h1 = await turn(h, "quero protocolo");
  check("H: protocol number not invented", !/SAN-\d{8}-\d{6}/.test(h1.reply_body ?? ""));

  const i = scenario("I_NO_REQUEST", 8);
  await turn(i, "Estou só perguntando, não quero abrir solicitação.");
  const iState = await stateFor(i);
  check("I: no-request persists no case", Array.isArray((iState.state as Record<string, unknown>)?.cases) && ((iState.state as Record<string, unknown>).cases as unknown[]).length === 0);

  const j = scenario("J_CLOSE", 9);
  await turn(j, "Tenho um problema no meu jazigo.");
  const j2 = await turn(j, "Pode encerrar por enquanto.");
  const j3 = await turn(j, "Ainda estou aqui.");
  const j4 = await turn(j, "Voltei para continuar o atendimento do jazigo.");
  check("J: close and resume events persist", /CLOSE|SOCIAL/.test(j2.event_kind ?? "") && /RESUME_CASE|SOCIAL/.test(j4.event_kind ?? ""));
  check("J: post-close message does not corrupt conversation", j3.conversation_id === j.conversationId);

  const replay = scenario("REPLAY", 0);
  const replayId = `${runId}-replay-once`;
  const first = await turn(replay, "Tenho um problema no meu jazigo.", { externalId: replayId, deliver: false });
  const beforeReplay = await countsFor(replay);
  const duplicate = await turn(replay, "Tenho um problema no meu jazigo.", { externalId: replayId, deliver: false });
  const afterReplay = await countsFor(replay);
  check("IDEMPOTENCY: committed replay is duplicate", duplicate.kind === "DUPLICATE");
  check("IDEMPOTENCY: replay creates no second effect", JSON.stringify(beforeReplay) === JSON.stringify(afterReplay));
  const claim1 = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: first.outbox_id });
  const claim2 = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: first.outbox_id });
  check("OUTBOX: second claim is suppressed", claim1.claimed === true && claim2.claimed === false);
  const completed1 = await rest.rpc<boolean>("support_runtime_complete_delivery", { p_outbox_id: first.outbox_id, p_external_message_id: `synthetic-${runId}-once` });
  const completed2 = await rest.rpc<boolean>("support_runtime_complete_delivery", { p_outbox_id: first.outbox_id, p_external_message_id: `synthetic-${runId}-twice` });
  check("OUTBOX: completion is idempotent", completed1 === true && completed2 === false);

  const concurrent = scenario("CONCURRENT", 1);
  const concurrentId = `${runId}-concurrent`;
  const concurrentInbound: RuntimeInbound = {
    external_message_id: concurrentId,
    phone_e164: concurrent.phone,
    contact_name: `${contactPrefix}-${concurrent.id}`,
    body: "Tenho um problema no meu jazigo.",
    message_type: "text",
    metadata: { lab_only: true, qualification_run_id: runId, scenario: concurrent.id },
  };
  const pair = await Promise.allSettled([
    processOfficialTurn(concurrentInbound, store(), interpreter, { automatic_replies_allowed: true }),
    processOfficialTurn(concurrentInbound, store(), interpreter, { automatic_replies_allowed: true }),
  ]);
  const fulfilled = pair.filter((x): x is PromiseFulfilledResult<RuntimeTurnResult> => x.status === "fulfilled");
  check("IDEMPOTENCY: concurrent duplicate has a successful logical result", fulfilled.length >= 1);
  const concurrentResult = fulfilled[0];
  if (!concurrentResult) throw new Error("concurrent logical result missing");
  concurrent.conversationId = concurrentResult.value.conversation_id;
  const concurrentCounts = await countsFor(concurrent);
  check("IDEMPOTENCY: concurrent duplicate creates one event/outbox", concurrentCounts.events === 1 && concurrentCounts.outbox === 1);

  const crash = scenario("CRASH", 2);
  const crashTurn = await turn(crash, "Tenho um problema no meu jazigo.", { deliver: false });
  const crashClaim1 = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: crashTurn.outbox_id });
  await sql(`update support_runtime.outbound_queue set updated_at=now()-interval '6 minutes' where outbox_id=${q(crashTurn.outbox_id!)}::uuid`);
  const crashClaim2 = await rest.rpc<Record<string, unknown>>("support_runtime_claim_delivery", { p_outbox_id: crashTurn.outbox_id });
  check("OUTBOX: crash lease can be recovered without a second row", crashClaim1.claimed === true && crashClaim2.claimed === true);
  await rest.rpc<boolean>("support_runtime_complete_delivery", { p_outbox_id: crashTurn.outbox_id, p_external_message_id: `synthetic-${runId}-recovered` });
  const crashCounts = await countsFor(crash);
  check("OUTBOX: crash recovery keeps one outbox", crashCounts.outbox === 1);

  const failureScenario = scenario("FAIL_INTERPRET", 3);
  const throwingInterpreter: LanguageInterpreter = { interpret: () => Promise.reject(new Error("synthetic interpretation failure")) };
  const failedInterpretationResult = await processOfficialTurn({
    external_message_id: `${runId}-fail-interpret`, phone_e164: failureScenario.phone,
    contact_name: `${contactPrefix}-${failureScenario.id}`, body: "mensagem sintética", message_type: "text",
    metadata: { lab_only: true, qualification_run_id: runId, scenario: failureScenario.id },
  }, store(), throwingInterpreter, { automatic_replies_allowed: true });
  const failureRows = await sql<Record<string, unknown>>(`select c.id conversation_id,s.revision,
    (select count(*) from support_runtime.turn_events where conversation_id=c.id)::int events,
    (select count(*) from support_runtime.outbound_queue where conversation_id=c.id)::int outbox,
    (select array_agg(status order by created_at) from support_runtime.inbound_receipts where conversation_id=c.id) receipts
    from public.support_conversations c join support_runtime.conversation_state s on s.conversation_id=c.id
    where c.contact_name=${q(contactPrefix + "-" + failureScenario.id)} group by c.id,s.revision`);
  atomicityObservations.push({
    stage: "interpretation",
    runtime_result: failedInterpretationResult,
    persisted: failureRows[0] ?? null,
  });
  check(
    "ATOMICITY: interpretation failure commits one fail-closed marker",
    failedInterpretationResult.kind === "INTERPRETATION_UNAVAILABLE" &&
      Number(failureRows[0]?.revision) === 1 && Number(failureRows[0]?.events) === 1,
  );
  check(
    "ATOMICITY: interpretation failure creates no reply or outbox",
    failedInterpretationResult.reply_body === null && failedInterpretationResult.outbox_id === null &&
      Number(failureRows[0]?.outbox) === 0,
  );
  check(
    "ATOMICITY: fail-closed marker has a real committed receipt",
    JSON.stringify(failureRows[0]?.receipts ?? []).includes("COMMITTED"),
  );

  const invalid = scenario("FAIL_COMMIT", 4);
  const catalogHash = await currentCatalogHash();
  const lease = await store().acquireInbound({
    external_message_id: `${runId}-fail-commit`, phone_e164: invalid.phone,
    contact_name: `${contactPrefix}-${invalid.id}`, body: "mensagem sintética", message_type: "text",
    metadata: { lab_only: true, qualification_run_id: runId, scenario: invalid.id }, catalog_hash: catalogHash,
  });
  invalid.conversationId = lease.conversation_id;
  try {
    await rest.rpc("support_runtime_commit_turn", {
      p_conversation_id: lease.conversation_id, p_inbound_message_id: lease.inbound_message_id,
      p_expected_revision: lease.revision, p_catalog_hash: catalogHash, p_state_hash: "0".repeat(64),
      p_state: {
        conversation_id: lease.conversation_id,
        binding_checkpoint: {
          current_binding_id: null,
          ledger: {
            bindings: [
              {
                binding_id: "rollback-binding-valid",
                case_id: "rollback-case",
                subject_key: "rollback-subject",
                scope: "NEW_NAMED",
                lifecycle: "ACTIVE",
                anchor: { kind: "NAMED", value: "Pessoa Sintética" },
                evidence: "synthetic transaction rollback probe",
              },
              {
                binding_id: "rollback-binding-invalid",
                case_id: "rollback-case",
                subject_key: "rollback-subject",
                scope: "INVALID_SCOPE",
                lifecycle: "ACTIVE",
                anchor: { kind: "NAMED", value: "Pessoa Sintética" },
                evidence: "synthetic transaction rollback probe",
              },
            ],
          },
        },
      },
      p_outcome: "PROPOSED", p_event_kind: "ANSWER",
      p_reply_body: "não deve persistir", p_projection: { subject: "nao_classificado", stage: "novos", automation_mode: "bot", flow_state: {} },
    });
  } catch { /* expected */ }
  const invalidCounts = await countsFor(invalid);
  const invalidState = await stateFor(invalid);
  const invalidDetails = await sql<Record<string, unknown>>(`select
    (select count(*)::int from support_runtime.subject_bindings where conversation_id=${q(invalid.conversationId!)}::uuid) bindings,
    (select array_agg(status order by created_at) from support_runtime.inbound_receipts where conversation_id=${q(invalid.conversationId!)}::uuid) receipts`);
  atomicityObservations.push({
    stage: "binding_materialization_mid_commit",
    revision: invalidState.revision,
    counts: invalidCounts,
    bindings: invalidDetails[0]?.bindings ?? null,
    receipts: invalidDetails[0]?.receipts ?? null,
  });
  check(
    "ATOMICITY: mid-commit binding failure rolls back state/event/outbox/bindings",
    Number(invalidCounts.events) === 0 && Number(invalidCounts.outbox) === 0 &&
      Number(invalidState.revision) === 0 && Number(invalidDetails[0]?.bindings) === 0,
  );
  check(
    "ATOMICITY: rejected commit leaves only the acquired receipt",
    JSON.stringify(invalidDetails[0]?.receipts ?? []).includes("RECEIVED") &&
      !JSON.stringify(invalidDetails[0]?.receipts ?? []).includes("COMMITTED"),
  );

  evidence = await sql<Record<string, unknown>>(`select c.id conversation_id,c.contact_name,c.external_id,c.subject,c.stage,c.automation_mode,
    s.revision,s.state,
    (select jsonb_agg(jsonb_build_object('status',r.status,'external_message_id',r.external_message_id) order by r.created_at) from support_runtime.inbound_receipts r where r.conversation_id=c.id) receipts,
    (select jsonb_agg(jsonb_build_object('revision',e.revision,'event_kind',e.event_kind,'outbox_id',e.outbox_id) order by e.revision) from support_runtime.turn_events e where e.conversation_id=c.id) events,
    (select jsonb_agg(jsonb_build_object('outbox_id',o.outbox_id,'status',o.status,'attempts',o.attempts) order by o.created_at) from support_runtime.outbound_queue o where o.conversation_id=c.id) outbox
    from public.support_conversations c join support_runtime.conversation_state s on s.conversation_id=c.id
    where c.contact_name like ${q(contactPrefix + "%")} order by c.contact_name`);
  const firstFailed = assertions.find((item) => !item.pass);
  if (firstFailed) {
    status = "BLOCKED";
    failure = firstFailed.name;
  }
} catch (error) {
  status = "BLOCKED";
  failure = error instanceof Error ? error.message : String(error);
} finally {
  const result = {
    artifact: "SANA V4 FINAL RUNTIME QUALIFICATION",
    run_id: runId,
    project_ref: PROJECT_REF,
    tested_commit: "e3beef9e0acbef5b67cf2873310520c3c679ad34",
    status,
    failure,
    assertions,
    turns,
    deliveries,
    atomicity_observations: atomicityObservations,
    evidence,
    operator_resume_surface: "MISSING_IN_LAB",
    production_changes: "NONE",
    whatsapp_messages_sent: 0,
    generated_at: new Date().toISOString(),
  };
  await Deno.mkdir("lab-checkpoints", { recursive: true });
  await Deno.writeTextFile("lab-checkpoints/SANA-V4-FINAL-RUNTIME-QUALIFICATION.json", JSON.stringify(result, null, 2) + "\n");
  await cleanup();
  const residue = await sql<Record<string, number>>(`select count(*)::int residue from public.support_conversations where contact_name like ${q(contactPrefix + "%")}`);
  await Deno.writeTextFile("lab-checkpoints/SANA-V4-FINAL-RUNTIME-QUALIFICATION-CLEANUP.json", JSON.stringify({ run_id: runId, residue: residue[0]?.residue ?? null, cleaned_at: new Date().toISOString() }, null, 2) + "\n");
}

console.log(JSON.stringify({ status, failure, passed: assertions.filter((x) => x.pass).length, failed: assertions.filter((x) => !x.pass).length, run_id: runId }));
if (status !== "PASS") Deno.exit(1);
