export type AutomationMode = "BOT_ACTIVE" | "HUMAN_ACTIVE";
export type SessionStatus = "ACTIVE" | "WARNING_PENDING" | "WARNING_SENT" | "CLOSED";
export type TopicStatus =
  | "ACTIVE"
  | "WAITING_INPUT"
  | "WAITING_DOCUMENT"
  | "WAITING_CONFIRMATION"
  | "WAITING_HUMAN"
  | "READY_FOR_REVIEW"
  | "SCHEDULE_REQUIRED"
  | "COMPLETED"
  | "BLOCKED"
  | "A_CONFIRMAR"
  | "CANCELLED";

export interface PendingQuestionSnapshot {
  question_id: string;
  question_code: string;
  expected_answer_schema: Record<string, unknown>;
  asked_at: string;
  expires_at: string | null;
  status: "OPEN" | "ANSWERED" | "EXPIRED" | "CANCELLED";
}

export interface PendingConfirmationSnapshot {
  confirmation_id: string;
  confirmation_nonce: string;
  topic_id: string;
  expires_at: string;
  status: "PENDING";
}

export interface TopicSnapshot {
  topic_id: string;
  topic_version: number;
  intent_code: string;
  service_code: string | null;
  location_type: "QUADRA_GERAL" | "JAZIGO" | "OSSUARIO" | "NAO_INFORMADO" | "A_CONFIRMAR" | null;
  status: TopicStatus;
  collected_data: Record<string, unknown>;
  collected_field_names: string[];
  pending_question: PendingQuestionSnapshot | null;
}

export interface ConversationStateSnapshot {
  snapshot_id: string;
  conversation_id: string;
  session_id: string;
  release_id: string;
  automation_mode: AutomationMode;
  session_status: SessionStatus;
  state_version: number;
  active_topic: TopicSnapshot | null;
  queued_topic_ids: string[];
  pending_confirmation: PendingConfirmationSnapshot | null;
  provider_window_expires_at: string | null;
  last_inbound_at: string | null;
  human_handoff_active: boolean;
  applicable_request_active: boolean;
}

export interface MessageAttachment {
  message_id: string;
  media_type: "IMAGE" | "DOCUMENT" | "AUDIO" | "OTHER";
  mime_type?: string;
  sha256?: string;
  storage_key?: string;
}

export interface MessageBatch {
  batch_id: string;
  message_ids: string[];
  text: string;
  attachments: MessageAttachment[];
  received_at: string;
  is_first_inbound_of_session: boolean;
  quiet_seconds: number;
}

export function sessionIsOpen(status: SessionStatus): boolean {
  return status === "ACTIVE" || status === "WARNING_PENDING" || status === "WARNING_SENT";
}
