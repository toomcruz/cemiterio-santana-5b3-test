import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";

const encoder = new TextEncoder();
const HASH = /^[a-f0-9]{64}$/;
const SAFE_KEY_VERSION = /^[a-z][a-z0-9_-]{7,63}$/;
const SAFE_ACTION = /^[a-z][a-z0-9_.:-]{2,127}$/;
const SAFE_CHANNEL = /^[A-Z][A-Z0-9_]{2,31}$/;
const MAX_CHALLENGE_LIFETIME_MS = 15 * 60 * 1_000;
const AFFIRMATIVE = new Set(["sim", "confirmo"]);

export const CONFIRMATION_LEDGER_SCHEMA = "phase18b-confirmation-ledger/1.0.0" as const;
export const CONFIRMATION_CHALLENGE_SCHEMA = "phase18b-confirmation-challenge/1.0.0" as const;
export const TRUSTED_EVENT_SCHEMA = "phase18b-trusted-inbound-event/1.0.0" as const;
export const CONFIRMATION_ATTESTATION_SCHEMA = "phase18b-confirmation-attestation/1.0.0" as const;
export const SHADOW_AUTHORIZATION_SCHEMA = "phase18b-shadow-action-authorization/1.0.0" as const;

export type ConfirmationState = "COMMON" | "CONTEXTUAL" | "AUTHENTICATED" | "EXECUTION_RECEIPT";

export interface IssueChallengeInput {
  confirmation_id: string;
  conversation_ref: string;
  actor_ref: string;
  channel: string;
  action: string;
  sanitized_input_hash: string;
  proposal_version: number;
  prompt_event_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
}

export interface ConfirmationChallenge extends IssueChallengeInput {
  schema_version: typeof CONFIRMATION_CHALLENGE_SCHEMA;
  state: "CONTEXTUAL";
  proposal_hash: string;
  key_version: string;
  effect_permitted: false;
  execution_receipt: null;
  integrity_hmac: string;
}

export interface TrustedInboundEventInput {
  event_id: string;
  conversation_ref: string;
  actor_ref: string;
  channel: string;
  reply_to_event_id: string | null;
  received_at: string;
}

export interface TrustedInboundEvent extends TrustedInboundEventInput {
  schema_version: typeof TRUSTED_EVENT_SCHEMA;
  content_hash: string;
  key_version: string;
  integrity_hmac: string | null;
}

export interface ConfirmationAttestation {
  schema_version: typeof CONFIRMATION_ATTESTATION_SCHEMA;
  state: "AUTHENTICATED";
  attestation_id: string;
  confirmation_id: string;
  conversation_ref: string;
  actor_ref: string;
  channel: string;
  action: string;
  sanitized_input_hash: string;
  proposal_version: number;
  proposal_hash: string;
  prompt_event_id: string;
  confirming_event_id: string;
  confirming_content_hash: string;
  confirmed_at: string;
  nonce: string;
  idempotency_key: string;
  key_version: string;
  effect_permitted: false;
  execution_receipt: null;
  integrity_hmac: string;
}

export interface CommonConfirmationResult {
  state: "COMMON";
  authenticated: false;
  effect_permitted: false;
  execution_receipt: null;
  reason: "NOT_AFFIRMATIVE" | "NO_ACTIVE_CONTEXT" | "OUT_OF_CONTEXT";
}

export interface ContextualConfirmationResult {
  state: "CONTEXTUAL";
  authenticated: false;
  effect_permitted: false;
  execution_receipt: null;
  confirmation_id: string;
  reason: "UNAUTHENTICATED_EVENT" | "NOT_YET_ACTIVE" | "EXPIRED" | "ALREADY_CONSUMED";
}

export interface AuthenticatedConfirmationResult {
  state: "AUTHENTICATED";
  authenticated: true;
  effect_permitted: false;
  execution_receipt: null;
  duplicate: boolean;
  attestation: ConfirmationAttestation;
}

export type ConfirmationEvaluation =
  | CommonConfirmationResult
  | ContextualConfirmationResult
  | AuthenticatedConfirmationResult;

/**
 * This state is intentionally not produced by ConfirmationAuthority. Only a
 * separately authorized tool executor may issue an execution receipt.
 */
