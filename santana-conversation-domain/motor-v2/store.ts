import { sha256 } from "../runtime/server_transition.ts";
import { canonicalJson } from "./canonical_json.ts";
import type {
  FixedClock,
  MotorV2AuditEvent,
  MotorV2State,
  SeededFact,
  UnderstandingResult,
  VersionedFact,
} from "./types.ts";

function scalarType(value: SeededFact["value"]): VersionedFact["value_type"] {
  if (value === null) return "null";
  return typeof value as "string" | "number" | "boolean";
}

function stateHash(state: MotorV2State): Promise<string> {
  return sha256(canonicalJson({ ...state, state_hash: "" }));
}

export function seedFacts(facts: readonly SeededFact[], clock: FixedClock): Promise<VersionedFact[]> {
  return Promise.all(facts.map(async (fact) => ({
    fact_id: `fact_${(await sha256(`${fact.key}:${fact.source_turn}:1`)).slice(0, 24)}`,
    key: fact.key,
    value: fact.value,
    value_type: scalarType(fact.value),
    source: fact.status,
    source_ref: fact.source_turn,
    confidence: "high" as const,
    version: 1,
    status: "active" as const,
    observed_at: clock.instant,
    temporal_status: "not_applicable" as const,
    superseded_by: null,
  })));
}

export async function upsertVersionedFact(
  facts: readonly VersionedFact[],
  input: Omit<VersionedFact, "fact_id" | "version" | "status" | "superseded_by">,
): Promise<VersionedFact[]> {
  const next = facts.map((fact) => structuredClone(fact));
  const active = [...next].reverse().find((fact) => fact.key === input.key && fact.status === "active");
  if (active && active.value === input.value && active.source === input.source) return next;
  const version = (active?.version ?? 0) + 1;
  const fact_id = `fact_${
    (await sha256(`${input.key}:${input.source_ref}:${version}:${canonicalJson(input.value)}`)).slice(0, 24)
  }`;
  if (active) {
    active.status = "superseded";
    active.superseded_by = fact_id;
  }
  next.push({ ...structuredClone(input), fact_id, version, status: "active", superseded_by: null });
  return next;
}

export class MemoryMotorV2Store {
  #state: MotorV2State | null = null;

  load(): MotorV2State | null {
    return this.#state ? structuredClone(this.#state) : null;
  }

  async commit(
    state: MotorV2State,
    inboundId: string,
    inboundHash: string,
    clock: FixedClock,
    detail: string,
  ): Promise<{ duplicate: boolean; state: MotorV2State }> {
    if (this.#state?.processed_inbound_ids.includes(inboundId)) {
      if (this.#state.processed_inbound_hashes[inboundId] !== inboundHash) {
        throw new Error("motor-v2 inbound id was reused with different content");
      }
      return { duplicate: true, state: structuredClone(this.#state) };
    }
    const expectedRevision = this.#state?.revision ?? 0;
    if (state.revision !== expectedRevision) throw new Error("motor-v2 revision conflict");
    const next = structuredClone(state);
    next.revision += 1;
    next.processed_inbound_ids = [...new Set([...next.processed_inbound_ids, inboundId])];
    next.processed_inbound_hashes = { ...next.processed_inbound_hashes, [inboundId]: inboundHash };
    const beforeAuditHash = await stateHash(next);
    const audit: MotorV2AuditEvent = {
      sequence: next.audit.length + 1,
      at: clock.instant,
      kind: "turn_committed",
      detail,
      state_hash: beforeAuditHash,
    };
    next.audit = [...next.audit, audit];
    next.state_hash = await stateHash(next);
    this.#state = structuredClone(next);
    return { duplicate: false, state: structuredClone(next) };
  }
}

export function emptyUnderstanding(): UnderstandingResult {
  return {
    schema_version: "motor-v2-understanding/1.0.0",
    journeys: [],
    subintents: [],
    transverse_states: [],
    intent_changed: false,
    complexity: "low",
    risk: { level: "none", signals: [] },
    confidence: "low",
    evidence_turns: [],
  };
}
