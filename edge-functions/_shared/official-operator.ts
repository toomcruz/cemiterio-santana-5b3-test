import {
  actionOptions,
  applyOperatorCommand,
  goalLabel,
  operatorReply,
  parseOperatorCommand,
  withOperationalRequests,
} from "../../santana-conversation-domain/runtime/official_operations.ts";
import { asStoredState, panelProjection } from "../../santana-conversation-domain/runtime/official_turn_service.ts";
import {
  canonicalJson,
  currentCatalogHash,
  sha256,
} from "../../santana-conversation-domain/runtime/server_transition.ts";
import { validateState } from "../../santana-conversation-domain/engine/validate.ts";
import { HttpProblem } from "./http.ts";
import { runtimeCanaryAllowsAutomaticReply } from "./official-runtime-canary.ts";
import { OfficialSupabaseRest } from "./official-rest.ts";

interface Snapshot {
  state: unknown;
  revision: number;
  catalog_hash: string;
  automation_mode: string;
  control_version: string;
  phone_e164: string;
  requests: unknown[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * The panel's authenticated server route intentionally sends RESUME metadata at
 * the envelope root and only `{ type: "RESUME" }` in `command`. Reconstruct the
 * domain command here and create the audit note server-side. Older full nested
 * commands remain supported for administrative decisions.
 */
function commandFromPayload(payload: Record<string, unknown>) {
  if (payload.kind !== "OPERATOR_COMMAND") return null;
  const nested = record(payload.command);
  if (nested.type !== "RESUME" || payload.command_id === undefined) {
    return parseOperatorCommand(payload.command);
  }
  const allowedRoot = new Set([
    "kind",
    "conversation_id",
    "command_id",
    "expected_revision",
    "expected_control_version",
    "command",
  ]);
  if (Object.keys(payload).some((key) => !allowedRoot.has(key))) throw new Error("INVALID_COMMAND");
  if (Object.keys(nested).some((key) => key !== "type")) throw new Error("INVALID_COMMAND");
  return parseOperatorCommand({
    type: "RESUME",
    conversation_id: payload.conversation_id,
    command_id: payload.command_id,
    expected_revision: payload.expected_revision,
    expected_control_version: payload.expected_control_version,
    note: "Retomada automática solicitada pelo painel.",
  });
}

export async function processOfficialOperator(
  payload: Record<string, unknown>,
  request: Request,
  rest: OfficialSupabaseRest,
  canaryHash: string | undefined,
) {
  const access = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const actor = await rest.authenticatedUser(access);
  let command;
  try {
    command = commandFromPayload(payload);
  } catch {
    throw new HttpProblem(400, "INVALID_OPERATOR_COMMAND", "Invalid operator command");
  }
  const conversationId = command?.conversation_id ?? payload.conversation_id;
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    throw new HttpProblem(400, "INVALID_CONVERSATION", "Invalid conversation");
  }
  const snapshot = await rest.rpc<Snapshot>("support_runtime_operator_snapshot", {
    p_conversation_id: conversationId,
    p_actor_id: actor,
  });
  if (!snapshot || !Number.isSafeInteger(snapshot.revision)) {
    throw new HttpProblem(404, "RUNTIME_NOT_FOUND", "Official attendance not found");
  }
  const state = asStoredState(snapshot.state, conversationId);
  const canaryAllowed = await runtimeCanaryAllowsAutomaticReply(snapshot.phone_e164, canaryHash);
  if (!command) {
    return {
      revision: snapshot.revision,
      automation_mode: snapshot.automation_mode,
      control_version: snapshot.control_version,
      // Manual BOT/HUMAN control belongs to the authenticated operator. The
      // canary only selects Motor V2; it is not an authorization mechanism for
      // the operator control switch.
      commands_enabled: true,
      goals: state.goals.map((goal) => ({
        goal_id: goal.goal_id,
        goal_code: goal.goal_code,
        case_id: goal.case_id,
        status: goal.status,
        label: goalLabel(goal),
      })),
      pending_actions: actionOptions(state),
      documents: (state.documentos ?? []).map((document) => ({
        document_id: document.documento_id,
        case_id: document.case_id,
        tipo: document.tipo,
        estado: document.estado,
      })),
      requests: snapshot.requests ?? [],
    };
  }
  // Keep the Phase-19 canary restriction on administrative decision commands,
  // but never use it to block the operator's explicit RESUME control.
  if (!canaryAllowed && command.type !== "RESUME") {
    throw new HttpProblem(403, "CANARY_PHONE_BLOCKED", "Only the authorized canary can receive this command");
  }
  const catalogHash = await currentCatalogHash();
  if (snapshot.catalog_hash !== catalogHash) {
    throw new HttpProblem(409, "CATALOG_UPGRADE_REQUIRED", "A controlled catalog upgrade is required");
  }
  // The store owns idempotency. A replay may have an old expected revision, so
  // consult its receipt before re-applying the domain decision.
  const replay = await rest.rpc<Record<string, unknown>>("support_runtime_operator_replay", {
    p_conversation_id: conversationId,
    p_actor_id: actor,
    p_command_id: command.command_id,
    p_command: command,
  });
  if (replay?.replayed === true) return { ...replay, accepted: true, phone_e164: snapshot.phone_e164 };
  if (snapshot.revision !== command.expected_revision) {
    throw new HttpProblem(409, "RUNTIME_REVISION_CONFLICT", "Reload the attendance before retrying");
  }
  if (
    command.type === "RESUME" &&
    Date.parse(snapshot.control_version) !== Date.parse(command.expected_control_version ?? "")
  ) throw new HttpProblem(409, "RUNTIME_CONTROL_CONFLICT", "Reload the attendance after the latest control change");
  let next;
  try {
    next = await withOperationalRequests(applyOperatorCommand(state, command, new Date().toISOString()));
  } catch {
    throw new HttpProblem(400, "OPERATOR_DECISION_REJECTED", "The decision does not apply to this pending action");
  }
  const errors = validateState(next);
  if (errors.length) throw new Error("invalid operator transition");
  const projection = panelProjection(next);
  if (command.type !== "RESUME" && snapshot.automation_mode !== "bot") projection.automation_mode = "human";
  if (command.type === "RESUME") projection.automation_mode = "bot";
  // Toggling the control is silent. It must not send an unsolicited WhatsApp
  // message simply because an operator chose to reactivate the robot.
  const reply = command.type === "RESUME"
    ? null
    : projection.automation_mode === "bot"
    ? operatorReply(next, command)
    : null;
  const committed = await rest.rpc<Record<string, unknown>>("support_runtime_commit_operator", {
    p_conversation_id: conversationId,
    p_actor_id: actor,
    p_command_id: command.command_id,
    p_expected_revision: command.expected_revision,
    p_catalog_hash: catalogHash,
    p_state_hash: await sha256(canonicalJson(next)),
    p_state: next,
    p_command: command,
    p_reply_body: reply,
    p_projection: projection,
  });
  return { ...committed, accepted: true, phone_e164: snapshot.phone_e164 };
}
