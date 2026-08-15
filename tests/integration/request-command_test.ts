import { assertEquals } from "../fixtures/assert.ts";
import { executeRequestCommand } from "../../edge-functions/support-request-command/index.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";
const rest: RpcOnly = {
  rpc: <T>(name: string, body: unknown): Promise<T> =>
    Promise.resolve({
      status: name === "confirm_request_transaction" ? "CONFIRMED" : "PROPOSED",
      request_id: "r",
      reason_codes: [name],
      echo: body,
    } as T),
};
Deno.test("PROPOSE sends only decision id to authoritative RPC", () => {
  return executeRequestCommand({
    action: "PROPOSE",
    correlation_id: "c",
    decision_id: "d",
    shadow_only: true,
  }, rest).then((r) => assertEquals(r.reason_codes[0], "propose_request_transaction"));
});
Deno.test("CONFIRM requires inbound proof", () =>
  executeRequestCommand({
    action: "CONFIRM",
    correlation_id: "c",
    confirmation_id: "x",
    confirmation_nonce: "n",
    shadow_only: true,
  }, rest).then(() => false, () => true).then((failed) => assertEquals(failed, true)));
