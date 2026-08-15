import { assertEquals } from "../fixtures/assert.ts";
import { recordShadowComparison } from "../../edge-functions/_shared/shadow.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("shadow comparison is persisted through a redacted RPC", () => {
  let n = "";
  const rest: RpcOnly = {
    rpc: <T>(x: string): Promise<T> => {
      n = x;
      return Promise.resolve(null as T);
    },
  };
  return recordShadowComparison(rest, { legacy_summary: { intent_code: "X" }, new_summary: { intent_code: "Y" } }).then(
    () => {
      assertEquals(n, "record_shadow_comparison");
    },
  );
});
