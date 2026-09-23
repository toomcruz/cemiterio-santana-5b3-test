import type { JsonModel } from "./core.ts";

/** No env reads or default network. Caller injects credentials, model and fetch. */
export function geminiModel(options: {
  apiKey: string;
  model: string;
  fetcher: typeof fetch;
}): JsonModel {
  if (!options.apiKey.trim() || !/^[a-zA-Z0-9._-]+$/.test(options.model)) throw new Error("INVALID_MODEL_CONFIG");
  return {
    name: options.model,
    async generate(system, data, signal) {
      const response = await options.fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent`,
        {
          method: "POST", redirect: "error", signal,
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify(data) }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
          }),
        },
      );
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      // Bound streamed bytes before allocating/parsing the entire provider response.
      if (!response.body) throw new Error("MODEL_EMPTY_RESPONSE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 131072) { await reader.cancel(); throw new Error("MODEL_RESPONSE_TOO_LARGE"); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const candidate = payload?.candidates?.[0];
      if (candidate?.finishReason !== "STOP") throw new Error("MODEL_INCOMPLETE_RESPONSE");
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) throw new Error("MODEL_INVALID_RESPONSE");
      // Never retain a provider's private reasoning/thought parts.
      const answer = parts.filter((p) => p?.thought !== true && typeof p?.text === "string").map((p) => p.text).join("");
      if (!answer || answer.length > 65536) throw new Error("MODEL_INVALID_JSON_SIZE");
      return JSON.parse(answer);
    },
  };
}
