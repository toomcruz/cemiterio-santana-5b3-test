import { assertEquals } from "../fixtures/assert.ts";
import { runInactivityWorker } from "../../edge-functions/support-inactivity-worker/index.ts";
Deno.test("inactivity never sends caller time to RPC", async () => {
  let body: any;
  await runInactivityWorker({ action: "RUN_DUE", shadow_only: true }, {
    rpc: async (_: string, b: any) => {
      body = b;
      return [];
    },
  } as any);
  assertEquals("p_now" in body, false);
});
