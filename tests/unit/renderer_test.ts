import { assertEquals } from "../fixtures/assert.ts";
import { render } from "../../edge-functions/support-renderer/index.ts";
Deno.test("renderer blocks A_CONFIRMAR", async () => {
  let failed = false;
  try {
    await render(
      { decision_id: "d", technical: { channel: "WHATSAPP" } },
      { rpc: async () => ({ outcome: "A_CONFIRMAR" }) } as any,
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
      { rpc: async () => ({ outcome: "PERMITTED", response_plan: { mode: "GEMINI" } }) } as any,
    );
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
