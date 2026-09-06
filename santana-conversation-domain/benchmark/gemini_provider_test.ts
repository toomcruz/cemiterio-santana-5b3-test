import { assert, assertEquals } from "../../tests/fixtures/assert.ts";
import { classifyGeminiError, GeminiBenchmarkProvider, selectStableFlashModels } from "./gemini_provider.ts";

const key = "not-a-real-key";

Deno.test("model discovery prefers documented Flash ids over other stable Flash ids", () => {
  const selected = selectStableFlashModels([
    { id: "gemini-2.0-flash", supports_generate_content: true },
    { id: "gemini-2.5-flash-lite", supports_generate_content: true },
    { id: "gemini-2.5-flash", supports_generate_content: true },
  ]);
  assertEquals(selected.slice(0, 2), ["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
  assert(selected.includes("gemini-2.0-flash"));
});

Deno.test("model discovery ignores models that cannot generate content or are not stable", () => {
  const selected = selectStableFlashModels([
    { id: "gemini-2.5-flash", supports_generate_content: false },
    { id: "gemini-2.5-flash-preview-09-2025", supports_generate_content: true },
    { id: "gemini-2.5-flash-exp", supports_generate_content: true },
    { id: "embedding-001", supports_generate_content: true },
    { id: "gemini-2.0-flash", supports_generate_content: true },
  ]);
  assertEquals(selected, ["gemini-2.0-flash"]);
});

Deno.test("a missing model id never invalidates the credential", () => {
  assertEquals(
    classifyGeminiError(404, JSON.stringify({ error: { status: "NOT_FOUND" } }), "model_call"),
    "PROVIDER_MODEL_NOT_FOUND",
  );
  assertEquals(
    classifyGeminiError(401, JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), "model_call"),
    "PROVIDER_HTTP_401",
  );
  assertEquals(classifyGeminiError(503, "not json at all", "model_call"), "PROVIDER_HTTP_5XX");
});

Deno.test("the schema mode selects the matching structured-output request field", () => {
  const responseSchema = { type: "object", properties: { ok: { type: "boolean" } } };
  const jsonSchemaBody = JSON.parse(
    new GeminiBenchmarkProvider("m", key, responseSchema, "json_schema").createRequest("p").body,
  ) as { generationConfig: Record<string, unknown> };
  const openApiBody = JSON.parse(
    new GeminiBenchmarkProvider("m", key, responseSchema, "openapi").createRequest("p").body,
  ) as { generationConfig: Record<string, unknown> };
  assert("responseJsonSchema" in jsonSchemaBody.generationConfig);
  assert(!("responseSchema" in jsonSchemaBody.generationConfig));
  assert("responseSchema" in openApiBody.generationConfig);
  assert(!("responseJsonSchema" in openApiBody.generationConfig));
});

Deno.test("the api key travels only in the request header, never in the url or body", () => {
  const request = new GeminiBenchmarkProvider("m", key, {}, "json_schema").createRequest("prompt");
  assert(!request.url.includes(key));
  assert(!request.body.includes(key));
  assertEquals(request.headers["x-goog-api-key"], key);
});
