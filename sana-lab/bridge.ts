import { adaptN8nTurn } from "./adapter.ts";
import { handle, type Store } from "./engine.ts";
import { FileStore } from "./file_store.ts";

export const BRIDGE_VERSION = "sana-lab-bridge/1" as const;
export type BridgeRequest = {
  contract_version: typeof BRIDGE_VERSION;
  event_id: string;
  case_id: string;
  conversation_id: string;
  episode_id: string;
  correlation_id: string;
  message: string;
  layer1_result: Record<string, unknown>;
  previous_revision?: number;
  document_references?: string[];
};

function valid(x: unknown): x is BridgeRequest {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return o.contract_version === BRIDGE_VERSION &&
    ["event_id", "case_id", "conversation_id", "episode_id", "correlation_id", "message"]
      .every(k => typeof o[k] === "string" && (o[k] as string).trim().length > 0) &&
    o.layer1_result !== null && typeof o.layer1_result === "object" && !Array.isArray(o.layer1_result) &&
    (o.previous_revision === undefined || (Number.isSafeInteger(o.previous_revision) && (o.previous_revision as number) >= 0)) &&
    (o.document_references === undefined || (Array.isArray(o.document_references) && o.document_references.every(y => typeof y === "string" && y.length < 256)));
}
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function sameToken(a: string, b: string) {
  const encoder = new TextEncoder(); const x = encoder.encode(a), y = encoder.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}

/** Transport only. All decisions and persistence transitions are performed by handle() in engine.ts. */
export function createBridgeHandler(store: Store, token: string) {
  if (token.length < 32) throw Error("LAB_TOKEN_TOO_SHORT");
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname !== "/lab/v1/turn" || request.method !== "POST") return json(404, { error: "NOT_FOUND" });
    if (!sameToken(request.headers.get("authorization") ?? "", `Bearer ${token}`)) return json(401, { error: "UNAUTHORIZED" });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json(415, { error: "JSON_REQUIRED" });
    let raw: unknown;
    try {
      const body = await request.text();
      if (body.length > 32_768) return json(413, { error: "PAYLOAD_TOO_LARGE" });
      raw = JSON.parse(body);
    } catch { return json(400, { error: "INVALID_JSON" }); }
    if (!valid(raw)) return json(422, { error: "INVALID_BRIDGE_CONTRACT" });
    try {
      const previous = store.read(raw.case_id);
      if (raw.previous_revision !== undefined && raw.previous_revision !== (previous?.revision ?? 0)) return json(409, { error: "REVISION_CONFLICT" });
      const input = adaptN8nTurn({
        conversation_id: raw.conversation_id, episode_id: raw.episode_id, case_id: raw.case_id,
        correlation_id: raw.correlation_id, inbound_message_id: raw.event_id, message: raw.message,
        legacy_output: raw.layer1_result, document_references: raw.document_references,
      }, store);
      const result = await handle(input, store);
      const state = result.next_state;
      return json(200, {
        contract_version: BRIDGE_VERSION, case_id: raw.case_id, previous_revision: previous?.revision ?? 0,
        new_revision: state.revision, module: state.family, decision: result.action,
        authority_status: result.authority, state, response: result.response,
        operations: result.operation ? [result.operation] : [], duplicate: result.action === "DUPLICATE",
        evidence: { correlation_id: raw.correlation_id, event_id: raw.event_id, source_ids: result.sources,
          engine_called: true, canonical_engine_path: "sana-lab/engine.ts", catalog_source: "santana-authority/catalogo/exumacao.v1.json" },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      if (["REVISION_CONFLICT", "STALE_STATE"].includes(code)) return json(409, { error: "REVISION_CONFLICT" });
      if (["CASE_MISMATCH", "INVALID_LEGACY_TRIAGE", "LAB_ONLY", "INVALID_FAMILY", "INVALID_OBJECTIVE"].includes(code) || code.startsWith("INVALID_")) return json(422, { error: "INVALID_TURN" });
      return json(503, { error: "LAB_ENGINE_UNAVAILABLE" });
    }
  };
}

if (import.meta.main) {
  const tokenFile = Deno.env.get("SANA_LAB_TOKEN_FILE") ?? "";
  const token = tokenFile ? Deno.readTextFileSync(tokenFile).trim() : (Deno.env.get("SANA_LAB_TOKEN") ?? "");
  const root = Deno.env.get("SANA_LAB_STATE_DIR") ?? "";
  if (!root || !root.startsWith("/")) throw Error("LAB_STATE_DIR_ABSOLUTE_REQUIRED");
  const port = Number(Deno.env.get("SANA_LAB_PORT") ?? "8765");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error("LAB_PORT_INVALID");
  const host = Deno.env.get("SANA_LAB_BIND_HOST") ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw Error("LAB_BIND_HOST_INVALID");
  const handler = createBridgeHandler(new FileStore(root), token);
  // 0.0.0.0 is allowed only inside a container with no published host port.
  Deno.serve({ hostname: host, port }, handler);
}
