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

export async function processOfficialOperator(
  payload: Record<string, unknown>,
  request: Request,
  rest: OfficialSupabaseRest,
  canaryPhone: string,
) {
  const access = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const actor = await rest.authenticatedUser(access);
  let command;
  try {
    command = payload.kind === "OPERATOR_COMMAND" ? parseOperatorCommand(payload.command) : null;
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
  const allowed = runtimeCanaryAllowsAutomaticReply(snapshot.phone_e164, canaryPhone);
  if (!command) {
    return {
      revision: snapshot.revision,
      automation_mode: snapshot.automation_mode,
      control_version: snapshot.control_version,
      commands_enabled: allowed,
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
  if (!allowed) throw new HttpProblem(403, "CANARY_PHONE_BLOCKED", "Only the authorized canary can receive commands");
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
  const reply = projection.automation_mode === "bot" ? operatorReply(next, command) : null;
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
