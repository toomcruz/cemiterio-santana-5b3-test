import { assert, assertEquals, assertRejects } from "../../tests/fixtures/assert.ts";
import {
  ConfirmationAuthority,
  type IssueChallengeInput,
  type TrustedInboundEventInput,
  TrustedIngressSigner,
} from "../confirmation/authority.ts";

const encoder = new TextEncoder();
const STATE_SECRET = encoder.encode("phase18b-lab-only-state-key-material-v1-0001");
const INGRESS_SECRET = encoder.encode("phase18b-lab-only-ingress-key-material-v1-01");
const KEY_VERSION = "lab_key_v1";
const INPUT_HASH = "a".repeat(64);
const CONFIRMATION_ID = `confirmation_${"a".repeat(32)}`;
const CONVERSATION_REF = `conversation_${"b".repeat(32)}`;
const ACTOR_REF = `actor_${"c".repeat(32)}`;
const PROMPT_EVENT_ID = `prompt_${"d".repeat(32)}`;
const EVENT_ID = `event_${"e".repeat(32)}`;
const NONCE = `nonce_${"f".repeat(32)}`;

function challengeInput(overrides: Partial<IssueChallengeInput> = {}): IssueChallengeInput {
  return {
    confirmation_id: CONFIRMATION_ID,
    conversation_ref: CONVERSATION_REF,
    actor_ref: ACTOR_REF,
    channel: "WHATSAPP",
    action: "request.create",
    sanitized_input_hash: INPUT_HASH,
    proposal_version: 3,
    prompt_event_id: PROMPT_EVENT_ID,
    nonce: NONCE,
    issued_at: "2026-09-13T12:00:00Z",
    expires_at: "2026-09-13T12:10:00Z",
    ...overrides,
  };
}

function eventInput(overrides: Partial<TrustedInboundEventInput> = {}): TrustedInboundEventInput {
  return {
    event_id: EVENT_ID,
    conversation_ref: CONVERSATION_REF,
    actor_ref: ACTOR_REF,
    channel: "WHATSAPP",
    reply_to_event_id: PROMPT_EVENT_ID,
    received_at: "2026-09-13T12:01:00Z",
    ...overrides,
  };
}

async function withAuthority(
  operation: (
    authority: ConfirmationAuthority,
    signer: TrustedIngressSigner,
    root: string,
  ) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "phase18b-confirmation-test-" });
  try {
    const signer = await TrustedIngressSigner.create({ secret: INGRESS_SECRET, key_version: KEY_VERSION });
    const authority = await ConfirmationAuthority.open({
      root,
      state_secret: STATE_SECRET,
      ingress_verification_secret: INGRESS_SECRET,
      key_version: KEY_VERSION,
    });
    await operation(authority, signer, root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("out-of-context SIM is common conversation and cannot authorize", async () => {
  await withAuthority(async (authority, signer) => {
    const event = await signer.signInboundEvent(
      eventInput({ reply_to_event_id: null }),
      "SIM",
    );
    const result = await authority.evaluateConfirmation({
      confirmation_id: `confirmation_${"1".repeat(32)}`,
      event,
      transient_text: "SIM",
    });
    assertEquals(result.state, "COMMON");
    assertEquals(result.effect_permitted, false);
    assertEquals(result.execution_receipt, null);
  });
});

Deno.test("matching context without trusted transport is contextual, not authenticated", async () => {
  await withAuthority(async (authority, signer) => {
    assertEquals("signInboundEvent" in authority, false);
    const { challenge } = await authority.issueChallenge(challengeInput());
    const trusted = await signer.signInboundEvent(eventInput(), "sim");
    const event = authority.unsignedInboundEvent(eventInput(), trusted.content_hash);
    const result = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "sim",
    });
    assertEquals(result.state, "CONTEXTUAL");
    assertEquals(result.authenticated, false);
    assertEquals(result.effect_permitted, false);
  });
});

