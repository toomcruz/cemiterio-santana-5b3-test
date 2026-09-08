import { HttpProblem } from "./http.ts";

const encoder = new TextEncoder();

function equalSecret(actual: string, expected: string): boolean {
  const left = encoder.encode(actual);
  const right = encoder.encode(expected);
  if (!left.length || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** W-API cannot present a Supabase JWT, so this endpoint uses an independent
 * shared ingress secret and is only deployed with verify_jwt=false. */
export function requireRuntimeIngressAccess(request: Request): void {
  const expected = Deno.env.get("SUPPORT_RUNTIME_INGRESS_KEY") ?? "";
  if (!expected) {
    throw new HttpProblem(503, "RUNTIME_INGRESS_UNCONFIGURED", "Runtime ingress is not configured");
  }
  const presented = request.headers.get("x-support-runtime-key") ?? "";
  if (!equalSecret(presented, expected)) {
    throw new HttpProblem(401, "UNAUTHORIZED", "A valid runtime ingress key is required");
  }
}
