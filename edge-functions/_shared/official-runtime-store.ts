import type {
  RuntimeCommit,
  RuntimeInbound,
  RuntimeLease,
  RuntimeReceivedDocument,
  RuntimeStore,
} from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import { HttpProblem } from "./http.ts";
import { OfficialSupabaseRest } from "./official-rest.ts";

export interface RuntimeAttachmentInput {
  conversation_id: string;
  inbound_message_id: string;
  attachment: NonNullable<RuntimeInbound["attachment"]>;
}

export interface RuntimeAttachmentProcessor {
  persist(input: RuntimeAttachmentInput): Promise<{
    received_document: RuntimeReceivedDocument | null;
    failure_code: string | null;
  }>;
}

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpProblem(502, "SUPABASE_RUNTIME_RESPONSE_INVALID", "The runtime store returned an invalid response");
  }
  return value as JsonRecord;
}

function text(value: unknown, _field: string): string {
  if (typeof value !== "string" || !value) {
    throw new HttpProblem(502, "SUPABASE_RUNTIME_RESPONSE_INVALID", "The runtime store response is incomplete");
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpProblem(502, "SUPABASE_RUNTIME_RESPONSE_INVALID", "The runtime store returned an invalid revision");
  }
  return value;
}

function mode(value: unknown): RuntimeLease["automation_mode"] {
  if (value === "BOT_ACTIVE" || value === "HUMAN_ACTIVE") return value;
  throw new HttpProblem(
    502,
    "SUPABASE_RUNTIME_RESPONSE_INVALID",
    "The runtime store returned an invalid automation mode",
  );
}

/**
 * Maps the official TypeScript transaction contract to the service-only SQL
 * API. It does not know Next.js, n8n or panel workflow stages.
 */
export class SupabaseRuntimeStore implements RuntimeStore {
  constructor(
    private readonly rest = new OfficialSupabaseRest(),
    private readonly attachments: RuntimeAttachmentProcessor | null = null,
  ) {}

  async acquireInbound(input: RuntimeInbound & { catalog_hash: string }): Promise<RuntimeLease> {
    const payload = object(
      await this.rest.rpc<unknown>("support_runtime_acquire_inbound", {
        p_external_message_id: input.external_message_id,
        p_phone_e164: input.phone_e164,
        p_contact_name: input.contact_name,
        p_body: input.body,
        p_message_type: input.message_type,
        p_metadata: input.metadata ?? {},
        p_catalog_hash: input.catalog_hash,
      }),
    );
    const lease: RuntimeLease = {
      duplicate: payload.duplicate === true,
      conversation_id: text(payload.conversation_id, "conversation_id"),
      inbound_message_id: text(payload.inbound_message_id, "inbound_message_id"),
      revision: revision(payload.revision),
      automation_mode: mode(payload.automation_mode),
      catalog_hash: nullableText(payload.catalog_hash),
      state: payload.state ?? null,
    };
    if (input.attachment) {
      if (!this.attachments) {
        throw new HttpProblem(503, "ATTACHMENT_RUNTIME_UNCONFIGURED", "Attachment storage is not configured");
      }
      const attachment = await this.attachments.persist({
        conversation_id: lease.conversation_id,
        inbound_message_id: lease.inbound_message_id,
        attachment: input.attachment,
      });
      lease.received_document = attachment.received_document;
      lease.attachment_failure = attachment.failure_code;
    }
    return lease;
  }

  async commitTurn(input: RuntimeCommit): Promise<{ replayed: boolean; revision: number; outbox_id: string | null }> {
    const payload = object(
      await this.rest.rpc<unknown>("support_runtime_commit_turn", {
        p_conversation_id: input.conversation_id,
        p_inbound_message_id: input.inbound_message_id,
        p_expected_revision: input.expected_revision,
        p_catalog_hash: input.catalog_hash,
        p_state_hash: input.state_hash,
        p_state: input.state,
        p_outcome: input.outcome,
        p_event_kind: input.event_kind,
        p_reply_body: input.reply_body,
        p_projection: input.projection,
      }),
    );
    return {
      replayed: payload.replayed === true,
      revision: revision(payload.revision),
      outbox_id: nullableText(payload.outbox_id),
    };
  }
}
