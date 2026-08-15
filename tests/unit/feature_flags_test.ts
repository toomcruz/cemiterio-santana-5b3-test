import { assertEquals } from "../fixtures/assert.ts";
import { resolveShadowFeature } from "../../edge-functions/_shared/flags.ts";
Deno.test("flag resolution never returns ENABLED", async () => {
  const r: any = { rpc: async () => ({ mode: "OFF" }) };
  assertEquals(await resolveShadowFeature(r, "x", []), "OFF");
});
