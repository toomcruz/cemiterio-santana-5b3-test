import { canonicalJson, sha256 } from "../runtime/server_transition.ts";
import type { FixedClock, GatewayCallRecord, GatewayReceipt, JsonScalar, ReceiptType } from "./types.ts";

export interface ActionRequest {
  tool: "handoff.request" | "booking.request" | "payment.request" | "document.submit" | "draft.preview";
  idempotency_key: string;
  payload: Record<string, JsonScalar>;
  explicit_confirmation: boolean;
  required_receipt_type: ReceiptType;
  claim_codes: string[];
}

export interface ActionExecutor {
  execute(request: ActionRequest): Promise<{ accepted: boolean; reference: string | null }>;
}

const TOOL_POLICY: Record<
  ActionRequest["tool"],
  { irreversible: boolean; requires_confirmation: boolean; receipt_type: ReceiptType }
> = {
  "handoff.request": { irreversible: false, requires_confirmation: false, receipt_type: "handoff_acceptance" },
  "booking.request": { irreversible: true, requires_confirmation: true, receipt_type: "booking_confirmation" },
  "payment.request": { irreversible: true, requires_confirmation: true, receipt_type: "payment_confirmation" },
  "document.submit": { irreversible: true, requires_confirmation: true, receipt_type: "document_confirmation" },
  "draft.preview": { irreversible: false, requires_confirmation: true, receipt_type: "explicit_user_confirmation" },
};

/**
 * Closed-by-default gateway. External effects require an injected executor and
 * explicit opt-in; the lab runtime never supplies either.
 */
export class ActionGateway {
  readonly #calls = new Map<string, { request_hash: string; record: GatewayCallRecord }>();

  constructor(
    private readonly clock: FixedClock,
    private readonly options: { external_effects_allowed: boolean; executor?: ActionExecutor } = {
      external_effects_allowed: false,
    },
  ) {}

  async invoke(request: ActionRequest): Promise<GatewayCallRecord> {
    const requestHash = await sha256(canonicalJson(request));
    const prior = this.#calls.get(request.idempotency_key);
    if (prior) {
      if (prior.request_hash !== requestHash) {
        return this.record(request, "denied", "idempotency key reused with a different request", null);
      }
      return {
        ...structuredClone(prior.record),
        outcome: prior.record.receipt ? "replayed" : prior.record.outcome,
      };
    }
    const toolPolicy = TOOL_POLICY[request.tool];
    if (
      !toolPolicy || !request.idempotency_key ||
      !Array.isArray(request.claim_codes) ||
      request.claim_codes.some((code) => typeof code !== "string" || !code.trim()) ||
      new Set(request.claim_codes).size !== request.claim_codes.length ||
      Object.values(request.payload).some((value) =>
        value !== null && !["string", "number", "boolean"].includes(typeof value)
      )
    ) {
      return this.record(request, "denied", "invalid or non-allowlisted action request", null);
    }
    if (request.required_receipt_type !== toolPolicy.receipt_type) {
      const denied = this.record(request, "denied", "receipt type does not match the allowlisted tool", null);
      this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: denied });
      return structuredClone(denied);
    }
    if (toolPolicy.requires_confirmation && !request.explicit_confirmation) {
      const denied = this.record(request, "denied", "explicit confirmation required", null);
      this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: denied });
      return structuredClone(denied);
    }
    if (!this.options.external_effects_allowed || !this.options.executor) {
      const denied = this.record(request, "denied", "external effects disabled", null);
      this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: denied });
      return structuredClone(denied);
    }
    const result = await this.options.executor.execute(structuredClone(request));
    if (!result.accepted || !result.reference) {
      const proposed = this.record(request, "proposed", "executor did not confirm the effect", null);
      this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: proposed });
      return structuredClone(proposed);
    }
    const payload_hash = await sha256(canonicalJson(request.payload));
    const unsigned = {
      receipt_id: `receipt_${(await sha256(`${request.idempotency_key}:${result.reference}`)).slice(0, 24)}`,
      receipt_type: request.required_receipt_type,
      tool: request.tool,
      idempotency_key: request.idempotency_key,
      issued_at: this.clock.instant,
      payload_hash,
      executor_reference_hash: await sha256(result.reference),
      bound_claim_codes: [...request.claim_codes].sort(),
    };
    const receipt: GatewayReceipt = {
      ...unsigned,
      integrity_hash: await sha256(canonicalJson(unsigned)),
    };
    const executed = this.record(request, "executed", "executor returned a verifiable reference", receipt);
    this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: executed });
    return structuredClone(executed);
  }

  async verifyReceipt(receipt: GatewayReceipt): Promise<boolean> {
    const { integrity_hash, ...unsigned } = receipt;
    if (integrity_hash !== await sha256(canonicalJson(unsigned))) return false;
    const stored = this.#calls.get(receipt.idempotency_key)?.record.receipt;
    return stored !== null && stored !== undefined && canonicalJson(stored) === canonicalJson(receipt);
  }

  private record(
    request: ActionRequest,
    outcome: GatewayCallRecord["outcome"],
    reason: string,
    receipt: GatewayReceipt | null,
  ): GatewayCallRecord {
    return {
      tool: request.tool,
      authorized: outcome === "executed" || outcome === "replayed",
      side_effect: outcome === "executed",
      outcome,
      reason,
      receipt,
    };
  }
}
