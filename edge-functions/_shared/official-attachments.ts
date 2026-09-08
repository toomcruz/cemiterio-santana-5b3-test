import type { RuntimeReceivedDocument } from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { HttpProblem } from "./http.ts";
import { OfficialSupabaseRest } from "./official-rest.ts";
import type { RuntimeAttachmentInput, RuntimeAttachmentProcessor } from "./official-runtime-store.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const STORAGE_BUCKET = "support-documents";
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
};

export interface WapiAttachmentOptions {
  token?: string;
  instanceId?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  randomUuid?: () => string;
}

class AttachmentFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeFileName(value: string, mimeType: string): string {
  const fallback = "arquivo." + (EXTENSION_BY_MIME[mimeType] ?? "bin");
  const normalized = value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .trim()
    .slice(0, 120) || fallback;
  if (/\.[a-zA-Z0-9]{2,5}$/.test(normalized)) return normalized;
  return normalized + "." + (EXTENSION_BY_MIME[mimeType] ?? "bin");
}

function hostIsPrivate(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(normalized)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function safeHttpsUrl(value: string, allowExternalHost: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AttachmentFailure("ATTACHMENT_URL_INVALID");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || hostIsPrivate(host)) {
    throw new AttachmentFailure("ATTACHMENT_URL_REJECTED");
  }
  const isWapiHost = host === "api.w-api.app" || host.endsWith(".w-api.app");
  if (!allowExternalHost && !isWapiHost) {
    throw new AttachmentFailure("ATTACHMENT_URL_REJECTED");
  }
  return url;
}

function contentType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function safeFailureCode(error: unknown): string {
  if (error instanceof AttachmentFailure) return error.code;
  if (error instanceof HttpProblem) return error.code.startsWith("SUPABASE") ? "ATTACHMENT_STORAGE_FAILED" : error.code;
  return "ATTACHMENT_UNAVAILABLE";
}

function receivedDocument(payload: Record<string, unknown>, now: Date): RuntimeReceivedDocument {
  const documentId = text(payload.document_id);
  const mimeType = text(payload.mime_type);
  const fileName = text(payload.file_name);
  if (!documentId || !mimeType || !fileName) {
    throw new HttpProblem(502, "ATTACHMENT_STORE_RESPONSE_INVALID", "The attachment store returned an invalid response");
  }
  return {
    documento_id: documentId,
    tipo: mimeType,
    descricao: fileName,
    recebido_em: now.toISOString(),
  };
}

/**
 * Downloads only W-API-sourced media, validates it, stores it in Supabase
 * Storage and records the fact through service-only RPCs. It never accepts or
 * validates a document for the municipality.
 */
export class WapiAttachmentProcessor implements RuntimeAttachmentProcessor {
  private readonly token: string;
  private readonly instanceId: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly randomUuid: () => string;

  constructor(
    private readonly rest = new OfficialSupabaseRest(),
    options: WapiAttachmentOptions = {},
  ) {
    this.token = options.token ?? Deno.env.get("WAPI_TOKEN") ?? "";
    this.instanceId = options.instanceId ?? Deno.env.get("WAPI_INSTANCE_ID") ?? "";
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  }

  async persist(input: RuntimeAttachmentInput): Promise<{
    received_document: RuntimeReceivedDocument | null;
    failure_code: string | null;
  }> {
    const existing = object(await this.rest.rpc<unknown>("support_runtime_get_attachment", {
      p_inbound_message_id: input.inbound_message_id,
      p_conversation_id: input.conversation_id,
    }));
    if (existing.found === true && existing.stored === true) {
      return { received_document: receivedDocument(existing, this.now()), failure_code: null };
    }

    try {
      const downloaded = await this.download(input);
      const storagePath = input.conversation_id + "/" + this.randomUuid() + "." +
        (EXTENSION_BY_MIME[downloaded.mimeType] ?? "bin");
      await this.rest.uploadObject(STORAGE_BUCKET, storagePath, downloaded.bytes, downloaded.mimeType);
      let stored: Record<string, unknown>;
      try {
        stored = object(await this.rest.rpc<unknown>("support_runtime_store_attachment", {
          p_inbound_message_id: input.inbound_message_id,
          p_conversation_id: input.conversation_id,
          p_file_name: downloaded.fileName,
          p_mime_type: downloaded.mimeType,
          p_message_type: input.attachment.message_type,
          p_storage_path: storagePath,
        }));
      } catch (error) {
        await this.rest.removeObject(STORAGE_BUCKET, storagePath).catch(() => undefined);
        throw error;
      }
      if (stored.stored !== true) throw new AttachmentFailure("ATTACHMENT_STORE_REJECTED");
      return { received_document: receivedDocument(stored, this.now()), failure_code: null };
    } catch (error) {
      const failureCode = safeFailureCode(error);
      await this.rest.rpc("support_runtime_fail_attachment", {
        p_inbound_message_id: input.inbound_message_id,
        p_conversation_id: input.conversation_id,
        p_error_code: failureCode,
      }).catch(() => undefined);
      return { received_document: null, failure_code: failureCode };
    }
  }

