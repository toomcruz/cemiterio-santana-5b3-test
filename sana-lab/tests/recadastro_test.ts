import { handle, MemoryStore } from "../engine.ts";
import { BRIDGE_VERSION, createBridgeHandler, type BridgeRequest } from "../bridge.ts";
import { MODULES } from "../modules.ts";
import { SCHEMA_VERSION, type Input } from "../contracts.ts";

const eq = (actual: unknown, expected: unknown) => { if (actual !== expected) throw Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); };
const yes = (value: unknown) => { if (!value) throw Error("Expected true"); };
const make = (caseId: string, id: string, message: string, objective: Input["interpretation"]["objective"] = "INDEFINIDO", reference = "", family: Input["interpretation"]["family"] = "RECADASTRO", conversation_id = "conv-shared"): Input => ({
  schema_version: SCHEMA_VERSION, environment: "LAB", channel: "SIMULATOR", conversation_id,
  episode_id: "ep-shared", case_id: caseId, correlation_id: `corr-${id}`, inbound_message_id: id,
  current_message: message, interpretation: { family, objective, turn: "DEMANDA", reference },
});

Deno.test("R01 information has source and no draft; R13 information closure differs from pending draft", async () => {
  const store = new MemoryStore();
  const info = await handle(make("info", "r01", "Como funciona recadastro?", "INFORMACAO"), store);
  eq(info.action, "ANSWER"); eq(info.next_state.phase, "RESOLVED_GRACE"); eq(info.next_state.operation_ids.length, 0);
  yes(info.sources.includes(MODULES.RECADASTRO.catalog_source));
  const draft = await handle(make("draft", "r13-start", "Quero atualizar meu cadastro", "INICIAR_SERVICO"), store);
  eq(draft.next_state.phase, "WAITING_CITIZEN");
  const closure = await handle(make("draft", "r13-end", "Finalizar recadastro"), store);
  eq(closure.next_state.phase, "WAITING_CITIZEN"); yes(closure.response.includes("pendente"));
});

Deno.test("R02 start creates LAB-only draft; R03 continuation asks one necessary fact; R06 follow-up", async () => {
  const store = new MemoryStore();
  const first = await handle(make("r02", "r02-start", "Quero atualizar meu cadastro", "INICIAR_SERVICO"), store);
  eq(first.action, "SIMULATED_OPERATION"); eq(first.operation?.kind, "REGISTER_RECADASTRO_DRAFT");
  eq(first.operation?.confirmed_by_readback, true); eq(first.next_state.phase, "WAITING_CITIZEN");
  const reference = await handle(make("r02", "r03-ref", "A referência do jazigo é Q7", "INDEFINIDO", "Q7", "INDEFINIDO"), store);
  eq(reference.next_state.facts.concession_reference?.value, "Q7");
  eq(reference.action, "ASK"); yes(reference.response.includes("documento do titular"));
  const purpose = make("r02", "r03-purpose", "É o contato", "INDEFINIDO", "", "INDEFINIDO");
  purpose.case_facts = { update_purpose: { value: "contato", origin: "CITIZEN" } };
  const continued = await handle(purpose, store); eq(continued.next_state.facts.update_purpose?.value, "contato");
  const follow = await handle(make("r02", "r06", "Como está o pedido?", "ACOMPANHAMENTO", "", "INDEFINIDO"), store);
  eq(follow.action, "ANSWER"); yes(follow.response.includes("pendentes"));
});

Deno.test("R04 correction preserves history; R05 received file stays unverified; R07 replay is idempotent", async () => {
  const store = new MemoryStore();
  await handle(make("r04", "r04-start", "Quero atualizar cadastro", "INICIAR_SERVICO", "Q7"), store);
  const correction = await handle(make("r04", "r04-correct", "Na verdade é Q8", "INDEFINIDO", "Q8", "INDEFINIDO"), store);
  eq(correction.next_state.facts.concession_reference?.value, "Q8");
  eq(correction.next_state.history.at(-1)?.previous, "Q7");
  const document = make("r04", "r05-doc", "Enviei documento", "INDEFINIDO", "", "INDEFINIDO");
  document.document_references = ["LAB-file-1"];
  const result = await handle(document, store);
  eq(result.next_state.documents["LAB-file-1"], "RECEIVED_UNVERIFIED");
  const replay = await handle(document, store); eq(replay.action, "DUPLICATE");
  eq(replay.next_state.revision, result.next_state.revision);
  eq(replay.next_state.operation_ids.length, 1);
});

Deno.test("R08 new case isolated; R09 ambiguity does not select a module; R10 two cases share conversation without state bleed", async () => {
  const store = new MemoryStore();
  const rec = await handle(make("case-rec", "r10-rec", "Quero recadastrar", "INICIAR_SERVICO", "Q7"), store);
  const exuInput = make("case-exu", "r10-exu", "Quero exumar meu pai", "INICIAR_SERVICO", "meu pai", "EXUMACAO");
  exuInput.linked_case_ids = ["case-rec"];
  const exu = await handle(exuInput, store);
  eq(exu.next_state.linked_case_ids?.[0], "case-rec");
  eq(rec.next_state.family, "RECADASTRO"); eq(exu.next_state.family, "EXUMACAO");
  const resumeInput = make("case-rec", "r10-resume", "Como está?", "ACOMPANHAMENTO", "", "INDEFINIDO");
  resumeInput.linked_case_ids = ["case-exu"];
  const resumed = await handle(resumeInput, store);
  eq(resumed.next_state.family, "RECADASTRO"); eq(store.read("case-exu")?.revision, 1);
  eq(resumed.next_state.linked_case_ids?.[0], "case-exu");
  eq(store.read("case-exu")?.facts.concession_reference, undefined);
  const newCase = await handle(make("case-new", "r08", "Como está?", "ACOMPANHAMENTO"), store);
  eq(newCase.next_state.operation_ids.length, 0); eq(newCase.next_state.facts.concession_reference, undefined);
  const ambiguous = await handle(make("ambiguous", "r09", "Quero regularizar meu jazigo", "INDEFINIDO", "", "INDEFINIDO"), store);
  eq(ambiguous.action, "UNSUPPORTED"); eq(ambiguous.next_state.family, "INDEFINIDO");
});

