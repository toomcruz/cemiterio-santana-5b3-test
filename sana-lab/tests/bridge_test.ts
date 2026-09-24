import { BRIDGE_VERSION, createBridgeHandler, type BridgeRequest } from "../bridge.ts";
import { FileStore } from "../file_store.ts";
const token = "lab-test-only-token-at-least-thirty-two-characters";
const eq = (a: unknown, b: unknown) => { if (a !== b) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const turn = (caseId: string, id: string, message: string, family = "INDEFINIDO", objective = "INDEFINIDO", document_references: string[] = []): BridgeRequest => ({
  contract_version: BRIDGE_VERSION, event_id: id, case_id: caseId, conversation_id: "conv-" + caseId,
  episode_id: "ep-" + caseId, correlation_id: "corr-" + id, message, document_references,
  layer1_result: { familia: family, objetivo: objective, tipo_turno: "DEMANDA", referencia: message.includes("meu pai") ? "meu pai" : "", aspectos: [], precisa_humano: false, motivo_humano: "" },
});
async function post(handler: (r: Request) => Promise<Response>, body: unknown, authorization = token): Promise<[number, Record<string, any>]> {
  const res = await handler(new Request("http://127.0.0.1/lab/v1/turn", { method: "POST", headers: { authorization: `Bearer ${authorization}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return [res.status, await res.json()];
}
Deno.test("bridge HTTP contract A–F: canonical engine, state, replay and evidence", async () => {
  const root = await Deno.makeTempDir({ prefix: "sana-bridge-" });
  try {
    const handler = createBridgeHandler(new FileStore(root), token);
    const [sa, a] = await post(handler, turn("case-a", "a", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO"));
    eq(sa, 200); eq(a.decision, "SIMULATED_OPERATION"); eq(a.new_revision, 1); eq(a.evidence.engine_called, true);
    eq(a.evidence.canonical_engine_path, "sana-lab/engine.ts"); eq(a.operations[0].simulated, true);
    const [sb, b] = await post(handler, turn("case-a", "b", "Quero colocar no ossuário"));
    eq(sb, 200); eq(b.previous_revision, 1); eq(b.state.facts.destination.value, "OSSUARIO"); eq(b.state.operation_ids.length, 1);
    const [sc, c] = await post(handler, turn("case-a", "c", "Quanto fica?"));
    eq(sc, 200); eq(c.module, "EXUMACAO"); eq(c.decision, "ASK"); eq(c.response.includes("R$"), false);
    const [sd, d] = await post(handler, turn("case-a", "d", "Na verdade quero levar para outro cemitério"));
    eq(sd, 200); eq(d.state.facts.destination.value, "OUTRO_CEMITERIO"); eq(d.state.history.at(-1).previous, "OSSUARIO");
    const [se, e] = await post(handler, turn("case-b", "e", "Quanto fica?", "EXUMACAO", "INFORMACAO"));
    eq(se, 200); eq(e.state.facts.destination, undefined); eq(e.state.operation_ids.length, 0);
    const fInput = turn("case-a", "f", "Enviei documento", "INDEFINIDO", "INDEFINIDO", ["synthetic-file-1"]);
    const [sf, f] = await post(handler, fInput); eq(sf, 200); eq(f.state.documents["synthetic-file-1"], "RECEIVED_UNVERIFIED");
    const [sr, replay] = await post(handler, fInput); eq(sr, 200); eq(replay.duplicate, true); eq(replay.new_revision, f.new_revision);
  } finally { await Deno.remove(root, { recursive: true }); }
});
Deno.test("bridge rejects unauthenticated, invalid contract, stale revision; no mutation", async () => {
  const root = await Deno.makeTempDir({ prefix: "sana-bridge-" });
  try {
    const store = new FileStore(root), handler = createBridgeHandler(store, token);
    const input = turn("case-a", "a", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO");
    eq((await post(handler, input, "wrong"))[0], 401);
    eq((await post(handler, { ...input, contract_version: "other/1" }))[0], 422);
    eq(store.read("case-a"), undefined);
    eq((await post(handler, input))[0], 200);
    eq((await post(handler, { ...turn("case-a", "b", "Quanto fica?"), previous_revision: 0 }))[0], 409);
    eq(store.read("case-a")?.revision, 1);
  } finally { await Deno.remove(root, { recursive: true }); }
});
Deno.test("bridge listener real loopback, safe unavailable and timeout", async () => {
  const controller = new AbortController();
  const handler = createBridgeHandler({ read: () => undefined, commit: () => { throw Error("STORE_DOWN"); } }, token);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} }, handler);
  const addr = server.addr as Deno.NetAddr;
  const url = `http://127.0.0.1:${addr.port}/lab/v1/turn`;
  try {
    const result = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(turn("case-a", "a", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO")) });
    eq(result.status, 503); eq((await result.json()).error, "LAB_ENGINE_UNAVAILABLE");
  } finally { controller.abort(); await server.finished; }
  const timeout = AbortSignal.timeout(20);
  try { await fetch(url, { signal: timeout }); throw Error("EXPECTED_NETWORK_FAILURE"); }
  catch (e) { if (e instanceof Error && e.message === "EXPECTED_NETWORK_FAILURE") throw e; }
});
Deno.test("client timeout against a hanging bridge is a failure, not a business answer", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} }, async () => {
    await pending; return new Response("unreachable");
  });
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/lab/v1/turn`;
    const res = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(30) }).then(() => "unexpected", () => "timeout");
    eq(res, "timeout");
  } finally { release(); controller.abort(); await server.finished; }
});
Deno.test("concurrent requests with same expected revision commit only once", async () => {
  const root = await Deno.makeTempDir({ prefix: "sana-bridge-" });
  try {
    const handler = createBridgeHandler(new FileStore(root), token);
    const first = turn("race", "first", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO");
    first.previous_revision = 0;
    const second = turn("race", "second", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO");
    second.previous_revision = 0;
    const results = await Promise.all([post(handler, first), post(handler, second)]);
    eq(results.filter(([status]) => status === 200).length, 1);
    eq(results.filter(([status]) => status === 409).length, 1);
    eq(new FileStore(root).read("race")?.operation_ids.length, 1);
  } finally { await Deno.remove(root, { recursive: true }); }
});
Deno.test("real HTTP loopback invokes engine and persists state", async () => {
  const root = await Deno.makeTempDir({ prefix: "sana-bridge-" });
  const controller = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} }, createBridgeHandler(new FileStore(root), token));
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}/lab/v1/turn`;
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(turn("wire", "w1", "Quero exumar meu pai", "EXUMACAO", "INICIAR_SERVICO")) });
    eq(response.status, 200);
    const out = await response.json(); eq(out.evidence.engine_called, true); eq(out.new_revision, 1);
    eq(new FileStore(root).read("wire")?.operation_ids.length, 1);
  } finally { controller.abort(); await server.finished; await Deno.remove(root, { recursive: true }); }
});
