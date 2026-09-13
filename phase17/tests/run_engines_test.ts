import { assert, assertEquals, assertRejects } from "../../tests/fixtures/assert.ts";
import { privacySafeExecutionId } from "../run_engines.ts";

Deno.test("execution ids preserve UUID entropy without resembling CPF or phone data", () => {
  const first = privacySafeExecutionId("12345678-1234-4abc-8def-123456789012");
  const second = privacySafeExecutionId("12345678-1234-4abc-8def-123456789013");

  assert(/^run_[a-p]{32}$/.test(first));
  assert(!/\d/.test(first));
  assert(!/\d{11}/.test(first));
  assert(first !== second);
  assertEquals(first.length, 36);
});

Deno.test("execution id generation rejects non-UUID sources", async () => {
  await assertRejects(() => privacySafeExecutionId("12345678901"), /must be a UUID/);
});