Deno.test("authenticated confirmation binds actor, channel, proposal, prompt, time and nonce", async () => {
  await withAuthority(async (authority, signer, root) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "Confirmo");
    const result = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "Confirmo",
    });
    assertEquals(result.state, "AUTHENTICATED");
    if (result.state !== "AUTHENTICATED") throw new Error("expected authenticated confirmation");
    assertEquals(result.duplicate, false);
    assertEquals(result.attestation.conversation_ref, challenge.conversation_ref);
    assertEquals(result.attestation.actor_ref, challenge.actor_ref);
    assertEquals(result.attestation.channel, challenge.channel);
    assertEquals(result.attestation.proposal_version, challenge.proposal_version);
    assertEquals(result.attestation.proposal_hash, challenge.proposal_hash);
    assertEquals(result.attestation.prompt_event_id, challenge.prompt_event_id);
    assertEquals(result.attestation.confirming_event_id, event.event_id);
    assertEquals(result.attestation.confirmed_at, event.received_at);
    assertEquals(result.attestation.nonce, challenge.nonce);
    assertEquals(result.attestation.effect_permitted, false);
    assertEquals(result.attestation.execution_receipt, null);

    const ledgerText = await Deno.readTextFile(`${root}/ledger.json`);
    assert(!ledgerText.includes("Confirmo"), "transient confirmation text must not be persisted");
    assert(!ledgerText.includes("execution_payload"), "operational payload must not be persisted");
  });
});

Deno.test("legacy boolean cannot replace an authenticated attestation", async () => {
  await withAuthority(async (authority) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    await assertRejects(
      () =>
        authority.authorizeWouldCall({
          confirmation_id: challenge.confirmation_id,
          attestation_id: `attestation_${"0".repeat(32)}`,
          conversation_ref: challenge.conversation_ref,
          actor_ref: challenge.actor_ref,
          channel: challenge.channel,
          action: challenge.action,
          sanitized_input_hash: challenge.sanitized_input_hash,
          proposal_version: challenge.proposal_version,
          proposal_hash: challenge.proposal_hash,
          explicit_confirmation: true,
        } as never),
      /missing or unsupported fields/,
    );
    await assertRejects(
      () =>
        authority.authorizeWouldCall({
          confirmation_id: challenge.confirmation_id,
          attestation_id: `attestation_${"0".repeat(32)}`,
          conversation_ref: challenge.conversation_ref,
          actor_ref: challenge.actor_ref,
          channel: challenge.channel,
          action: challenge.action,
          sanitized_input_hash: challenge.sanitized_input_hash,
          proposal_version: challenge.proposal_version,
          proposal_hash: challenge.proposal_hash,
        }),
      /authenticated confirmation attestation is required/,
    );
  });
});

Deno.test("authenticated shadow authorization remains would_call with no receipt or effect", async () => {
  await withAuthority(async (authority, signer) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "sim");
    const confirmation = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "sim",
    });
    if (confirmation.state !== "AUTHENTICATED") throw new Error("expected authenticated confirmation");
    const authorization = await authority.authorizeWouldCall({
      confirmation_id: challenge.confirmation_id,
      attestation_id: confirmation.attestation.attestation_id,
      conversation_ref: challenge.conversation_ref,
      actor_ref: challenge.actor_ref,
      channel: challenge.channel,
      action: challenge.action,
      sanitized_input_hash: challenge.sanitized_input_hash,
      proposal_version: challenge.proposal_version,
      proposal_hash: challenge.proposal_hash,
    });
    assertEquals(authorization.state, "AUTHENTICATED");
    assertEquals(authorization.authorized, true);
    assertEquals(authorization.would_call, true);
    assertEquals(authorization.effect_permitted, false);
    assertEquals(authorization.execution_receipt, null);
  });
});

Deno.test("identity, channel and prompt mismatches stay out of confirmation context", async () => {
  await withAuthority(async (authority, signer) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    for (
      const mismatch of [
        { actor_ref: `actor_${"a".repeat(32)}` },
        { channel: "WEBCHAT" },
        { conversation_ref: `conversation_${"a".repeat(32)}` },
        { reply_to_event_id: `prompt_${"a".repeat(32)}` },
      ]
    ) {
      const input = eventInput({ event_id: `event_${crypto.randomUUID().replaceAll("-", "")}`, ...mismatch });
      const event = await signer.signInboundEvent(input, "sim");
      const result = await authority.evaluateConfirmation({
        confirmation_id: challenge.confirmation_id,
        event,
        transient_text: "sim",
      });
      assertEquals(result.state, "COMMON");
    }
  });
});