  private async download(input: RuntimeAttachmentInput): Promise<{
    bytes: ArrayBuffer;
    mimeType: string;
    fileName: string;
  }> {
    if (!this.token || !this.instanceId) {
      throw new AttachmentFailure("ATTACHMENT_TRANSPORT_UNCONFIGURED");
    }
    const declaredMime = contentType(input.attachment.mime_type);
    const source = await this.resolveSource(input.attachment);
    let response = await this.fetcher(source.url, {
      headers: source.needsAuthorization ? { authorization: "Bearer " + this.token } : {},
      redirect: "follow",
    });
    if ((response.status === 401 || response.status === 403) && !source.needsAuthorization) {
      response = await this.fetcher(source.url, {
        headers: { authorization: "Bearer " + this.token },
        redirect: "follow",
      });
    }
    if (!response.ok) throw new AttachmentFailure("ATTACHMENT_DOWNLOAD_FAILED");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES) {
      throw new AttachmentFailure("ATTACHMENT_TOO_LARGE");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_FILE_BYTES) throw new AttachmentFailure("ATTACHMENT_TOO_LARGE");
    const responseMime = contentType(response.headers.get("content-type") ?? "");
    const mimeType = this.resolveMimeType(declaredMime, responseMime);
    return {
      bytes,
      mimeType,
      fileName: safeFileName(input.attachment.file_name, mimeType),
    };
  }

  private resolveMimeType(declaredMime: string, responseMime: string): string {
    if (declaredMime && ALLOWED_MIME_TYPES.has(declaredMime)) {
      if (responseMime && responseMime !== "application/octet-stream" && responseMime !== declaredMime) {
        throw new AttachmentFailure("ATTACHMENT_MIME_MISMATCH");
      }
      return declaredMime;
    }
    if (responseMime && ALLOWED_MIME_TYPES.has(responseMime)) return responseMime;
    throw new AttachmentFailure("ATTACHMENT_TYPE_UNSUPPORTED");
  }

  private async resolveSource(attachment: RuntimeAttachmentInput["attachment"]): Promise<{
    url: string;
    needsAuthorization: boolean;
  }> {
    const mediaKey = text(attachment.media_key);
    const directPath = text(attachment.media_direct_path);
    if (mediaKey && directPath) {
      const response = await this.fetcher(
        "https://api.w-api.app/v1/message/download-media?instanceId=" + encodeURIComponent(this.instanceId),
        {
          method: "POST",
          headers: {
            authorization: "Bearer " + this.token,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mediaKey,
            directPath,
            type: attachment.message_type,
            mimetype: attachment.mime_type,
          }),
        },
      );
      if (!response.ok) throw new AttachmentFailure("ATTACHMENT_PREPARE_FAILED");
      const payload = object(await response.json().catch(() => ({})));
      const fileLink = text(payload.fileLink);
      if (!fileLink) throw new AttachmentFailure("ATTACHMENT_PREPARE_FAILED");
      return { url: safeHttpsUrl(fileLink, true).toString(), needsAuthorization: false };
    }

    const mediaUrl = text(attachment.media_url);
    if (!mediaUrl) throw new AttachmentFailure("ATTACHMENT_REFERENCE_MISSING");
    return { url: safeHttpsUrl(mediaUrl, false).toString(), needsAuthorization: true };
  }
}
