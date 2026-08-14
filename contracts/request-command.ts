export type RequestCommandAction = "PROPOSE" | "CONFIRM" | "DECLINE" | "GET_STATUS";
export type ConfirmationStatus = "PENDING" | "CONFIRMED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "CONSUMED";
export interface ProposalSnapshot { release_id: string; request_policy_id: string; category_code: string; subject: string; fields: Record<string, unknown>; document_ids: string[]; }
export interface PendingConfirmation { confirmation_id:string; confirmation_nonce?:string; conversation_id:string; session_id:string; topic_id:string; release_id:string; request_policy_id:string; proposal_snapshot:ProposalSnapshot; proposal_hash:string; status:ConfirmationStatus; expires_at:string; expected_state_version:number; expected_topic_version:number; request_id:string|null; }
/** Identifiers only: server resolves proposal, policy, expiry, category and protocol. */
export interface RequestCommandInput { action:RequestCommandAction; correlation_id:string; decision_id?:string; confirmation_id?:string; confirmation_nonce?:string; inbound_message_id?:string; classification_id?:string; actor_id?:string; shadow_only:boolean; }
export interface RequestCommandResult { status:"PROPOSED"|"CONFIRMED"|"DECLINED"|"EXPIRED"|"ALREADY_CONFIRMED"|"REJECTED"|"NOT_FOUND"|"SHADOW"; confirmation?:PendingConfirmation; request_id?:string; protocol?:string; reason_codes:string[]; }
