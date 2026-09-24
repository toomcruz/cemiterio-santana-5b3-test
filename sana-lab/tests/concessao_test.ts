import { BRIDGE_VERSION, createBridgeHandler, type BridgeRequest } from "../bridge.ts";
import { handle, MemoryStore } from "../engine.ts";
import { MODULES } from "../modules.ts";
import { SCHEMA_VERSION, type Input } from "../contracts.ts";

const eq = (a: unknown, b: unknown) => { if (a !== b) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const yes = (x: unknown) => { if (!x) throw Error("EXPECTED_TRUE"); };
const make = (id: string, event: string, message: string, objective: Input["interpretation"]["objective"] = "INDEFINIDO",
  family: Input["interpretation"]["family"] = "CONCESSAO_TITULARIDADE", reference = "", conversation_id = "conv-concessao"): Input => ({
  schema_version: SCHEMA_VERSION, environment: "LAB", channel: "SIMULATOR", case_id: id, conversation_id,
  episode_id: "ep-concessao", correlation_id: `corr-${event}`, inbound_message_id: event, current_message: message,
  interpretation: { family, objective, turn: "DEMANDA", reference },
});

Deno.test("C01 consultation answers without draft or approval; C02 starts only a LAB draft", async () => {
  const store = new MemoryStore();
  const info = await handle(make("c01", "c01", "Como funciona a concessão?", "INFORMACAO"), store);
  eq(info.next_state.family, "CONCESSAO_TITULARIDADE"); eq(info.next_state.phase, "RESOLVED_GRACE");
  eq(info.operation, undefined); yes(info.sources.includes(MODULES.CONCESSAO_TITULARIDADE.catalog_source));
  const start = await handle(make("c02", "c02", "Quero transferir a titularidade", "INICIAR_SERVICO"), store);
  eq(start.action, "SIMULATED_OPERATION"); eq(start.operation?.kind, "REGISTER_CONCESSAO_DRAFT");
  eq(start.operation?.confirmed_by_readback, true); eq(start.next_state.phase, "WAITING_CITIZEN");
  eq(start.next_state.facts.concession_purpose?.value, "TRANSFERENCIA");
  yes(start.response.includes("Nenhum direito"));
});

Deno.test("C03–C06 reference correction, received document and follow-up preserve one case", async () => {
  const store = new MemoryStore();
  await handle(make("c03", "start", "Quero transferir a titularidade", "INICIAR_SERVICO"), store);
  const ref = await handle(make("c03", "reference", "Referência Q7", "INDEFINIDO", "INDEFINIDO", "Q7"), store);
  eq(ref.next_state.facts.concession_reference?.value, "Q7");
  const wrong = await handle(make("c03", "other-ref", "Tenho outra referência Q9", "INDEFINIDO", "INDEFINIDO", "Q9"), store);
  eq(wrong.action, "ASK"); eq(wrong.next_state.facts.concession_reference?.value, "Q7");
  const corrected = await handle(make("c03", "correction", "Na verdade a referência é Q8", "INDEFINIDO", "INDEFINIDO", "Q8"), store);
  eq(corrected.next_state.facts.concession_reference?.value, "Q8");
  eq(corrected.next_state.history.at(-1)?.previous, "Q7");
  const doc = make("c03", "file", "Enviei o documento"); doc.document_references = ["synthetic-file-C05"];
  const received = await handle(doc, store);
  eq(received.next_state.documents["synthetic-file-C05"], "RECEIVED_UNVERIFIED");
  eq(received.next_state.facts.requester_document, undefined);
  const follow = await handle(make("c03", "follow", "Como está meu pedido?", "ACOMPANHAMENTO"), store);
  eq(follow.action, "ANSWER"); yes(follow.response.includes("pendente"));
});

Deno.test("C07 ambiguity stays on this case without operation or generic human exception", async () => {
  const store = new MemoryStore();
  await handle(make("c07", "start", "Quero transferir titularidade", "INICIAR_SERVICO"), store);
  const result = await handle(make("c07", "ambiguous", "Quero regularizar meu jazigo"), store);
  eq(result.action, "ASK"); eq(result.next_state.family, "CONCESSAO_TITULARIDADE");
  eq(result.next_state.operation_ids.length, 1); eq(result.exception, undefined);
  yes(result.response.includes("cadastrais") && result.response.includes("concessão") && result.response.includes("outra"));
});

Deno.test("C08–C10 linked Recadastro and two concessions stay separate; modality correction preserves history", async () => {
  const store = new MemoryStore();
  const rec = await handle(make("rec", "rec-start", "Quero atualizar cadastro", "INICIAR_SERVICO", "RECADASTRO", "R-1"), store);
  const c1 = make("con-a", "con-a-start", "Quero transferir a titularidade", "INICIAR_SERVICO", "CONCESSAO_TITULARIDADE", "A");
  c1.linked_case_ids = ["rec"];
  const a = await handle(c1, store);
  eq(a.next_state.linked_case_ids?.[0], "rec"); eq(a.next_state.facts.concession_reference?.value, "A");
  eq(a.next_state.facts.recadastro_status, undefined);
  eq(rec.next_state.family, "RECADASTRO"); eq(rec.next_state.facts.concession_reference?.value, "R-1");
  const b = await handle(make("con-b", "con-b-start", "Quero renovar a concessão", "INICIAR_SERVICO", "CONCESSAO_TITULARIDADE", "B"), store);
  eq(b.next_state.facts.concession_reference?.value, "B"); eq(b.next_state.linked_case_ids, undefined);
  const fresh = await handle(make("new", "c09-new", "Como está meu pedido?", "ACOMPANHAMENTO"), store);
  eq(fresh.next_state.facts.concession_reference, undefined); eq(fresh.next_state.operation_ids.length, 0);
  const changed = await handle(make("con-a", "change-modality", "Na verdade quero renovar", "INDEFINIDO"), store);
  eq(changed.next_state.facts.concession_purpose?.value, "RENOVACAO");
  yes(changed.next_state.history.some(h => h.field === "concession_purpose" && h.previous === "TRANSFERENCIA" && h.current === "RENOVACAO"));
  eq(store.read("con-b")?.facts.concession_purpose?.value, "RENOVACAO"); eq(store.read("rec")?.revision, 1);
});

Deno.test("C11/C12 concrete exceptions; C13 replay does not repeat operation; C15 closure remains pending", async () => {
  const store = new MemoryStore();
  const first = make("pending", "start", "Quero transferir titularidade", "INICIAR_SERVICO");
  const started = await handle(first, store);
  const replay = await handle(first, store);
  eq(replay.action, "DUPLICATE"); eq(replay.next_state.revision, started.next_state.revision);
  eq(replay.next_state.operation_ids.length, 1);
  const closure = await handle(make("pending", "close", "Quero encerrar"), store);
  eq(closure.next_state.phase, "WAITING_CITIZEN"); yes(closure.response.includes("pendente"));
  const conflict = await handle(make("dispute", "c11", "Existe disputa de titularidade", "INICIAR_SERVICO"), store);
  eq(conflict.action, "EXCEPTION"); eq(conflict.authority[0]?.status, "HUMAN_DECISION_REQUIRED");
  eq(conflict.exception?.kind, "DECISAO_ADMINISTRATIVA"); eq(conflict.next_state.phase, "WAITING_TEAM");
  const human = await handle(make("human", "c12", "Quero falar com atendente", "INICIAR_SERVICO"), store);
  eq(human.next_state.family, "CONCESSAO_TITULARIDADE"); eq(human.exception?.kind, "PEDIDO_HUMANO");
  eq(human.next_state.operation_ids.length, 0);
});

Deno.test("C14 stale revision is HTTP 409; prohibited authoritative claims do not enter LAB state", async () => {
  const store = new MemoryStore(); const token = "test-only-concessao-token-with-at-least-thirty-two-characters";
  const bridge = createBridgeHandler(store, token);
  const request: BridgeRequest = { contract_version: BRIDGE_VERSION, event_id: "c14-first", case_id: "c14",
    conversation_id: "c14-conv", episode_id: "ep", correlation_id: "corr", message: "Quero transferir titularidade",
    layer1_result: { familia: "CONCESSAO_TITULARIDADE", objetivo: "INICIAR_SERVICO", tipo_turno: "DEMANDA" }, previous_revision: 0 };
  const post = (body: BridgeRequest) => bridge(new Request("http://127.0.0.1/lab/v1/turn", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const first = await post(request); eq(first.status, 200);
  const result = await first.json(); eq(result.module, "CONCESSAO_TITULARIDADE");
  eq(result.evidence.catalog_source, MODULES.CONCESSAO_TITULARIDADE.catalog_source);
  eq(result.evidence.engine_called, true); eq(result.operations[0].simulated, true);
  eq((await post({ ...request, event_id: "c14-stale" })).status, 409);
  const falseApproval = await post({ ...request, event_id: "c14-claim", previous_revision: 1,
    case_facts: { recadastro_status: { value: "OK", origin: "SYSTEM", evidence: "untrusted" } } });
  eq(falseApproval.status, 422); eq(store.read("c14")?.facts.recadastro_status, undefined);
  eq(store.read("c14")?.revision, 1);
});
