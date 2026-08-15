import { assertEquals } from "../fixtures/assert.ts";
import { resolveRelease } from "../../edge-functions/support-release-resolver/index.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("resolver uses atomic RPC", () => {
  let n = "";
  const r: RpcOnly = {
    rpc: <T>(x: string): Promise<T> => {
      n = x;
      return Promise.resolve({ status: "SESSION_PINNED" } as T);
    },
  };
  return resolveRelease({ conversation_id: "c", scope_code: "SANTANA" }, r).then(() =>
    assertEquals(n, "resolve_shadow_session")
  );
});
