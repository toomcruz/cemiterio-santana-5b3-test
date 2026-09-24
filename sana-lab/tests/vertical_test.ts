function assertEquals(actual: unknown, expected: unknown) { if (actual !== expected) throw Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
async function assertRejects(fn: () => Promise<unknown>) { try { await fn(); } catch { return; } throw Error("Expected rejection"); }
import { SCHEMA_VERSION, type Input } from "../contracts.ts";
import { handle, MemoryStore } from "../engine.ts";
import { FileStore } from "../file_store.ts";
const make = (caseId: string, id: string, message: string, objective: Input["interpretation"]["objective"] = "INICIAR_SERVICO", reference = ""): Input => ({
  schema_version: SCHEMA_VERSION, environment: "LAB", channel: "SIMULATOR", conversation_id: "conv-" + caseId,
  episode_id: "episode-" + caseId, case_id: caseId, correlation_id: "corr-" + id, inbound_message_id: id,
  current_message: message, interpretation: { family: "EXUMACAO", objective, turn: "DEMANDA", reference },
});
Deno.test("normal, releitura, duplicata, retomada e isolamento", async () => {
  const store = new MemoryStore();
  const a = make("a", "1", "Quero exumar meu pai para colocar no ossuário", "INICIAR_SERVICO", "meu pai");
  const first = await handle(a, store);
  assertEquals(first.action, "SIMULATED_OPERATION");
  assertEquals(first.operation?.confirmed_by_readback, true);
  assertEquals((await handle(a, store)).action, "DUPLICATE");
  assertEquals((await handle(make("a", "2", "Como está meu pedido?", "ACOMPANHAMENTO"), store)).action, "ANSWER");
  assertEquals((await handle(make("b", "3", "Como está meu pedido?", "ACOMPANHAMENTO"), store)).action, "ASK");
  assertEquals(store.read("b")?.operation_ids.length, 0);
});
Deno.test("preço contextual sem tarifa escolhida pelo destino", async () => {
  const r = await handle(make("price", "1", "Quanto custa exumar para colocar no ossuário?", "INFORMACAO", "minha mãe"), new MemoryStore());
  assertEquals(r.action, "ASK");
  assertEquals(r.response.includes("R$"), false);
  assertEquals(r.sources.length > 0, true);
});
Deno.test("informação, documento não verificado, correção e encerramento", async () => {
  const store = new MemoryStore();
  assertEquals((await handle(make("c", "1", "Como funciona exumação?", "INFORMACAO"), store)).action, "ANSWER");
  const docs = make("c", "2", "Enviei documento", "INICIAR_SERVICO"); docs.document_references = ["arquivo-sintetico"];
  const r = await handle(docs, store);
  assertEquals(r.next_state.documents["arquivo-sintetico"], "RECEIVED_UNVERIFIED");
  const corrected = await handle(make("c", "3", "Na verdade é minha mãe", "INICIAR_SERVICO", "minha mãe"), store);
  assertEquals(corrected.next_state.facts.reference?.value, "minha mãe");
  assertEquals((await handle(make("c", "4", "Obrigado, encerrar conversa"), store)).next_state.phase, "RESOLVED_GRACE");
});
Deno.test("exceções fundamentadas; sem transferência real", async () => {
  const s = new MemoryStore();
  const human = await handle(make("h", "1", "Quero falar com atendente"), s);
  assertEquals(human.exception?.kind, "PEDIDO_HUMANO");
  const dispute = await handle(make("d", "1", "Existe disputa pela autorização"), s);
  assertEquals(dispute.exception?.kind, "DECISAO_ADMINISTRATIVA");
});
Deno.test("rejeita produção, estado cruzado, revisão velha e fato de sistema sem evidência", async () => {
  const s = new MemoryStore();
  const prod = make("x", "1", "Exumar"); (prod as { environment: string }).environment = "PROD";
  await assertRejects(() => handle(prod, s));
  const first = await handle(make("x", "1", "Exumar"), s);
  const stale = make("x", "2", "Continuar"); stale.current_state = { ...first.next_state, revision: 0 };
  await assertRejects(() => handle(stale, s));
  const crossed = make("x", "3", "Continuar"); crossed.conversation_id = "other";
  await assertRejects(() => handle(crossed, s));
  const fact = make("x", "4", "Continuar"); fact.case_facts = { approval: { value: "yes", origin: "SYSTEM" } };
  await assertRejects(() => handle(fact, s));
});
Deno.test("estado LAB sobrevive nova instância do armazenamento e rejeita revisão conflitante", async () => {
  const root = await Deno.makeTempDir({ prefix: "sana-lab-" });
  try {
    const a = new FileStore(root);
    const first = await handle(make("persist", "1", "Quero exumar meu pai", "INICIAR_SERVICO", "meu pai"), a);
    const b = new FileStore(root);
    assertEquals(b.read("persist")?.operation_ids[0], first.operation?.id);
    const resumed = await handle(make("persist", "2", "Como está?", "ACOMPANHAMENTO"), b);
    assertEquals(resumed.action, "ANSWER");
    await assertRejects(async () => a.commit({ ...first.next_state, revision: 2 }, 1));
  } finally { await Deno.remove(root, { recursive: true }); }
});
