import { HttpProblem } from "./http.ts";

const BRAZILIAN_E164 = /^\+55[0-9]{10,11}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isValidCanaryHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

export function configuredCanaryHash(value: string | undefined): string | undefined {
  return isValidCanaryHash(value) ? value : undefined;
}

export function canonicalBrazilianE164(value: string): string | null {
  const normalized = value.trim();
  return BRAZILIAN_E164.test(normalized) ? normalized : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runtimeCanaryAllowsAutomaticReply(
  phoneE164: string,
  configuredHash: string | undefined,
): Promise<boolean> {
  const canonical = canonicalBrazilianE164(phoneE164);
  if (!canonical || !isValidCanaryHash(configuredHash)) return false;
  return await sha256Hex(canonical) === configuredHash;
}

export function canaryEnabled(value: string | undefined): boolean {
  return value === "true";
}

/** Explicit gate: current workflow is the default and the only path while disabled. */
export async function selectCanaryRoute(
  phoneE164: string,
  enabledValue: string | undefined,
  configuredHashValue: string | undefined,
): Promise<"CURRENT_WORKFLOW" | "MOTOR_V2"> {
  if (!canaryEnabled(enabledValue)) return "CURRENT_WORKFLOW";
  return await runtimeCanaryAllowsAutomaticReply(phoneE164, configuredHashValue) ? "MOTOR_V2" : "CURRENT_WORKFLOW";
}

export function requireCanaryHashForDiagnostics(value: string | undefined): string {
  const hash = configuredCanaryHash(value);
  if (!hash) throw new HttpProblem(503, "RUNTIME_CANARY_UNCONFIGURED", "Runtime canary is not configured");
  return hash;
}
