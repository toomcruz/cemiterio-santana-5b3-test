import { assertEquals } from "../fixtures/assert.ts";
import { recordShadowComparison } from "../../edge-functions/_shared/shadow.ts";
Deno.test("shadow comparison is persisted through a redacted RPC", async () => {
  let n = "";
  await recordShadowComparison({
    rpc: async (x: string) => {
      n = x;
      return null;
    },
  } as any, { legacy_summary: { intent_code: "X" }, new_summary: { intent_code: "Y" } });
  assertEquals(n, "record_shadow_comparison");
});
