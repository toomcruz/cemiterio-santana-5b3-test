import { assertEquals } from "../fixtures/assert.ts";
import { appendAuditEvent } from "../../edge-functions/_shared/audit.ts";
Deno.test("audit uses RPC rather than table DML", async () => {
  let name = "";
  await appendAuditEvent({
    rpc: async (n: string) => {
      name = n;
      return null;
    },
  } as any, { event_type: "TEST" });
  assertEquals(name, "append_shadow_audit_event");
});
