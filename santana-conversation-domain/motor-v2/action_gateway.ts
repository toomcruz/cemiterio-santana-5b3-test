import { canonicalJson, sha256 } from "../runtime/server_transition.ts";
import type { FixedClock, GatewayCallRecord, GatewayReceipt, JsonScalar, ReceiptType } from "./types.ts";

export interface ActionRequest {
  tool:
    | "handoff.request"
    | "booking.request"
    | "payment.request"
    | "document.submit"
    | "confirmation.record"
    | "execution.confirm"
    | "resolution.confirm";
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
  "confirmation.record": {
    irreversible: false,
    requires_confirmation: true,
    receipt_type: "explicit_user_confirmation",
  },
  "execution.confirm": { irreversible: true, requires_confirmation: true, receipt_type: "execution_confirmation" },
  "resolution.confirm": { irreversible: true, requires_confirmation: true, receipt_type: "resolution_confirmation" },
};

/**
 * Closed-by-default gateway. External effects require an injected executor and
 * explicit opt-in; the lab runtime never supplies either.
 */
export class ActionGateway {
  readonly #calls = new Map<string, { request_hash: string; record: GatewayCallRecord }>();
  readonly #inflight = new Map<string, { request_hash: string; result: Promise<GatewayCallRecord> }>();

  constructor(
    private readonly clock: FixedClock,
    private readonly options: { external_effects_allowed: boolean; executor?: ActionExecutor } = {
      external_effects_allowed: false,
    },
  ) {}

  async invoke(request: ActionRequest): Promise<GatewayCallRecord> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new Error("invalid action request");
    }
    const requestKeys = new Set([
      "tool",
      "idempotency_key",
      "payload",
      "explicit_confirmation",
      "required_receipt_type",
      "claim_codes",
    ]);
    const payloadIsObject = request.payload !== null && typeof request.payload === "object" &&
      !Array.isArray(request.payload);
    if (
      Object.keys(request).some((key) => !requestKeys.has(key)) ||
      typeof request.tool !== "string" ||
      typeof request.idempotency_key !== "string" ||
      typeof request.explicit_confirmation !== "boolean" ||
      typeof request.required_receipt_type !== "string" ||
      !payloadIsObject
    ) {
      throw new Error("invalid action request");
    }
    // The caller retains its object. Snapshot it before the first await so
    // validation, hashing, execution and receipts bind to exactly one request.
    const snapshot = structuredClone(request);
    const toolPolicy = TOOL_POLICY[snapshot.tool];
    const validPayload = Object.values(snapshot.payload).every((value) =>
      value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)
    );
    if (
      !toolPolicy || !snapshot.idempotency_key.trim() ||
      !Array.isArray(snapshot.claim_codes) ||
      snapshot.claim_codes.length === 0 ||
      snapshot.claim_codes.some((code) => typeof code !== "string" || !code.trim()) ||
      new Set(snapshot.claim_codes).size !== snapshot.claim_codes.length ||
      !validPayload
    ) {
      return this.record(snapshot, "denied", "invalid or non-allowlisted action request", null);
    }
    const requestHash = await sha256(canonicalJson(snapshot));
    const prior = this.#calls.get(snapshot.idempotency_key);
    if (prior) {
      if (prior.request_hash !== requestHash) {
        return this.record(snapshot, "denied", "idempotency key reused with a different request", null);
      }
      return this.replay(prior.record);
    }
    const inflight = this.#inflight.get(snapshot.idempotency_key);
    if (inflight) {
      if (inflight.request_hash !== requestHash) {
        return this.record(snapshot, "denied", "idempotency key reused with a different request", null);
      }
      return this.replay(await inflight.result);
    }
    const result = this.executeOnce(snapshot, requestHash, toolPolicy);
    this.#inflight.set(snapshot.idempotency_key, { request_hash: requestHash, result });
    try {
      return structuredClone(await result);
    } finally {
      this.#inflight.delete(snapshot.idempotency_key);
    }
  }

  private async executeOnce(
    request: ActionRequest,
    requestHash: string,
    toolPolicy: (typeof TOOL_POLICY)[ActionRequest["tool"]],
  ): Promise<GatewayCallRecord> {
    let terminal: GatewayCallRecord;
    if (request.required_receipt_type !== toolPolicy.receipt_type) {
      terminal = this.record(request, "denied", "receipt type does not match the allowlisted tool", null);
    } else if (toolPolicy.requires_confirmation && !request.explicit_confirmation) {
      terminal = this.record(request, "denied", "explicit confirmation required", null);
    } else if (!this.options.external_effects_allowed || !this.options.executor) {
      terminal = this.record(request, "denied", "external effects disabled", null);
    } else {
      const execution = await this.options.executor.execute(structuredClone(request));
      if (!execution.accepted || !execution.reference) {
        terminal = this.record(request, "proposed", "executor did not confirm the effect", null);
      } else {
        const payload_hash = await sha256(canonicalJson(request.payload));
        const receiptDigest = await sha256(`${request.idempotency_key}:${execution.reference}`);
        const alphabet = "abcdefghijklmnop";
        const receiptSuffix = receiptDigest.slice(0, 24).split("").map((character) =>
          alphabet[Number.parseInt(character, 16)]
        ).join("");
        const unsigned = {
          receipt_id: `receipt_${receiptSuffix}`,
          receipt_type: request.required_receipt_type,
          tool: request.tool,
          idempotency_key: request.idempotency_key,
          issued_at: this.clock.instant,
          payload_hash,
          executor_reference_hash: await sha256(execution.reference),
          bound_claim_codes: [...request.claim_codes].sort(),
        };
        const receipt: GatewayReceipt = {
          ...unsigned,
          integrity_hash: await sha256(canonicalJson(unsigned)),
        };
        terminal = this.record(request, "executed", "executor returned a verifiable reference", receipt);
      }
    }
    this.#calls.set(request.idempotency_key, { request_hash: requestHash, record: terminal });
    return structuredClone(terminal);
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

  private replay(record: GatewayCallRecord): GatewayCallRecord {
    return {
      ...structuredClone(record),
      authorized: record.receipt !== null,
      side_effect: false,
      outcome: record.receipt ? "replayed" : record.outcome,
    };
  }
}
