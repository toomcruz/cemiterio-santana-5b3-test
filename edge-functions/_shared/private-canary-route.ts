import { canonicalBrazilianE164, runtimeCanaryAllowsAutomaticReply } from "./official-runtime-canary.ts";

export type PrivateCanaryRoute = "SANA_V4" | "LEGACY" | "DISABLED";

/**
 * Isolated route selector for the V4 private canary. It has no side effects and
 * deliberately keeps the legacy route outside the canary function.
 */
export async function selectPrivateCanaryRoute(
  phoneE164: string,
  enabledValue: string | undefined,
  configuredHashValue: string | undefined,
): Promise<PrivateCanaryRoute> {
  if (enabledValue !== "true") return "DISABLED";
  if (!canonicalBrazilianE164(phoneE164)) return "LEGACY";
  return await runtimeCanaryAllowsAutomaticReply(phoneE164, configuredHashValue) ? "SANA_V4" : "LEGACY";
}
