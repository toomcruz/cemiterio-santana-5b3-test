import { adaptN8nTurn } from "../adapter.ts";
import { handle, MemoryStore } from "../engine.ts";
function equal(a: unknown, b: unknown) { if (a !== b) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const store = new MemoryStore();
function event(caseId: string, id: string, message: string, family = "INDEFINIDO", objective = "INDEFINIDO", document_references: string[] = []) {
  return { conversation_id: "conv-" + caseId, episode_id: "ep-" + caseId, case_id: caseId,
    correlation_id: "corr-" + id, inbound_message_id: id, message, document_references,
    legacy_output: { familia: family, objetivo: objective, tipo_turno: "DEMANDA", referencia: message.includes("meu pai") ? "meu pai" : "", aspectos: [], precisa_humano: false, motivo_humano: "", resposta: "" } };
}
Deno.test("Gate 3 A–F local: adaptador, contexto, correção, isolamento, arquivo e replay", async () => {
  const turn = async (e: ReturnType<typeof event>) => await handle(adaptN8nTurn(e, store), store);
  const a = await turn(event("case-a", "a", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO"));
  equal(a.action, "SIMULATED_OPERATION"); equal(a.operation?.confirmed_by_readback, true);
  equal(a.next_state.family, "EXUMACAO"); equal(a.next_state.operation_ids.length, 1);
  const b = await turn(event("case-a", "b", "Quero colocar no ossuário"));
  equal(b.next_state.case_id, a.next_state.case_id); equal(b.next_state.facts.destination?.value, "OSSUARIO");
  equal(b.next_state.operation_ids.length, 1); equal(b.next_state.demand_queue.length, 0);
  const c = await turn(event("case-a", "c", "Quanto fica?"));
  equal(c.action, "ASK"); equal(c.next_state.family, "EXUMACAO"); equal(c.response.includes("R$"), false);
  equal(c.authority[0]?.status, "CONDITIONAL");
  const d = await turn(event("case-a", "d", "Na verdade quero levar para outro cemitério"));
  equal(d.next_state.facts.destination?.value, "OUTRO_CEMITERIO");
  equal(d.next_state.history.at(-1)?.previous, "OSSUARIO"); equal(d.next_state.operation_ids.length, 1);
  equal(d.authority.some(x => x.status === "UNKNOWN"), true);
  const e = await turn(event("case-b", "e", "Quanto fica?", "EXUMACAO", "INFORMACAO"));
  equal(e.next_state.facts.destination, undefined); equal(e.next_state.operation_ids.length, 0);
  const f = await turn(event("case-a", "f", "Enviei um documento", "INDEFINIDO", "INDEFINIDO", ["synthetic-file-1"]));
  equal(f.next_state.documents["synthetic-file-1"], "RECEIVED_UNVERIFIED");
  equal((await turn(event("case-a", "f", "Enviei um documento", "INDEFINIDO", "INDEFINIDO", ["synthetic-file-1"]))).action, "DUPLICATE");
  equal(store.read("case-a")?.revision, f.next_state.revision);
});
