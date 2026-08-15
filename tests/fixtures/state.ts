import type { ConversationStateSnapshot, MessageBatch } from "../../contracts/state.ts";
import type { TaxonomySnapshot } from "../../contracts/classifier.ts";
import { ids } from "./ids.ts";

export function stateFixture(overrides: Partial<ConversationStateSnapshot> = {}): ConversationStateSnapshot {
  return {
    snapshot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    conversation_id: ids.conversation,
    session_id: ids.session,
    release_id: ids.release,
    automation_mode: "BOT_ACTIVE",
    session_status: "ACTIVE",
    state_version: 7,
    active_topic: {
      topic_id: ids.topic,
      topic_version: 3,
      intent_code: "RECADASTRO",
      service_code: "RECADASTRO",
      location_type: null,
      status: "WAITING_INPUT",
      collected_data: {},
      collected_field_names: [],
      pending_question: {
        question_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        question_code: "ESCOLHER_OPCAO",
        expected_answer_schema: { type: "integer" },
        asked_at: "2026-08-14T12:00:00.000Z",
        expires_at: null,
        status: "OPEN",
      },
    },
    queued_topic_ids: [],
    pending_confirmation: null,
    provider_window_expires_at: null,
    last_inbound_at: "2026-08-14T12:00:00.000Z",
    human_handoff_active: false,
    applicable_request_active: false,
    ...overrides,
  };
}

export function batchFixture(text: string, overrides: Partial<MessageBatch> = {}): MessageBatch {
  return {
    batch_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    message_ids: [ids.message],
    text,
    attachments: [],
    received_at: "2026-08-14T12:00:10.000Z",
    is_first_inbound_of_session: false,
    quiet_seconds: 7,
    ...overrides,
  };
}

export function taxonomyFixture(): TaxonomySnapshot {
  return {
    release_id: ids.release,
    taxonomy_hash: "a".repeat(64),
    intents: [
      { code: "RECADASTRO", visibility: "PUBLIC" },
      { code: "RECLAMACAO_INTERNA", visibility: "INTERNAL" },
      { code: "A_CONFIRMAR", visibility: "SYSTEM" },
    ],
    services: [
      { code: "RECADASTRO", availability_status: "ACTIVE", aliases: ["recadastro"] },
      { code: "EXUMACAO", availability_status: "ACTIVE", aliases: ["exumação"] },
      { code: "OSSUARIO", availability_status: "ACTIVE", aliases: ["ossuário"] },
      { code: "PROCESSO_CONCESSAO", availability_status: "ACTIVE", aliases: ["concessão"] },
      { code: "TAXA_CONCESSAO", availability_status: "ACTIVE", aliases: ["taxa de concessão"] },
      { code: "TRANSPORTE_FALECIDOS_RESTOS", availability_status: "ACTIVE", aliases: ["transporte de restos mortais"] },
      { code: "COMERCIAL", availability_status: "ACTIVE", aliases: ["comercial"] },
      { code: "ZELADORIA", availability_status: "ACTIVE", aliases: ["zeladoria"] },
    ],
    location_types: ["QUADRA_GERAL", "JAZIGO", "OSSUARIO", "NAO_INFORMADO", "A_CONFIRMAR"],
  };
}
