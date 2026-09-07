import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import { GeminiProvider } from "../gemini.ts";

const provider = () => new GeminiProvider("gemini-test-model", "synthetic-key");

Deno.test("official Gemini request uses header-only credential and the canonical bounded schema", () => {
  const request = provider().createRequest("synthetic prompt");
  assert(!request.url.includes("synthetic-key"));
  assert(!request.body.includes("synthetic-key"));
  assertEquals(request.headers["x-goog-api-key"], "synthetic-key");
  const config = JSON.parse(request.body).generationConfig;
  assertEquals(config.maxOutputTokens, 4096);
  assertEquals(config.responseMimeType, "application/json");
  assert(config.responseJsonSchema.required.includes("message_id"));
});

Deno.test("Gemini extraction excludes thought parts and requires a complete response", async () => {
  assertEquals(
    provider().extractText(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ thought: true, text: "private reasoning" }, { text: '{"ok":true}' }] },
      }],
    })),
    '{"ok":true}',
  );
  for (const finishReason of ["MAX_TOKENS", "SAFETY", undefined]) {
    await assertRejects(() =>
      provider().extractText(JSON.stringify({
        candidates: [{
          finishReason,
          content: { parts: [{ text: "{}" }] },
        }],
      }))
    );
  }
});

Deno.test("Gemini configuration rejects missing key, path injection and unbounded tokens", async () => {
  await assertRejects(() => new GeminiProvider("gemini-test", ""));
  await assertRejects(() => new GeminiProvider("gemini-test/../../other", "synthetic-key"));
  await assertRejects(() => new GeminiProvider("gemini-test", "synthetic-key", 100000));
  assertEquals(provider().classifyErrorResponse(429), "PROVIDER_QUOTA");
});
