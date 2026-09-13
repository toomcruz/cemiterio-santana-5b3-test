/** Build one synthetic LAB attestation without retaining secrets or message text. */
import { canonicalJson } from "../../santana-conversation-domain/motor-v2/canonical_json.ts";
import { ConfirmationAuthority, TrustedIngressSigner } from "./authority.ts";

function secret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(48));
}

async function main(): Promise<void> {
  const output = Deno.args[0];
  if (!output) throw new Error("output path is required");
  const root = await Deno.makeTempDir({ prefix: "phase18b-confirmation-evidence-" });
  try {
    const stateSecret = secret();
    const ingressSecret = secret();
    const signer = await TrustedIngressSigner.create({ secret: ingressSecret, key_version: "lab_key_v1" });
    const authority = await ConfirmationAuthority.open({
      root,
      state_secret: stateSecret,
      ingress_verification_secret: ingressSecret,
      key_version: "lab_key_v1",
    });
    const ordinaryEvent = await signer.signInboundEvent({
      event_id: `event_${"8".repeat(32)}`,
      conversation_ref: `conversation_${"2".repeat(32)}`,
      actor_ref: `actor_${"3".repeat(32)}`,
      channel: "WHATSAPP",
      reply_to_event_id: null,
      received_at: "2026-09-13T11:59:00Z",
    }, "sim");
    const ordinary = await authority.evaluateConfirmation({
      confirmation_id: `confirmation_${"9".repeat(32)}`,
      event: ordinaryEvent,
      transient_text: "sim",
    });
    const { challenge } = await authority.issueChallenge({
      confirmation_id: `confirmation_${"1".repeat(32)}`,
      conversation_ref: `conversation_${"2".repeat(32)}`,
      actor_ref: `actor_${"3".repeat(32)}`,
      channel: "WHATSAPP",
      action: "request.create",
      sanitized_input_hash: "4".repeat(64),
      proposal_version: 7,
      prompt_event_id: `prompt_${"5".repeat(32)}`,
      nonce: `nonce_${"6".repeat(32)}`,
      issued_at: "2026-09-13T12:00:00Z",
      expires_at: "2026-09-13T12:10:00Z",
    });
    const eventInput = {
      event_id: `event_${"7".repeat(32)}`,
      conversation_ref: challenge.conversation_ref,
      actor_ref: challenge.actor_ref,
      channel: challenge.channel,
      reply_to_event_id: challenge.prompt_event_id,
      received_at: "2026-09-13T12:01:00Z",
    };
    const trusted = await signer.signInboundEvent(eventInput, "confirmo");
    const contextual = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event: authority.unsignedInboundEvent(eventInput, trusted.content_hash),
      transient_text: "confirmo",
    });
    const authenticated = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event: trusted,
      transient_text: "confirmo",
    });
    if (authenticated.state !== "AUTHENTICATED") throw new Error("authenticated confirmation was not produced");
    const replay = await authority.evaluateConfirmation({
      confirmation_id: challenge.confirmation_id,
      event: trusted,
      transient_text: "confirmo",
    });
    const authorization = await authority.authorizeWouldCall({
      confirmation_id: challenge.confirmation_id,
      attestation_id: authenticated.attestation.attestation_id,
      conversation_ref: challenge.conversation_ref,
      actor_ref: challenge.actor_ref,
      channel: challenge.channel,
      action: challenge.action,
      sanitized_input_hash: challenge.sanitized_input_hash,
      proposal_version: challenge.proposal_version,
      proposal_hash: challenge.proposal_hash,
    });
    const ledgerMode = (await Deno.stat(`${root}/ledger.json`)).mode! & 0o777;
    const lockMode = (await Deno.stat(`${root}/ledger.lock`)).mode! & 0o777;
    const result = {
      schema_version: "phase18b-confirmation-evidence/1.0.0",
      synthetic_input_only: true,
      secrets_persisted: false,
      message_text_persisted: false,
      trust_boundary: { ingress: "sign_only", motor: "verify_only", keys_distinct: true },
      state_transitions: {
        out_of_context_affirmative: ordinary.state,
        unsigned_matching_event: contextual.state,
        trusted_matching_event: authenticated.state,
        execution_receipt: null,
      },
      attestation: authenticated.attestation,
      replay: {
        state: replay.state,
        duplicate: replay.state === "AUTHENTICATED" && replay.duplicate,
        same_attestation: replay.state === "AUTHENTICATED" &&
          replay.attestation.attestation_id === authenticated.attestation.attestation_id,
      },
      authorization,
      persistence: {
        ledger_mode: ledgerMode.toString(8).padStart(4, "0"),
        lock_mode: lockMode.toString(8).padStart(4, "0"),
      },
      effects: {
        action_executed: false,
        official_state_written: false,
        message_sent: false,
      },
    };
    if (
      ordinary.state !== "COMMON" || contextual.state !== "CONTEXTUAL" || authorization.effect_permitted ||
      authorization.execution_receipt ||
      !result.replay.duplicate || !result.replay.same_attestation || ledgerMode !== 0o600 || lockMode !== 0o600
    ) throw new Error("confirmation evidence invariant failed");
    await Deno.writeTextFile(output, canonicalJson(result) + "\n", { mode: 0o600 });
    await Deno.chmod(output, 0o600);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

if (import.meta.main) await main();