Deno.test("proposal changes cannot reuse a confirmation attestation", async () => {
  await withAuthority(async (authority, signer) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "sim");
    const confirmation = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "sim",
    });
    if (confirmation.state !== "AUTHENTICATED") throw new Error("expected authenticated confirmation");
    const valid = {
      confirmation_id: challenge.confirmation_id,
      attestation_id: confirmation.attestation.attestation_id,
      conversation_ref: challenge.conversation_ref,
      actor_ref: challenge.actor_ref,
      channel: challenge.channel,
      action: challenge.action,
      sanitized_input_hash: challenge.sanitized_input_hash,
      proposal_version: challenge.proposal_version,
      proposal_hash: challenge.proposal_hash,
    };
    for (
      const changed of [
        { ...valid, proposal_version: valid.proposal_version + 1 },
        { ...valid, action: "request.update" },
        { ...valid, sanitized_input_hash: "b".repeat(64) },
        { ...valid, proposal_hash: "c".repeat(64) },
        { ...valid, actor_ref: `actor_${"a".repeat(32)}` },
        { ...valid, conversation_ref: `conversation_${"a".repeat(32)}` },
        { ...valid, channel: "WEBCHAT" },
      ]
    ) {
      await assertRejects(
        () => authority.authorizeWouldCall(changed),
        /does not match proposed action version/,
      );
    }
  });
});

Deno.test("challenge issuance is idempotent and a nonce cannot bind two proposals", async () => {
  await withAuthority(async (authority) => {
    const first = await authority.issueChallenge(challengeInput());
    const replay = await authority.issueChallenge(challengeInput());
    assertEquals(first.duplicate, false);
    assertEquals(replay.duplicate, true);
    assertEquals(replay.challenge.proposal_hash, first.challenge.proposal_hash);
    await assertRejects(
      () =>
        authority.issueChallenge(challengeInput({
          confirmation_id: `confirmation_${"2".repeat(32)}`,
          prompt_event_id: `prompt_${"2".repeat(32)}`,
        })),
      /nonce already used/,
    );
  });
});

Deno.test("persisted identity fields require closed pseudonymous digest formats", async () => {
  await withAuthority(async (authority, _signer, root) => {
    for (
      const unsafe of [
        { actor_ref: "actor_full_name" },
        { actor_ref: `actor_${"1".repeat(11)}` },
        { conversation_ref: "conversation_person_example_com" },
        { conversation_ref: `conversation_${"5".repeat(13)}` },
        { actor_ref: "actor_identifier_at_lid" },
      ]
    ) {
      await assertRejects(() => authority.issueChallenge(challengeInput(unsafe)), /invalid (actor|conversation)/);
    }
    const ledgerText = await Deno.readTextFile(`${root}/ledger.json`);
    assert(!ledgerText.includes("full_name"));
    assert(!ledgerText.includes("5".repeat(13)));
    assert(!ledgerText.includes("person_example_com"));
  });
});