Deno.test("R09 regularizar jazigo em Recadastro ativo esclarece sem perder contexto nem abrir outra demanda", async () => {
  const store = new MemoryStore();
  const start = await handle(make("r09-active", "r09-start", "Quero recadastrar", "INICIAR_SERVICO", "Q7"), store);
  const ambiguousInput = make("r09-active", "r09-ambiguous", "Quero regularizar meu jazigo", "INDEFINIDO", "", "INDEFINIDO");
  const ambiguous = await handle(ambiguousInput, store);
  eq(ambiguous.action, "ASK");
  yes(ambiguous.response.includes("dados cadastrais"));
  yes(ambiguous.response.includes("concessão"));
  yes(ambiguous.response.includes("outra regularização"));
  eq(ambiguous.next_state.family, "RECADASTRO");
  eq(ambiguous.next_state.phase, "WAITING_CITIZEN");
  eq(ambiguous.next_state.facts.concession_reference?.value, "Q7");
  eq(ambiguous.next_state.operation_ids.length, 1);
  eq(ambiguous.next_state.revision, start.next_state.revision + 1);
  eq(ambiguous.authority.at(-1)?.status, "UNKNOWN");
  eq(ambiguous.exception, undefined);
  const replay = await handle(ambiguousInput, store);
  eq(replay.action, "DUPLICATE");
  eq(replay.next_state.revision, ambiguous.next_state.revision);
  const resume = await handle(make("r09-active", "r09-resume", "Quero atualizar meu contato", "INDEFINIDO", "", "INDEFINIDO"), store);
  eq(resume.next_state.family, "RECADASTRO");
  eq(resume.next_state.facts.concession_reference?.value, "Q7");
});

Deno.test("R11 transfer boundary; R12 explicit attendant and actual rights conflict are justified exceptions", async () => {
  const store = new MemoryStore();
  const transfer = await handle(make("transfer", "r11", "Quero transferir titularidade", "INDEFINIDO"), store);
  eq(transfer.action, "ASK"); eq(transfer.next_state.operation_ids.length, 0);
  const human = await handle(make("human", "r12-human", "Quero falar com atendente", "INDEFINIDO"), store);
  eq(human.exception?.kind, "PEDIDO_HUMANO");
  const dispute = await handle(make("dispute", "r12-dispute", "Existe disputa pela titularidade", "INDEFINIDO"), store);
  eq(dispute.exception?.kind, "DECISAO_ADMINISTRATIVA");
  eq(dispute.authority[0]?.status, "HUMAN_DECISION_REQUIRED");
});

Deno.test("R14 revision conflict fails closed; client timeout never yields business response", async () => {
  const token = "test-only-bridge-token-with-at-least-thirty-two-characters";
  const store = new MemoryStore(), handler = createBridgeHandler(store, token);
  const body: BridgeRequest = { contract_version: BRIDGE_VERSION, event_id: "r14-first", case_id: "r14", conversation_id: "conv-r14",
    episode_id: "ep-r14", correlation_id: "corr-r14", message: "Quero atualizar cadastro", previous_revision: 0,
    layer1_result: { familia: "RECADASTRO", objetivo: "INICIAR_SERVICO", tipo_turno: "DEMANDA" } };
  const post = (request: BridgeRequest) => handler(new Request("http://127.0.0.1/lab/v1/turn", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(request) }));
  const accepted = await post(body); eq(accepted.status, 200);
  const j = await accepted.json(); eq(j.evidence.catalog_source, MODULES.RECADASTRO.catalog_source);
  const conflict = await post({ ...body, event_id: "r14-second", previous_revision: 0 }); eq(conflict.status, 409);
  eq(store.read("r14")?.revision, 1);
  const controller = new AbortController(); let release!: () => void;
  const stalled = new Promise<void>(resolve => release = resolve);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} }, async () => { await stalled; return new Response("{}", { headers: { "content-type": "application/json" } }); });
  try {
    const request = fetch(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/lab/v1/turn`, { method: "POST", body: "{}", signal: AbortSignal.timeout(20) });
    eq(await request.then(() => "unexpected-business-response", () => "timeout"), "timeout");
  } finally { release(); controller.abort(); await server.finished; }
});

Deno.test("transversal human request has concrete exception, without a human service module", async () => {
  const token = "test-only-bridge-token-with-at-least-thirty-two-characters";
  const handler = createBridgeHandler(new MemoryStore(), token);
  const req: BridgeRequest = { contract_version: BRIDGE_VERSION, event_id: "human-first", case_id: "human-first",
    conversation_id: "conv-human", episode_id: "ep-human", correlation_id: "corr-human",
    message: "Quero falar com atendente", layer1_result: { familia: "INDEFINIDO", objetivo: "INDEFINIDO", tipo_turno: "DEMANDA" } };
  const res = await handler(new Request("http://127.0.0.1/lab/v1/turn", { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(req) }));
  eq(res.status, 200);
  const body = await res.json();
  eq(body.module, "INDEFINIDO"); eq(body.exception?.kind, "PEDIDO_HUMANO");
  eq(body.operations.length, 0); eq(body.evidence.catalog_source, null);
});
