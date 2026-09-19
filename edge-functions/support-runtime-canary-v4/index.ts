import { ControlledLlmAdapter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../../santana-conversation-domain/runtime/adapter/network.ts";
import { processOfficialTurn, type RuntimeInbound, type RuntimeMessageType } from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { GeminiProvider } from "../../santana-conversation-domain/integrations/gemini.ts";
import { HttpProblem, json } from "../_shared/http.ts";
import { WapiAttachmentProcessor } from "../_shared/official-attachments.ts";
import { OfficialSupabaseRest } from "../_shared/official-rest.ts";
import { SupabaseRuntimeStore } from "../_shared/official-runtime-store.ts";
import { requireRuntimeIngressAccess } from "../_shared/official-security.ts";
import { selectPrivateCanaryRoute } from "../_shared/private-canary-route.ts";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inboundFromPayload(payload: unknown): RuntimeInbound {
  const input = object(payload);
  const externalMessageId = text(input.external_message_id);
  const phone = text(input.phone_e164);
  const body = text(input.body);
  const messageType = text(input.message_type) as RuntimeMessageType;
  const contactName = text(input.contact_name) || null;
  const metadata = object(input.metadata);
  if (!externalMessageId || externalMessageId.length > 512) {
    throw new HttpProblem(400, "INVALID_EXTERNAL_MESSAGE_ID", "external_message_id is required");
  }
  if (!/^\+55[0-9]{10,11}$/.test(phone)) {
    throw new HttpProblem(400, "INVALID_PHONE", "phone_e164 must be a Brazilian E.164 number");
  }
  if (!body || body.length > 8000) throw new HttpProblem(400, "INVALID_BODY", "body is required");
  if (!['text', 'image', 'document', 'audio'].includes(messageType)) {
    throw new HttpProblem(400, "INVALID_MESSAGE_TYPE", "message_type is invalid");
  }
  const attachmentInput = object(input.attachment);
  const hasAttachment = messageType !== "text";
  if (hasAttachment && !Object.keys(attachmentInput).length) {
    throw new HttpProblem(400, "ATTACHMENT_REQUIRED", "attachment metadata is required");
  }
  return {
    external_message_id: externalMessageId,
    phone_e164: phone,
    contact_name: contactName,
    body,
    message_type: messageType,
    metadata,
    attachment: hasAttachment
      ? {
        file_name: text(attachmentInput.file_name),
        mime_type: text(attachmentInput.mime_type),
        message_type: messageType,
        media_url: text(attachmentInput.media_url) || null,
        media_key: text(attachmentInput.media_key) || null,
        media_direct_path: text(attachmentInput.media_direct_path) || null,
      }
      : null,
  };
}

function v4Interpreter() {
  const key = Deno.env.get("GEMINI_API_KEY")?.trim() ?? "";
  const model = Deno.env.get("SUPPORT_RUNTIME_GEMINI_MODEL")?.trim() || "gemini-2.5-flash";
  if (!key) throw new HttpProblem(503, "SANA_V4_PROVIDER_UNCONFIGURED", "Sana V4 provider is not configured");
  return new ControlledLlmAdapter({
    enabled: true,
    timeoutMs: 12000,
    provider: new GeminiProvider(model, key),
    network: fetchBoundary,
    observe: (event) => console.log("sana_v4_canary_interpreter", event.outcome, event.provider, event.model),
  });
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    requireRuntimeIngressAccess(request);
    const payload = await request.json().catch(() => {
      throw new HttpProblem(400, "INVALID_JSON", "Request body must be valid JSON");
    });
    const inbound = inboundFromPayload(payload);
    const route = await selectPrivateCanaryRoute(
      inbound.phone_e164,
      Deno.env.get("CANARY_ENABLED"),
      Deno.env.get("SUPPORT_RUNTIME_CANARY_HASH"),
    );
    if (route === "DISABLED") {
      return json({ accepted: false, route, canary_enabled: false, effects: 0 });
    }
    if (route === "LEGACY") {
      return json({ accepted: false, route, forwarded: false, effects: 0 });
    }

    const rest = new OfficialSupabaseRest();
    const store = new SupabaseRuntimeStore(rest, new WapiAttachmentProcessor(rest));
    const result = await processOfficialTurn(inbound, store, v4Interpreter(), {
      automatic_replies_allowed: true,
    });
    // The private canary is queue-only by construction. No W-API call is made
    // by this function; a later explicit activation may consume the outbox.
    return json({
      accepted: true,
      route: "SANA_V4",
      runtime_commit: "5c78aa8",
      kind: result.kind,
      conversation_id: result.conversation_id,
      replied: result.reply_body !== null,
      outbox_id: result.outbox_id,
      delivery: "queued",
      external_delivery: false,
    });
  } catch (error) {
    if (error instanceof HttpProblem) return json({ error: error.code }, error.status);
    console.error("support_runtime_canary_v4_failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "RUNTIME_PROCESSING_FAILED" }, 500);
  }
});