Deno.test("concurrent first open initializes one valid ledger under lock", async () => {
  const root = await Deno.makeTempDir({ prefix: "phase18b-confirmation-open-race-" });
  try {
    const options = {
      root,
      state_secret: STATE_SECRET,
      ingress_verification_secret: INGRESS_SECRET,
      key_version: KEY_VERSION,
    };
    const [first, second] = await Promise.all([
      ConfirmationAuthority.open(options),
      ConfirmationAuthority.open(options),
    ]);
    const issued = await first.issueChallenge(challengeInput());
    const replay = await second.issueChallenge(challengeInput());
    assertEquals(issued.duplicate, false);
    assertEquals(replay.duplicate, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("state and trusted-ingress HMAC secrets must be distinct", async () => {
  const root = await Deno.makeTempDir({ prefix: "phase18b-confirmation-key-separation-" });
  try {
    await assertRejects(
      () =>
        ConfirmationAuthority.open({
          root,
          state_secret: STATE_SECRET,
          ingress_verification_secret: STATE_SECRET,
          key_version: KEY_VERSION,
        }),
      /must be distinct/,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("early and expired confirmations never authenticate", async () => {
  await withAuthority(async (authority, signer) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const early = await signer.signInboundEvent(
      eventInput({ event_id: `event_${"1".repeat(32)}`, received_at: "2026-09-13T11:59:59Z" }),
      "sim",
    );
    const expired = await signer.signInboundEvent(
      eventInput({ event_id: `event_${"2".repeat(32)}`, received_at: "2026-09-13T12:10:01Z" }),
      "sim",
    );
    assertEquals(
      (await authority.evaluateConfirmation({
        confirmation_id: challenge.confirmation_id,
        event: early,
        transient_text: "sim",
      })).state,
      "CONTEXTUAL",
    );
    assertEquals(
      (await authority.evaluateConfirmation({
        confirmation_id: challenge.confirmation_id,
        event: expired,
        transient_text: "sim",
      })).state,
      "CONTEXTUAL",
    );
  });
});

Deno.test("tampered transport evidence is rejected", async () => {
  await withAuthority(async (authority, signer) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "sim");
    const tampered = { ...event, received_at: "2026-09-13T12:02:00Z" };
    await assertRejects(
      () =>
        authority.evaluateConfirmation({
          confirmation_id: challenge.confirmation_id,
          event: tampered,
          transient_text: "sim",
        }),
      /trusted event integrity mismatch/,
    );
  });
});

Deno.test("replay is idempotent across restart and altered replay is rejected", async () => {
  await withAuthority(async (authority, signer, root) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "sim");
    const first = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "sim",
    });
    if (first.state !== "AUTHENTICATED") throw new Error("expected authenticated confirmation");

    const restarted = await ConfirmationAuthority.open({
      root,
      state_secret: STATE_SECRET,
      ingress_verification_secret: INGRESS_SECRET,
      key_version: KEY_VERSION,
    });
    const replay = await restarted.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event,
      transient_text: "sim",
    });
    if (replay.state !== "AUTHENTICATED") throw new Error("expected replayed authenticated confirmation");
    assertEquals(replay.duplicate, true);
    assertEquals(replay.attestation.attestation_id, first.attestation.attestation_id);
    assertEquals(
      (await restarted.getAttestation(first.attestation.attestation_id))?.idempotency_key,
      first.attestation.idempotency_key,
    );

    const changed = await signer.signInboundEvent(
      eventInput({ received_at: "2026-09-13T12:02:00Z" }),
      "confirmo",
    );
    await assertRejects(
      () =>
        restarted.evaluateConfirmation({
          confirmation_id: challenge.confirmation_id,
          event: changed,
          transient_text: "confirmo",
        }),
      /confirmation already consumed by another event|event id reused/,
    );
  });
});

Deno.test("concurrent duplicate events create exactly one confirmation attestation", async () => {
  await withAuthority(async (authority, signer, root) => {
    const { challenge } = await authority.issueChallenge(challengeInput());
    const event = await signer.signInboundEvent(eventInput(), "sim");
    const results = await Promise.all([
      authority.evaluateConfirmation({
        confirmation_id: challenge.confirmation_id,
        event,
        transient_text: "sim",
      }),
      authority.evaluateConfirmation({
        confirmation_id: challenge.confirmation_id,
        event,
        transient_text: "sim",
      }),
    ]);
    assertEquals(results.map((result) => result.state), ["AUTHENTICATED", "AUTHENTICATED"]);
    const duplicates = results.map((result) => result.state === "AUTHENTICATED" && result.duplicate).sort();
    assertEquals(duplicates, [false, true]);
    const ledger = JSON.parse(await Deno.readTextFile(`${root}/ledger.json`));
    assertEquals(Object.keys(ledger.attestations).length, 1);
    assertEquals(Object.keys(ledger.event_bindings).length, 1);
  });
});

Deno.test("private persistence permissions and tamper detection are enforced", async () => {
  await withAuthority(async (authority, _signer, root) => {
    await authority.issueChallenge(challengeInput());
    const rootMode = (await Deno.stat(root)).mode! & 0o777;
    const ledgerMode = (await Deno.stat(`${root}/ledger.json`)).mode! & 0o777;
    const lockMode = (await Deno.stat(`${root}/ledger.lock`)).mode! & 0o777;
    assertEquals(rootMode, 0o700);
    assertEquals(ledgerMode, 0o600);
    assertEquals(lockMode, 0o600);

    const ledger = JSON.parse(await Deno.readTextFile(`${root}/ledger.json`));
    ledger.key_version = "lab_key_tampered";
    await Deno.writeTextFile(`${root}/ledger.json`, JSON.stringify(ledger), { mode: 0o600 });
    await assertRejects(
      () =>
        ConfirmationAuthority.open({
          root,
          state_secret: STATE_SECRET,
          ingress_verification_secret: INGRESS_SECRET,
          key_version: KEY_VERSION,
        }),
      /identity mismatch|integrity mismatch/,
    );
  });
});
