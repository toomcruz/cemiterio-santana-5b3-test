import { assertEquals } from "../fixtures/assert.ts";
import { appendAuditEvent } from "../../edge-functions/_shared/audit.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
Deno.test("audit uses RPC rather than table DML", () => {
  let name = "";
  const rest: RpcOnly = {
    rpc: <T>(n: string): Promise<T> => {
      name = n;
      return Promise.resolve(null as T);
    },
  };
  return appendAuditEvent(rest, { event_type: "TEST" }).then(() => assertEquals(name, "append_shadow_audit_event"));
});
