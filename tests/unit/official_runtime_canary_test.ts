import { assertEquals } from "../fixtures/assert.ts";
import {
  canonicalBrazilianE164,
  isValidCanaryHash,
  runtimeCanaryAllowsAutomaticReply,
  selectCanaryRoute,
} from "../../edge-functions/_shared/official-runtime-canary.ts";

const CANARY = "+5511959805497";
const CANARY_HASH = "db98a9c27f7726832f5beb4171249f5fce5e59a47ccd3f6ee4c2ac34cad6c1e8";

Deno.test("official runtime canary uses one exact lowercase SHA-256 identity", () => {
  assertEquals(isValidCanaryHash(CANARY_HASH), true);
  assertEquals(isValidCanaryHash(CANARY_HASH.toUpperCase()), false);
  assertEquals(canonicalBrazilianE164(CANARY), CANARY);
  assertEquals(canonicalBrazilianE164("+55 (11) 95980-5497"), null);
});

Deno.test("official runtime canary authorizes only a matching hash", async () => {
  assertEquals(await runtimeCanaryAllowsAutomaticReply(CANARY, CANARY_HASH), true);
  assertEquals(await runtimeCanaryAllowsAutomaticReply("+5511988887777", CANARY_HASH), false);
  assertEquals(await runtimeCanaryAllowsAutomaticReply(CANARY, undefined), false);
  assertEquals(await runtimeCanaryAllowsAutomaticReply(CANARY, "5511959805497"), false);
});

Deno.test("official runtime route fails closed while disabled or malformed", async () => {
  assertEquals(await selectCanaryRoute(CANARY, "false", CANARY_HASH), "CURRENT_WORKFLOW");
  assertEquals(await selectCanaryRoute(CANARY, "true", undefined), "CURRENT_WORKFLOW");
  assertEquals(await selectCanaryRoute("+5511988887777", "true", CANARY_HASH), "CURRENT_WORKFLOW");
});
