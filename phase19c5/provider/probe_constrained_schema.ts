const MODEL = "openai/gpt-oss-20b";
const URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const output = Deno.args[0];
const apiKey = (Deno.env.get("NVIDIA_API_KEY") ?? "").trim();
if (!apiKey || !output) throw new Error("provider key and output path are required");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["journeys"],
  properties: {
    journeys: { type: "array", items: { type: "string", enum: ["EXUMACAO"] }, minItems: 1, maxItems: 1 },
  },
};
const started = performance.now();
const response = await fetch(URL, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: "Return the single allowed synthetic journey as JSON." }],
    response_format: { type: "json_schema", json_schema: { name: "synthetic_closed_enum", schema } },
    max_tokens: 128,
    temperature: 0,
    stream: false,
  }),
});
const bodyBytes = new TextEncoder().encode(await response.text()).byteLength;
const evidence = {
  schema_version: "phase19c5-constrained-schema-probe/1.0.0",
  provider: "nvidia",
  model: MODEL,
  endpoint: "/v1/chat/completions",
  request_kind: "synthetic_closed_enum",
  http_status: response.status,
  content_type: response.headers.get("content-type"),
  body_bytes: bodyBytes,
  duration_ms: Math.max(0, performance.now() - started),
  constrained_schema_status: response.status >= 200 && response.status < 300
    ? "ACCEPTED_NOT_PROVEN"
    : response.status === 400 || response.status === 422
    ? "REJECTED_BY_ENDPOINT"
    : "NOT_PROVEN",
  raw_body_persisted: false,
  prompt_persisted: false,
  secret_persisted: false,
};
await Deno.writeTextFile(output, JSON.stringify(evidence) + "\n", { mode: 0o600 });
console.log(JSON.stringify(evidence));
