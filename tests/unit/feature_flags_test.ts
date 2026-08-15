import { assertEquals } from "../fixtures/assert.ts";
import { resolveShadowFeature } from "../../edge-functions/_shared/flags.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("flag resolution never returns ENABLED", () => {
  const r: RpcOnly = { rpc: <T>(): Promise<T> => Promise.resolve({ mode: "OFF" } as T) };
  return resolveShadowFeature(r, "x", []).then((mode) => assertEquals(mode, "OFF"));
});