export interface ExecutionReceiptState {
  schema_version: "phase18b-execution-receipt/1.0.0";
  state: "EXECUTION_RECEIPT";
  receipt_id: string;
  attestation_id: string;
  proposal_hash: string;
  executed_at: string;
}

export interface AuthorizeWouldCallInput {
  confirmation_id: string;
  attestation_id: string;
  conversation_ref: string;
  actor_ref: string;
  channel: string;
  action: string;
  sanitized_input_hash: string;
  proposal_version: number;
  proposal_hash: string;
}

export interface ShadowActionAuthorization {
  schema_version: typeof SHADOW_AUTHORIZATION_SCHEMA;
  state: "AUTHENTICATED";
  authorized: true;
  effect_permitted: false;
  would_call: true;
  confirmation_id: string;
  attestation_id: string;
  conversation_ref: string;
  actor_ref: string;
  channel: string;
  action: string;
  proposal_hash: string;
  idempotency_key: string;
  execution_receipt: null;
}

interface EventBinding {
  content_hash: string;
  confirmation_id: string;
  attestation_id: string;
}

interface LedgerBody {
  schema_version: typeof CONFIRMATION_LEDGER_SCHEMA;
  key_version: string;
  challenges: Record<string, ConfirmationChallenge>;
  attestations: Record<string, ConfirmationAttestation>;
  event_bindings: Record<string, EventBinding>;
}

interface StoredLedger extends LedgerBody {
  integrity_hmac: string;
}

const ISSUE_KEYS = [
  "action",
  "actor_ref",
  "channel",
  "confirmation_id",
  "conversation_ref",
  "expires_at",
  "issued_at",
  "nonce",
  "prompt_event_id",
  "proposal_version",
  "sanitized_input_hash",
] as const;

const EVENT_INPUT_KEYS = [
  "actor_ref",
  "channel",
  "conversation_ref",
  "event_id",
  "received_at",
  "reply_to_event_id",
] as const;

const EVENT_KEYS = [
  "actor_ref",
  "channel",
  "content_hash",
  "conversation_ref",
  "event_id",
  "integrity_hmac",
  "key_version",
  "received_at",
  "reply_to_event_id",
  "schema_version",
] as const;

const EVALUATION_KEYS = ["confirmation_id", "event", "transient_text"] as const;

