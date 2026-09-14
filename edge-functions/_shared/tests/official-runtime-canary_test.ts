import {
  canonicalBrazilianE164,
  isValidCanaryHash,
  runtimeCanaryAllowsAutomaticReply,
  selectCanaryRoute,
} from "../official-runtime-canary.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const AUTHORIZED_HASH = "db98a9c27f7726832f5beb4171249f5fce5e59a47ccd3f6ee4c2ac34cad6c1e8";

Deno.test("canary hash is exactly one lowercase SHA-256 identity", () => {
  assert(isValidCanaryHash(AUTHORIZED_HASH));
  assertEquals(isValidCanaryHash(AUTHORIZED_HASH.toUpperCase()), false);
  assertEquals(isValidCanaryHash(`${AUTHORIZED_HASH}0`), false);
  assertEquals(isValidCanaryHash(""), false);
});

Deno.test("phone normalization is strict Brazilian E.164", () => {
  assertEquals(canonicalBrazilianE164("+5511999999999"), "+5511999999999");
  assertEquals(canonicalBrazilianE164("5511999999999"), null);
  assertEquals(canonicalBrazilianE164("+55 (11) 99999-9999"), null);
  assertEquals(canonicalBrazilianE164("+4411999999999"), null);
});

Deno.test("allowlist and route fail closed", async () => {
  assertEquals(await runtimeCanaryAllowsAutomaticReply("+5511999999999", undefined), false);
  assertEquals(await runtimeCanaryAllowsAutomaticReply("invalid", AUTHORIZED_HASH), false);
  assertEquals(await selectCanaryRoute("+5511999999999", "false", AUTHORIZED_HASH), "CURRENT_WORKFLOW");
  assertEquals(await selectCanaryRoute("+5511999999999", "true", undefined), "CURRENT_WORKFLOW");
  assertEquals(await selectCanaryRoute("+5511999999999", "true", AUTHORIZED_HASH), "CURRENT_WORKFLOW");
});
