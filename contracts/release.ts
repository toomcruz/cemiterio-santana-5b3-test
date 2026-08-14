export const RULESET_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "SUPERSEDED",
  "REVOKED",
  "ARCHIVED",
] as const;

export type RulesetStatus = (typeof RULESET_STATUSES)[number];
export type RevocationMode = "BLOCK_FACTS" | "EXPLICIT_REBIND" | "TERMINATE_AFFECTED_FLOW";

export interface PublishedRelease {
  release_id: string;
  release_code: string;
  scope_code: string;
  status: RulesetStatus;
  effective_from: string;
  effective_to: string | null;
  content_hash: string;
  parent_release_id: string | null;
  revocation_mode: RevocationMode | null;
  replacement_release_id: string | null;
  revoked_at: string | null;
}

export interface SessionReleaseBinding {
  session_id: string;
  conversation_id: string;
  release_id: string;
  bound_at: string;
  binding_reason: "NEW_SESSION" | "EXPLICIT_REBIND";
  transition_event_id?: string;
}

export interface ReleaseResolutionRequest {
  action?: "RESOLVE" | "EXPLICIT_REBIND";
  conversation_id: string;
  session_id?: string;
  scope_code: string;
  at: string;
  shadow_only: boolean;
  explicit_rebind?: {
    from_release_id: string;
    to_release_id: string;
    reason: string;
    authorized_by: string;
  };
}

export interface ReleaseResolutionResult {
  status: "RESOLVED" | "SESSION_PINNED" | "REBOUND" | "REVOKED" | "NOT_FOUND" | "INVALID";
  release: PublishedRelease | null;
  binding: SessionReleaseBinding | null;
  blocking_reason?: string;
  would_bind?: boolean;
}

export function isPublishedAndEffective(release: PublishedRelease, at: Date): boolean {
  if (release.status !== "PUBLISHED") return false;
  if (release.revoked_at) return false;
  const from = new Date(release.effective_from).getTime();
  const to = release.effective_to ? new Date(release.effective_to).getTime() : Number.POSITIVE_INFINITY;
  const instant = at.getTime();
  return Number.isFinite(from) && Number.isFinite(instant) && instant >= from && instant < to;
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
