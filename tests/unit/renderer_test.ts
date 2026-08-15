import { assertEquals } from "../fixtures/assert.ts";
import { render } from "../../edge-functions/support-renderer/index.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("renderer blocks A_CONFIRMAR", async () => {
  let failed = false;
  try {
    await render(
      { decision_id: "d", technical: { channel: "WHATSAPP" } },
      {
        rpc: <T>(): Promise<T> =>
          Promise.resolve({ outcome: "A_CONFIRMAR", decision_id: "d", response_plan: null } as T),
      } as RpcOnly,
    );
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
Deno.test("Gemini remains disabled", async () => {
  let failed = false;
  try {
    await render(
      { decision_id: "d", technical: { channel: "WHATSAPP" } },
      {
        rpc: <T>(): Promise<T> =>
          Promise.resolve({ outcome: "PERMITTED", decision_id: "d", response_plan: { mode: "GEMINI" } } as T),
      } as RpcOnly,
    );
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
