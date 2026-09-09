import { assert, assertEquals } from "../fixtures/assert.ts";
import {
  requireRuntimeCanaryPhone,
  runtimeCanaryAllowsAutomaticReply,
} from "../../edge-functions/_shared/official-runtime-canary.ts";
import { HttpProblem } from "../../edge-functions/_shared/http.ts";

const CANARY = "+5511959805497";

Deno.test("official runtime canary authorizes only one exact Brazilian E.164 phone", () => {
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, CANARY), true);
  assertEquals(runtimeCanaryAllowsAutomaticReply("+55 (11) 95980-5497", CANARY), true);
  assertEquals(runtimeCanaryAllowsAutomaticReply("+5511988887777", CANARY), false);
});

Deno.test("official runtime canary fails closed for absent or malformed configuration", () => {
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, undefined), false);
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, ""), false);
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, "5511959805497"), false);
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, `${CANARY},+5511988887777`), false);
  assertEquals(runtimeCanaryAllowsAutomaticReply(CANARY, ` ${CANARY}`), false);
});

Deno.test("official runtime refuses ingress before persistence when canary configuration is invalid", () => {
  for (const configured of [undefined, "", "5511959805497", `${CANARY},+5511988887777`]) {
    try {
      requireRuntimeCanaryPhone(configured);
      throw new Error("expected invalid canary configuration to be rejected");
    } catch (error) {
      assert(error instanceof HttpProblem);
      assertEquals(error.status, 503);
      assertEquals(error.code, "RUNTIME_CANARY_UNCONFIGURED");
    }
  }
  assertEquals(requireRuntimeCanaryPhone(CANARY), CANARY);
});
