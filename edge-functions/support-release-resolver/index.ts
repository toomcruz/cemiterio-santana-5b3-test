import { assertMethod, assertString, json, parseJson, problem } from "../_shared/http.ts";
import { type RpcClient, SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";
export interface ReleaseResolverInput {
  conversation_id: string;
  scope_code: string;
  requested_session_id?: string;
}
/** Server selects release; optional session id is only an idempotency key for a new session. */
export async function resolveRelease(i: ReleaseResolverInput, r: RpcClient) {
  return await r.rpc("resolve_shadow_session", {
    p_conversation_id: assertString(i.conversation_id, "conversation_id"),
    p_scope_code: assertString(i.scope_code, "scope_code"),
    p_requested_session_id: i.requested_session_id ?? null,
  });
}
if (import.meta.main) {
  Deno.serve(async (q) => {
    try {
      assertMethod(q, "POST");
      requireInternalShadowAccess(q);
      requireShadowOnly();
      return json(await resolveRelease(await parseJson<ReleaseResolverInput>(q), new SupabaseRest()));
    } catch (e) {
      return problem(e);
    }
  });
}
