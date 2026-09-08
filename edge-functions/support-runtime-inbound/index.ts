import { ControlledLlmAdapter } from "../../santana-conversation-domain/runtime/adapter/adapter.ts";
import { fetchBoundary } from "../../santana-conversation-domain/runtime/adapter/network.ts";
import {
  processOfficialTurn,
  type RuntimeInbound,
  type RuntimeMessageType,
} from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { GeminiProvider } from "../../santana-conversation-domain/integrations/gemini.ts";
import { HttpProblem, json } from "../_shared/http.ts";
import { WapiAttachmentProcessor } from "../_shared/official-attachments.ts";
import { OfficialSupabaseRest } from "../_shared/official-rest.ts";
import { SupabaseRuntimeStore } from "../_shared/official-runtime-store.ts";
import { requireRuntimeIngressAccess } from "../_shared/official-security.ts";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

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
  if (!body || body.length > 8000) {
    throw new HttpProblem(400, "INVALID_BODY", "body is required and must be at most 8000 characters");
  }
  if (!["text", "image", "document", "audio"].includes(messageType)) {
    throw new HttpProblem(400, "INVALID_MESSAGE_TYPE", "message_type is invalid");
  }
  if (JSON.stringify(metadata).length > 10000) {
    throw new HttpProblem(400, "INVALID_METADATA", "metadata is too large");
  }
  const attachmentInput = object(input.attachment);
  const hasAttachment = messageType !== "text";
  if (hasAttachment && !Object.keys(attachmentInput).length) {
    throw new HttpProblem(400, "ATTACHMENT_REQUIRED", "attachment metadata is required for media messages");
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

function interpreter() {
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const model = Deno.env.get("SUPPORT_RUNTIME_GEMINI_MODEL") ?? "gemini-flash-lite-latest";
  const enabled = Boolean(key);
  return new ControlledLlmAdapter({
    enabled,
    timeoutMs: 12000,
    provider: enabled ? new GeminiProvider(model, key) : {
      name: "deterministic",
      model: "deterministic",
      createRequest: () => ({ url: "", headers: {}, body: "" }),
      extractText: () => "{}",
    },
    network: fetchBoundary,
    observe: (event) => {
      // Deliberately aggregate-only: it excludes customer text, prompts,
      // provider output and credentials.
      console.log("runtime_interpreter", event.outcome, event.provider, event.model);
    },
  });
}

async function deliver(
  rest: OfficialSupabaseRest,
  outboxId: string | null,
): Promise<"queued" | "sent" | "failed"> {
  if (!outboxId) return "queued";
  const mode = (Deno.env.get("SUPPORT_RUNTIME_DELIVERY_MODE") ?? "QUEUE_ONLY").toUpperCase();
  if (mode !== "DIRECT") return "queued";
  const token = Deno.env.get("WAPI_TOKEN") ?? "";
  const instanceId = Deno.env.get("WAPI_INSTANCE_ID") ?? "";
  if (!token || !instanceId) return "queued";
  const claimed = object(await rest.rpc<unknown>("support_runtime_claim_delivery", { p_outbox_id: outboxId }));
  if (claimed.claimed !== true) {
    return claimed.status === "SENT" ? "sent" : "queued";
  }
  const phone = text(claimed.phone_e164).replace(/\D/g, "");
  const body = text(claimed.body);
  if (!phone || !body) {
    await rest.rpc("support_runtime_fail_delivery", {
      p_outbox_id: outboxId,
      p_error: "RUNTIME_DELIVERY_PAYLOAD_INVALID",
    }).catch(() => undefined);
    return "failed";
  }
  try {
    const response = await fetch(
      "https://api.w-api.app/v1/message/send-text?instanceId=" + encodeURIComponent(instanceId),
      {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ phone, message: body, delayMessage: 1 }),
      },
    );
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error("WAPI_SEND_FAILED");
    const externalId = text(payload.messageId) || text(payload.id) || text(object(payload.data).messageId);
    await rest.rpc("support_runtime_complete_delivery", {
      p_outbox_id: outboxId,
      p_external_message_id: externalId || null,
    });
    return "sent";
  } catch {
    await rest.rpc("support_runtime_fail_delivery", {
      p_outbox_id: outboxId,
      p_error: "WAPI_DELIVERY_FAILED",
    }).catch(() => undefined);
    return "failed";
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (Number(request.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    requireRuntimeIngressAccess(request);
    const payload = await request.json().catch(() => {
      throw new HttpProblem(400, "INVALID_JSON", "Request body must be valid JSON");
    });
    const rest = new OfficialSupabaseRest();
    const store = new SupabaseRuntimeStore(rest, new WapiAttachmentProcessor(rest));
    const result = await processOfficialTurn(inboundFromPayload(payload), store, interpreter());
    const delivery = await deliver(rest, result.outbox_id);
    return json({
      accepted: true,
      kind: result.kind,
      conversation_id: result.conversation_id,
      replied: result.reply_body !== null,
      delivery,
    });
  } catch (error) {
    if (error instanceof HttpProblem) return json({ error: error.code }, error.status);
    // Never log a provider body, user message, URL, token or raw database error.
    console.error("support_runtime_inbound_failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "RUNTIME_PROCESSING_FAILED" }, 500);
  }
});
