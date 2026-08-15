import type { RpcClient } from "./rest.ts";
/** input is metadata-redacted; message body, documents and credentials are prohibited. */
export async function recordShadowComparison(rest: RpcClient, input: Record<string, unknown>): Promise<void> {
  await rest.rpc("record_shadow_comparison", { p_input: input });
}
