/** A classification must already have been persisted by support-classifier. */
export interface PersistInboundClassificationInput {
  classification_id: string;
  inbound_message_id: string;
  session_id: string;
  topic_id: string;
  release_id: string;
  classification_code: "CONFIRMATION_AFFIRMATIVE" | "OTHER";
  classification_status: "OK" | "AMBIGUOUS" | "BLOCKED";
  source: "DETERMINISTIC";
}

export interface ConfirmationAuthorizationInput {
  classification_id: string;
  inbound_message_id: string;
  confirmation_id: string;
  confirmation_nonce: string;
  session_id: string;
  topic_id: string;
  release_id: string;
}
export interface ConfirmationAuthorizationResult {
  authorization_id: string;
  classification_id: string;
  classification_hash: string;
  status: "AUTHORIZED";
}
