import { assertEquals } from "../fixtures/assert.ts";
import { runInactivityWorker } from "../../edge-functions/support-inactivity-worker/index.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("inactivity never sends caller time to RPC", () => {
  let body: unknown;
  const rest: RpcOnly = {
    rpc: <T>(_name: string, b: unknown): Promise<T> => {
      body = b;
      return Promise.resolve([] as T);
    },
  };
  return runInactivityWorker({ action: "RUN_DUE", shadow_only: true }, rest).then(() => {
    assertEquals(typeof body === "object" && body !== null && "p_now" in body, false);
  });
});
