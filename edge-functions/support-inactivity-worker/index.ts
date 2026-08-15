import { assertMethod, assertString, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";
type Input = {
  action: "SCHEDULE" | "CANCEL" | "RUN_DUE";
  session_id?: string;
  worker_id?: string;
  max_jobs?: number;
  shadow_only: boolean;
};
/** Time and policy are database-authoritative; worker only requests work. No outbound provider client exists. */
export async function runInactivityWorker(i: Input, rest: SupabaseRest) {
  if (!i.shadow_only) throw new Error("SHADOW_ONLY_REQUIRED");
  if (i.action === "SCHEDULE") {
    return await rest.rpc("schedule_inactivity_transaction_v2", {
      p_session_id: assertString(i.session_id, "session_id"),
    });
  }
  if (i.action === "CANCEL") {
    return await rest.rpc("cancel_inactivity_transaction_v2", {
      p_session_id: assertString(i.session_id, "session_id"),
    });
  }
  return await rest.rpc("run_due_inactivity_jobs_v2", {
    p_worker: i.worker_id ?? "shadow-worker",
    p_limit: Math.min(Math.max(i.max_jobs ?? 50, 1), 200),
  });
}
if (import.meta.main) {
  Deno.serve(async (r) => {
    try {
      assertMethod(r, "POST");
      requireInternalShadowAccess(r);
      requireShadowOnly();
      return json(await runInactivityWorker(await parseJson<Input>(r), new SupabaseRest()));
    } catch (e) {
      return problem(e);
    }
  });
}
