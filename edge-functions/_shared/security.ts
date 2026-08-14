import { HttpProblem } from "./http.ts";

export type RuntimeMode = "OFF" | "SHADOW_ONLY";

export function requireInternalShadowAccess(request: Request): void {
  const expected = Deno.env.get("SUPPORT_VNEXT_INTERNAL_KEY");
  if (!expected) throw new HttpProblem(503, "SHADOW_KEY_UNCONFIGURED", "Internal shadow key is not configured");
  const presented = request.headers.get("x-support-vnext-key");
  if (!presented || presented !== expected) throw new HttpProblem(401, "UNAUTHORIZED", "Internal key is required");
}

export function runtimeMode(): RuntimeMode {
  const raw = (Deno.env.get("SUPPORT_VNEXT_MODE") ?? "OFF").toUpperCase();
  // ENABLED deliberately fails closed: Fase 5B has no live execution path.
  return raw === "SHADOW_ONLY" ? "SHADOW_ONLY" : "OFF";
}

export function requireShadowOnly(): void {
  if (runtimeMode() !== "SHADOW_ONLY") {
    throw new HttpProblem(403, "SHADOW_ONLY_REQUIRED", "Only SUPPORT_VNEXT_MODE=SHADOW_ONLY is accepted");
  }
}
