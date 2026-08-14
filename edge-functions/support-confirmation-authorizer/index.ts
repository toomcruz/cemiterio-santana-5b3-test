import type { ConfirmationAuthorizationInput, ConfirmationAuthorizationResult } from "../../contracts/confirmation-authorization.ts";
import { assertMethod, assertString, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";

/** Authorizes an immutable classifier record; it never derives a classification itself. */
export async function authorizeConfirmation(input: ConfirmationAuthorizationInput, rest: SupabaseRest): Promise<ConfirmationAuthorizationResult> {
  return await rest.rpc("authorize_persisted_confirmation", {
    p_classification_id: assertString(input.classification_id, "classification_id"),
    p_confirmation_id: assertString(input.confirmation_id, "confirmation_id"),
    p_confirmation_nonce: assertString(input.confirmation_nonce, "confirmation_nonce"),
    p_inbound_message_id: assertString(input.inbound_message_id, "inbound_message_id"),
    p_session_id: assertString(input.session_id, "session_id"),
    p_topic_id: assertString(input.topic_id, "topic_id"),
    p_release_id: assertString(input.release_id, "release_id"),
  });
}

if (import.meta.main) Deno.serve(async (request) => {
  try { assertMethod(request, "POST"); requireInternalShadowAccess(request); requireShadowOnly(); return json(await authorizeConfirmation(await parseJson<ConfirmationAuthorizationInput>(request), new SupabaseRest())); }
  catch (error) { return problem(error); }
});
