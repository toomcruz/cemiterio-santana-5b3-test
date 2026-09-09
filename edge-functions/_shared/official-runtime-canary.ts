import { HttpProblem } from "./http.ts";

const BRAZILIAN_E164 = /^\+55[0-9]{10,11}$/;

export function requireRuntimeCanaryPhone(configuredCanaryPhone: string | undefined): string {
  if (typeof configuredCanaryPhone !== "string" || !BRAZILIAN_E164.test(configuredCanaryPhone)) {
    throw new HttpProblem(503, "RUNTIME_CANARY_UNCONFIGURED", "Runtime canary is not configured");
  }
  return configuredCanaryPhone;
}

function canonicalBrazilianE164(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return /^55[0-9]{10,11}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Production automation is deliberately fail-closed. A missing, malformed or
 * multi-value setting never authorizes an automatic reply.
 */
export function runtimeCanaryAllowsAutomaticReply(
  phoneE164: string,
  configuredCanaryPhone: string | undefined,
): boolean {
  return typeof configuredCanaryPhone === "string" &&
    BRAZILIAN_E164.test(configuredCanaryPhone) &&
    canonicalBrazilianE164(phoneE164) === configuredCanaryPhone;
}
