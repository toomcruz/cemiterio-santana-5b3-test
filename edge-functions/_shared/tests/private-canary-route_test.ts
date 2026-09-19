import { assertEquals } from "../../../tests/fixtures/assert.ts";
import { selectPrivateCanaryRoute } from "../private-canary-route.ts";

const OWNER = "+5511959805497";
const OTHER = "+5511959805498";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("private canary is fail-closed when disabled", async () => {
  assertEquals(await selectPrivateCanaryRoute(OWNER, "false", await sha256(OWNER)), "DISABLED");
});

Deno.test("owner routes to Sana V4 and non-owner stays legacy when enabled", async () => {
  const ownerHash = await sha256(OWNER);
  assertEquals(await selectPrivateCanaryRoute(OWNER, "true", ownerHash), "SANA_V4");
  assertEquals(await selectPrivateCanaryRoute(OTHER, "true", ownerHash), "LEGACY");
});

Deno.test("malformed or mismatched identity never enters V4", async () => {
  assertEquals(await selectPrivateCanaryRoute("+5511", "true", await sha256(OWNER)), "LEGACY");
  assertEquals(await selectPrivateCanaryRoute(OWNER, "true", await sha256(OTHER)), "LEGACY");
});