const AUTHORIZATION_KEYS = [
  "action",
  "actor_ref",
  "attestation_id",
  "channel",
  "confirmation_id",
  "conversation_ref",
  "proposal_hash",
  "proposal_version",
  "sanitized_input_hash",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains missing or unsupported fields`);
  }
}

function assertPseudonymousRef(value: unknown, prefix: string, label: string): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(value)) {
    throw new Error(`invalid ${label}`);
  }
}

function assertKeyVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_KEY_VERSION.test(value)) throw new Error("invalid key version");
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`invalid ${label}`);
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  if (!Number.isFinite(Date.parse(value))) throw new Error(`invalid ${label}`);
}

function validateIssueInput(input: unknown): asserts input is IssueChallengeInput {
  assertExactKeys(input, ISSUE_KEYS, "confirmation challenge input");
  assertPseudonymousRef(input.confirmation_id, "confirmation", "confirmation id");
  assertPseudonymousRef(input.conversation_ref, "conversation", "conversation ref");
  assertPseudonymousRef(input.actor_ref, "actor", "actor ref");
  if (typeof input.channel !== "string" || !SAFE_CHANNEL.test(input.channel)) throw new Error("invalid channel");
  if (typeof input.action !== "string" || !SAFE_ACTION.test(input.action)) throw new Error("invalid action");
  assertHash(input.sanitized_input_hash, "sanitized input hash");
  if (!Number.isSafeInteger(input.proposal_version) || (input.proposal_version as number) < 1) {
    throw new Error("invalid proposal version");
  }
  assertPseudonymousRef(input.prompt_event_id, "prompt", "prompt event id");
  assertPseudonymousRef(input.nonce, "nonce", "nonce");
  assertIsoTimestamp(input.issued_at, "issued at");
  assertIsoTimestamp(input.expires_at, "expires at");
  const lifetime = Date.parse(input.expires_at) - Date.parse(input.issued_at);
  if (lifetime <= 0 || lifetime > MAX_CHALLENGE_LIFETIME_MS) throw new Error("invalid challenge lifetime");
}

function validateEventInput(input: unknown): asserts input is TrustedInboundEventInput {
  assertExactKeys(input, EVENT_INPUT_KEYS, "trusted event input");
  assertPseudonymousRef(input.event_id, "event", "event id");
  assertPseudonymousRef(input.conversation_ref, "conversation", "conversation ref");
  assertPseudonymousRef(input.actor_ref, "actor", "actor ref");
  if (typeof input.channel !== "string" || !SAFE_CHANNEL.test(input.channel)) throw new Error("invalid channel");
  if (input.reply_to_event_id !== null) {
    assertPseudonymousRef(input.reply_to_event_id, "prompt", "reply event id");
  }
  assertIsoTimestamp(input.received_at, "received at");
}

function validateEvent(event: unknown): asserts event is TrustedInboundEvent {
  assertExactKeys(event, EVENT_KEYS, "trusted event");
  if (event.schema_version !== TRUSTED_EVENT_SCHEMA) throw new Error("invalid trusted event schema");
  validateEventInput({
    event_id: event.event_id,
    conversation_ref: event.conversation_ref,
    actor_ref: event.actor_ref,
    channel: event.channel,
    reply_to_event_id: event.reply_to_event_id,
    received_at: event.received_at,
  });
  assertHash(event.content_hash, "content hash");
  assertKeyVersion(event.key_version);
  if (event.integrity_hmac !== null) assertHash(event.integrity_hmac, "event integrity hmac");
}

function validateAuthorizationInput(input: unknown): asserts input is AuthorizeWouldCallInput {
  assertExactKeys(input, AUTHORIZATION_KEYS, "shadow authorization input");
  assertPseudonymousRef(input.confirmation_id, "confirmation", "confirmation id");
  assertPseudonymousRef(input.attestation_id, "attestation", "attestation id");
  assertPseudonymousRef(input.conversation_ref, "conversation", "conversation ref");
  assertPseudonymousRef(input.actor_ref, "actor", "actor ref");
  if (typeof input.channel !== "string" || !SAFE_CHANNEL.test(input.channel)) throw new Error("invalid channel");
  if (typeof input.action !== "string" || !SAFE_ACTION.test(input.action)) throw new Error("invalid action");
  assertHash(input.sanitized_input_hash, "sanitized input hash");
  assertHash(input.proposal_hash, "proposal hash");
  if (!Number.isSafeInteger(input.proposal_version) || (input.proposal_version as number) < 1) {
    throw new Error("invalid proposal version");
  }
}

function normalizeConfirmationText(text: string): string {
  return text.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!HASH.test(hex)) throw new Error("invalid hmac encoding");
  return new Uint8Array(hex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function assertSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.byteLength < 32) {
    throw new Error("LAB confirmation secret must contain at least 32 bytes");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function importStateHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  assertSecret(secret);
  return await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function importIngressSigningKey(secret: Uint8Array): Promise<CryptoKey> {
  assertSecret(secret);
  return await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function importIngressVerificationKey(secret: Uint8Array): Promise<CryptoKey> {
  assertSecret(secret);
  return await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}

async function hmac(key: CryptoKey, domain: string, value: unknown): Promise<string> {
  const material = `${domain}\n${canonicalJson(value)}`;
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(material))));
}

async function verifyHmac(key: CryptoKey, domain: string, value: unknown, signature: string): Promise<boolean> {
  return await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signature),
    encoder.encode(`${domain}\n${canonicalJson(value)}`),
  );
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true, mode: 0o700 });
  const info = await Deno.lstat(path);
  if (!info.isDirectory || info.isSymlink) throw new Error("confirmation store path must be a real directory");
  await Deno.chmod(path, 0o700);
}

async function ensurePrivateFile(path: string): Promise<void> {
  try {
    const info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink) throw new Error("confirmation store file must be a regular file");
    await Deno.chmod(path, 0o600);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    try {
      const file = await Deno.open(path, { createNew: true, read: true, write: true, mode: 0o600 });
      file.close();
    } catch (createError) {
      if (!(createError instanceof Deno.errors.AlreadyExists)) throw createError;
      const raced = await Deno.lstat(path);
      if (!raced.isFile || raced.isSymlink) throw new Error("confirmation store file must be a regular file");
    }
    await Deno.chmod(path, 0o600);
  }
}

async function atomicPrivateWrite(path: string, body: string): Promise<void> {
  const parent = path.slice(0, path.lastIndexOf("/"));
  await ensurePrivateDirectory(parent);
  const temporary = `${path}.tmp.${crypto.randomUUID().replaceAll("-", "")}`;
  const file = await Deno.open(temporary, { createNew: true, write: true, mode: 0o600 });
  try {
    await file.write(encoder.encode(body));
    await file.sync();
  } finally {
    file.close();
  }
  await Deno.chmod(temporary, 0o600);
  await Deno.rename(temporary, path);
  await Deno.chmod(path, 0o600);
}

function challengeUnsigned(challenge: ConfirmationChallenge): Omit<ConfirmationChallenge, "integrity_hmac"> {
  const { integrity_hmac: _integrityHmac, ...unsigned } = challenge;
  return unsigned;
}

function attestationUnsigned(
  attestation: ConfirmationAttestation,
): Omit<ConfirmationAttestation, "integrity_hmac"> {
  const { integrity_hmac: _integrityHmac, ...unsigned } = attestation;
  return unsigned;
}

function eventUnsigned(event: TrustedInboundEvent): Omit<TrustedInboundEvent, "integrity_hmac"> {
  const { integrity_hmac: _integrityHmac, ...unsigned } = event;
  return unsigned;
}

function ledgerUnsigned(ledger: StoredLedger): LedgerBody {
  const { integrity_hmac: _integrityHmac, ...unsigned } = ledger;
  return unsigned;
}

/**
 * Trusted ingress boundary. Keep this signer outside the Motor V2 process;
 * ConfirmationAuthority imports the corresponding key as verify-only.
 */
export class TrustedIngressSigner {
  readonly #key: CryptoKey;

  private constructor(
    readonly keyVersion: string,
    key: CryptoKey,
  ) {
    this.#key = key;
  }

  static async create(options: { secret: Uint8Array; key_version: string }): Promise<TrustedIngressSigner> {
    assertExactKeys(options, ["key_version", "secret"], "trusted ingress signer options");
    assertKeyVersion(options.key_version);
    return new TrustedIngressSigner(options.key_version, await importIngressSigningKey(options.secret));
  }

  async signInboundEvent(input: TrustedInboundEventInput, transientText: string): Promise<TrustedInboundEvent> {
    validateEventInput(input);
    if (typeof transientText !== "string") throw new Error("transient confirmation text must be a string");
    const unsigned: Omit<TrustedInboundEvent, "integrity_hmac"> = {
      schema_version: TRUSTED_EVENT_SCHEMA,
      ...structuredClone(input),
      content_hash: await sha256(transientText),
      key_version: this.keyVersion,
    };
    return {
      ...unsigned,
      integrity_hmac: await hmac(this.#key, "PHASE18B_TRUSTED_EVENT_V1", unsigned),
    };
  }
}

export class ConfirmationAuthority {
  readonly #ledgerPath: string;
  readonly #lockPath: string;
  readonly #key: CryptoKey;
  readonly #ingressVerificationKey: CryptoKey;

  private constructor(
    readonly root: string,
    readonly keyVersion: string,
    key: CryptoKey,
    ingressVerificationKey: CryptoKey,
  ) {
    this.#key = key;
    this.#ingressVerificationKey = ingressVerificationKey;
    this.#ledgerPath = `${root}/ledger.json`;
    this.#lockPath = `${root}/ledger.lock`;
  }

  static async open(options: {
    root: string;
    state_secret: Uint8Array;
    ingress_verification_secret: Uint8Array;
    key_version: string;
  }): Promise<ConfirmationAuthority> {
    assertExactKeys(
      options,
      ["ingress_verification_secret", "key_version", "root", "state_secret"],
      "confirmation authority options",
    );
    if (typeof options.root !== "string" || options.root.length < 1) throw new Error("invalid confirmation store root");
    assertKeyVersion(options.key_version);
    assertSecret(options.state_secret);
    assertSecret(options.ingress_verification_secret);
    if (equalBytes(options.state_secret, options.ingress_verification_secret)) {
      throw new Error("state and trusted-ingress HMAC secrets must be distinct");
    }
    const key = await importStateHmacKey(options.state_secret);
    const ingressVerificationKey = await importIngressVerificationKey(options.ingress_verification_secret);
    await ensurePrivateDirectory(options.root);
    const authority = new ConfirmationAuthority(options.root, options.key_version, key, ingressVerificationKey);
    await ensurePrivateFile(authority.#lockPath);
    await authority.#withLock(async () => {
      try {
        const info = await Deno.lstat(authority.#ledgerPath);
        if (!info.isFile || info.isSymlink) throw new Error("confirmation ledger must be a regular file");
        await Deno.chmod(authority.#ledgerPath, 0o600);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        await authority.#writeLedger({
          schema_version: CONFIRMATION_LEDGER_SCHEMA,
          key_version: options.key_version,
          challenges: {},
          attestations: {},
          event_bindings: {},
        });
      }
      await authority.#readLedger();
    });
    return authority;
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const file = await Deno.open(this.#lockPath, { read: true, write: true });
    await file.lock(true);
    try {
      return await operation();
    } finally {
      await file.unlock();
      file.close();
    }
  }

  async #writeLedger(body: LedgerBody): Promise<void> {
    const ledger: StoredLedger = {
      ...body,
      integrity_hmac: await hmac(this.#key, "PHASE18B_LEDGER_V1", body),
    };
    await atomicPrivateWrite(this.#ledgerPath, canonicalJson(ledger) + "\n");
  }

  async #readLedger(): Promise<StoredLedger> {
    const parsed = JSON.parse(await Deno.readTextFile(this.#ledgerPath)) as unknown;
    assertExactKeys(
      parsed,
      ["attestations", "challenges", "event_bindings", "integrity_hmac", "key_version", "schema_version"],
      "confirmation ledger",
    );
    const ledger = parsed as unknown as StoredLedger;
    if (ledger.schema_version !== CONFIRMATION_LEDGER_SCHEMA || ledger.key_version !== this.keyVersion) {
      throw new Error("confirmation ledger identity mismatch");
    }
    assertHash(ledger.integrity_hmac, "ledger integrity hmac");
    if (!await verifyHmac(this.#key, "PHASE18B_LEDGER_V1", ledgerUnsigned(ledger), ledger.integrity_hmac)) {
      throw new Error("confirmation ledger integrity mismatch");
    }
    for (const [confirmationId, challenge] of Object.entries(ledger.challenges)) {
      if (confirmationId !== challenge.confirmation_id) throw new Error("challenge ledger key mismatch");
      assertHash(challenge.integrity_hmac, "challenge integrity hmac");
      if (
        !await verifyHmac(this.#key, "PHASE18B_CHALLENGE_V1", challengeUnsigned(challenge), challenge.integrity_hmac)
      ) {
        throw new Error("confirmation challenge integrity mismatch");
      }
    }
    for (const [attestationId, attestation] of Object.entries(ledger.attestations)) {
      if (attestationId !== attestation.attestation_id) throw new Error("attestation ledger key mismatch");
      assertHash(attestation.integrity_hmac, "attestation integrity hmac");
      if (
        !await verifyHmac(
          this.#key,
          "PHASE18B_ATTESTATION_V1",
          attestationUnsigned(attestation),
          attestation.integrity_hmac,
        )
      ) {
        throw new Error("confirmation attestation integrity mismatch");
      }
    }
    return ledger;
  }

  async issueChallenge(input: IssueChallengeInput): Promise<{ duplicate: boolean; challenge: ConfirmationChallenge }> {
    validateIssueInput(input);
    return await this.#withLock(async () => {
      const ledger = await this.#readLedger();
      const proposalHash = await sha256(canonicalJson({
        action: input.action,
        conversation_ref: input.conversation_ref,
        sanitized_input_hash: input.sanitized_input_hash,
        proposal_version: input.proposal_version,
      }));
      const unsigned: Omit<ConfirmationChallenge, "integrity_hmac"> = {
        schema_version: CONFIRMATION_CHALLENGE_SCHEMA,
        state: "CONTEXTUAL",
        ...structuredClone(input),
        proposal_hash: proposalHash,
        key_version: this.keyVersion,
        effect_permitted: false,
        execution_receipt: null,
      };
      const challenge: ConfirmationChallenge = {
        ...unsigned,
        integrity_hmac: await hmac(this.#key, "PHASE18B_CHALLENGE_V1", unsigned),
      };
      const existing = ledger.challenges[input.confirmation_id];
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(challenge)) {
          throw new Error("confirmation id reused with different proposal");
        }
        return { duplicate: true, challenge: structuredClone(existing) };
      }
      const nonceOwner = Object.values(ledger.challenges).find((candidate) => candidate.nonce === input.nonce);
      if (nonceOwner) throw new Error("confirmation nonce already used");
      ledger.challenges[input.confirmation_id] = challenge;
      await this.#writeLedger(ledgerUnsigned(ledger));
      return { duplicate: false, challenge: structuredClone(challenge) };
    });
  }

  unsignedInboundEvent(input: TrustedInboundEventInput, contentHash: string): TrustedInboundEvent {
    validateEventInput(input);
    assertHash(contentHash, "content hash");
    return {
      schema_version: TRUSTED_EVENT_SCHEMA,
      ...structuredClone(input),
      content_hash: contentHash,
      key_version: this.keyVersion,
      integrity_hmac: null,
    };
  }

  async evaluateConfirmation(input: {
    confirmation_id: string;
    event: TrustedInboundEvent;
    transient_text: string;
  }): Promise<ConfirmationEvaluation> {
    assertExactKeys(input, EVALUATION_KEYS, "confirmation evaluation input");
    assertPseudonymousRef(input.confirmation_id, "confirmation", "confirmation id");
    validateEvent(input.event);
    if (typeof input.transient_text !== "string") throw new Error("transient confirmation text must be a string");
    const contentHash = await sha256(input.transient_text);
    if (contentHash !== input.event.content_hash) throw new Error("trusted event content hash mismatch");
    if (input.event.key_version !== this.keyVersion) throw new Error("trusted event key version mismatch");
    if (
      input.event.integrity_hmac !== null &&
      !await verifyHmac(
        this.#ingressVerificationKey,
        "PHASE18B_TRUSTED_EVENT_V1",
        eventUnsigned(input.event),
        input.event.integrity_hmac,
      )
    ) {
      throw new Error("trusted event integrity mismatch");
    }

    return await this.#withLock(async () => {
      const ledger = await this.#readLedger();
      const challenge = ledger.challenges[input.confirmation_id];
      if (!AFFIRMATIVE.has(normalizeConfirmationText(input.transient_text))) {
        return common("NOT_AFFIRMATIVE");
      }
      if (!challenge) return common("NO_ACTIVE_CONTEXT");
      if (
        input.event.conversation_ref !== challenge.conversation_ref ||
        input.event.actor_ref !== challenge.actor_ref ||
        input.event.channel !== challenge.channel ||
        input.event.reply_to_event_id !== challenge.prompt_event_id
      ) {
        return common("OUT_OF_CONTEXT");
      }
      if (input.event.integrity_hmac === null) return contextual(challenge.confirmation_id, "UNAUTHENTICATED_EVENT");

      const receivedAt = Date.parse(input.event.received_at);
      if (receivedAt < Date.parse(challenge.issued_at)) {
        return contextual(challenge.confirmation_id, "NOT_YET_ACTIVE");
      }
      if (receivedAt > Date.parse(challenge.expires_at)) return contextual(challenge.confirmation_id, "EXPIRED");

      const existingAttestation = Object.values(ledger.attestations).find(
        (candidate) => candidate.confirmation_id === challenge.confirmation_id,
      );
      if (existingAttestation) {
        if (
          existingAttestation.confirming_event_id !== input.event.event_id ||
          existingAttestation.confirming_content_hash !== input.event.content_hash
        ) {
          throw new Error("confirmation already consumed by another event");
        }
        return authenticated(existingAttestation, true);
      }

      const eventBinding = ledger.event_bindings[input.event.event_id];
      if (
        eventBinding &&
        (eventBinding.content_hash !== input.event.content_hash ||
          eventBinding.confirmation_id !== challenge.confirmation_id)
      ) {
        throw new Error("trusted event id reused with different confirmation content");
      }

      const identityMaterial = {
        confirmation_id: challenge.confirmation_id,
        conversation_ref: challenge.conversation_ref,
        actor_ref: challenge.actor_ref,
        channel: challenge.channel,
        action: challenge.action,
        sanitized_input_hash: challenge.sanitized_input_hash,
        proposal_version: challenge.proposal_version,
        proposal_hash: challenge.proposal_hash,
        prompt_event_id: challenge.prompt_event_id,
        confirming_event_id: input.event.event_id,
        confirming_content_hash: input.event.content_hash,
        confirmed_at: input.event.received_at,
        nonce: challenge.nonce,
      };
      const identityHash = await sha256(canonicalJson(identityMaterial));
      const unsigned: Omit<ConfirmationAttestation, "integrity_hmac"> = {
        schema_version: CONFIRMATION_ATTESTATION_SCHEMA,
        state: "AUTHENTICATED",
        attestation_id: `attestation_${identityHash.slice(0, 32)}`,
        ...identityMaterial,
        idempotency_key: `confirm_${identityHash}`,
        key_version: this.keyVersion,
        effect_permitted: false,
        execution_receipt: null,
      };
      const attestation: ConfirmationAttestation = {
        ...unsigned,
        integrity_hmac: await hmac(this.#key, "PHASE18B_ATTESTATION_V1", unsigned),
      };
      ledger.attestations[attestation.attestation_id] = attestation;
      ledger.event_bindings[input.event.event_id] = {
        content_hash: input.event.content_hash,
        confirmation_id: challenge.confirmation_id,
        attestation_id: attestation.attestation_id,
      };
      await this.#writeLedger(ledgerUnsigned(ledger));
      return authenticated(attestation, false);
    });
  }

  async authorizeWouldCall(input: AuthorizeWouldCallInput): Promise<ShadowActionAuthorization> {
    validateAuthorizationInput(input);
    return await this.#withLock(async () => {
      const ledger = await this.#readLedger();
      const challenge = ledger.challenges[input.confirmation_id];
      const attestation = ledger.attestations[input.attestation_id];
      if (!challenge || !attestation || attestation.confirmation_id !== input.confirmation_id) {
        throw new Error("authenticated confirmation attestation is required");
      }
      if (
        input.conversation_ref !== challenge.conversation_ref ||
        input.conversation_ref !== attestation.conversation_ref ||
        input.actor_ref !== challenge.actor_ref || input.actor_ref !== attestation.actor_ref ||
        input.channel !== challenge.channel || input.channel !== attestation.channel ||
        input.action !== challenge.action || input.action !== attestation.action ||
        input.sanitized_input_hash !== challenge.sanitized_input_hash ||
        input.sanitized_input_hash !== attestation.sanitized_input_hash ||
        input.proposal_version !== challenge.proposal_version ||
        input.proposal_version !== attestation.proposal_version ||
        input.proposal_hash !== challenge.proposal_hash ||
        input.proposal_hash !== attestation.proposal_hash
      ) {
        throw new Error("confirmation attestation does not match proposed action version");
      }
      return {
        schema_version: SHADOW_AUTHORIZATION_SCHEMA,
        state: "AUTHENTICATED",
        authorized: true,
        effect_permitted: false,
        would_call: true,
        confirmation_id: challenge.confirmation_id,
        attestation_id: attestation.attestation_id,
        conversation_ref: challenge.conversation_ref,
        actor_ref: challenge.actor_ref,
        channel: challenge.channel,
        action: challenge.action,
        proposal_hash: challenge.proposal_hash,
        idempotency_key: attestation.idempotency_key,
        execution_receipt: null,
      };
    });
  }

  async getAttestation(attestationId: string): Promise<ConfirmationAttestation | null> {
    assertPseudonymousRef(attestationId, "attestation", "attestation id");
    return await this.#withLock(async () => {
      const ledger = await this.#readLedger();
      return structuredClone(ledger.attestations[attestationId] ?? null);
    });
  }
}

function common(reason: CommonConfirmationResult["reason"]): CommonConfirmationResult {
  return { state: "COMMON", authenticated: false, effect_permitted: false, execution_receipt: null, reason };
}

function contextual(
  confirmationId: string,
  reason: ContextualConfirmationResult["reason"],
): ContextualConfirmationResult {
  return {
    state: "CONTEXTUAL",
    authenticated: false,
    effect_permitted: false,
    execution_receipt: null,
    confirmation_id: confirmationId,
    reason,
  };
}

function authenticated(
  attestation: ConfirmationAttestation,
  duplicate: boolean,
): AuthenticatedConfirmationResult {
  return {
    state: "AUTHENTICATED",
    authenticated: true,
    effect_permitted: false,
    execution_receipt: null,
    duplicate,
    attestation: structuredClone(attestation),
  };
}
