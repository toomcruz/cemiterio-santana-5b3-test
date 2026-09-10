/** Official operational bridge. No transport, credentials or inferred approvals. */
import {
  activeFact,
  activeFactsForGoalCase,
  applyAuthoritativeSignal,
  applyEvent,
  contextGoal,
  type ConversationState,
  type GoalRecord,
  missingFacts,
} from "../engine/engine.ts";
import { factDef, goalDef, questionsDoc, topicsDoc } from "../engine/catalog.ts";
import { createSolicitacao, type SolicitacaoRecord } from "../engine/solicitacao.ts";
import { transitionDocumento } from "../engine/documento.ts";
import { sha256 } from "./server_transition.ts";

export const OPERATION_TYPES = ["RESOLVE_ACTION", "REVIEW_DOCUMENT", "RESUME"] as const;
export interface OperatorCommand {
  command_id: string;
  conversation_id: string;
  expected_revision: number;
  expected_control_version?: string;
  type: (typeof OPERATION_TYPES)[number];
  goal_id?: string;
  action_code?: string;
  fact_code?: string;
  value?: string;
  document_id?: string;
  document_status?: "ACEITO" | "ILEGÍVEL_INADEQUADO";
  note: string;
}

export function goalLabel(goal: GoalRecord): string {
  const topic = goalDef(goal.goal_code).topic_code;
  return topicsDoc.topics.find((item) => item.topic_code === topic)?.display_name ?? topic;
}

/** Received identity files await the operator, not another upload by the citizen. */
export function documentAwaitingReview(state: ConversationState): boolean {
  const question = state.pending_question;
  if (!question || !["requester_document", "recadastro_holder_document"].includes(question.fact_code)) return false;
  const goal = state.goals.find((item) => item.goal_id === question.goal_id);
  return !!goal &&
    (state.documentos ?? []).some((document) =>
      document.case_id === goal.case_id && document.tipo === question.fact_code && document.estado === "RECEBIDO"
    );
}

export function actionOptions(state: ConversationState) {
  return state.pending_actions.filter((action) => action.executor !== "SYSTEM").flatMap((action) => {
    const goal = state.goals.find((item) => item.goal_id === action.goal_id);
    if (!goal || !["ACTIVE", "WAITING", "SUSPENDED"].includes(goal.status)) return [];
    const facts = missingFacts(state, goal).filter((missing) =>
      questionsDoc.authoritative_resolutions.some((resolution) =>
        resolution.action_code === action.action_code && resolution.fact_code === missing.code
      )
    ).map((missing) => {
      const definition = factDef(missing.code);
      return {
        fact_code: missing.code,
        label: definition.display_name,
        values: definition.allowed_values ?? [],
      };
    });
    return [{ ...action, label: `Verificação: ${goalLabel(goal)}`, facts }];
  });
}

/** Stable UUID for retry-safe linkage; contains no personal data. */
async function requestId(conversationId: string, goalId: string): Promise<string> {
  const hex = await sha256(`santana:request:v1:${conversationId}:${goalId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function requestSummary(state: ConversationState, goal: GoalRecord): string {
  const facts = activeFactsForGoalCase(state, goal).filter((fact) => fact.confidence === "CONFIRMED");
  // Document identifiers stay in structured records, not duplicated in a summary.
  const details = facts.filter((fact) =>
    !fact.fact_code.includes("document") && !fact.fact_code.includes("authorization")
  )
    .map((fact) => `${factDef(fact.fact_code).display_name}: ${String(fact.value)}`).join("; ");
  const pending = state.pending_actions.filter((action) => action.goal_id === goal.goal_id).length;
  return `${goalLabel(goal)}. ${details || "Contexto registrado no atendimento."}${
    pending ? " Aguarda verificação da equipe." : " Solicitação para análise da equipe."
  }`.slice(0, 4000);
}

/** SQL materializes these records atomically in the existing panel request table. */
export async function withOperationalRequests(previous: ConversationState): Promise<ConversationState> {
  const state = structuredClone(previous);
  const requests = state.solicitacoes ?? [];
  const handoffOwner = state.handoff
    ? [...state.goals].filter((goal) =>
      goal.goal_code === state.handoff!.goal_code && goal.case_id === state.handoff!.case_id
    ).sort((a, b) => b.stack_index - a.stack_index)[0]
    : null;
  for (const goal of state.goals) {
    if (goal.informational || goal.status === "ABANDONED") continue;
    const pending = state.pending_actions.filter((action) => action.goal_id === goal.goal_id);
    const routed = !!handoffOwner &&
      (goal.goal_id === handoffOwner.goal_id || goal.overlay_of === handoffOwner.goal_id);
    // Complaint overlays stay in their open triage until the citizen routes it.
    const base = goal.overlay_of ? state.goals.find((item) => item.goal_id === goal.overlay_of) : null;
    const ready = pending.length > 0 || routed || (goal.status === "RESOLVED" && (!base || base.status === "RESOLVED"));
    if (!ready) continue;
    const id = await requestId(state.conversation_id, goal.goal_id);
    const existing = requests.find((item) => item.goal_id === goal.goal_id || item.solicitacao_id === id);
    if (existing) {
      existing.summary = requestSummary(state, goal);
      existing.collected_fact_ids = activeFactsForGoalCase(state, goal).map((fact) => fact.fact_id);
      existing.pending_action_refs = pending.map((action) => action.action_code);
      existing.pending_question_ref = state.pending_question?.goal_id === goal.goal_id
        ? state.pending_question.question_code
        : null;
      continue;
    }
    const complaint = goal.goal_code === "GOAL_RECLAMACAO" && goal.overlay_of !== null;
    const commercial = goal.goal_code === "GOAL_COMERCIAL";
    const category = complaint ? "RECLAMACAO" : commercial ? "VENDA" : "ENCAMINHAMENTO_ADMINISTRACAO";
    const record: SolicitacaoRecord = createSolicitacao({
      solicitacao_id: id,
      case_id: goal.case_id,
      category,
      topic_code: goalDef(goal.goal_code).topic_code,
      overlay_of_goal_id: complaint ? goal.overlay_of : null,
      summary: requestSummary(state, goal),
      reason: `runtime-goal:${goal.goal_id}`,
      collected_fact_ids: activeFactsForGoalCase(state, goal).map((fact) => fact.fact_id),
      pending_question_ref: state.pending_question?.goal_id === goal.goal_id
        ? state.pending_question.question_code
        : null,
      pending_action_refs: pending.map((action) => action.action_code),
      forwarding: { destinatario: commercial ? "Setor Comercial" : "Administração", executor: "HUMAN" },
      estado: complaint ? "OVERLAY_ABERTO" : commercial ? "SOLICITACAO_CONTATO" : "ABERTO",
      opened_at_seq: state.seq,
      confirmed_facts: activeFactsForGoalCase(state, goal).filter((fact) => fact.confidence === "CONFIRMED")
        .map((fact) => ({ code: fact.fact_code, value: String(fact.value) })),
    });
    record.goal_id = goal.goal_id;
    if (record.assunto.fell_back) {
      record.assunto = { label: goalLabel(goal), fell_back: false, rule_id: "OFFICIAL_GOAL_LABEL" };
    }
    requests.push(record);
  }
  state.solicitacoes = requests;
  return state;
}

export function parseOperatorCommand(value: unknown): OperatorCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_COMMAND");
  const raw = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof raw.command_id !== "string" || !uuid.test(raw.command_id) ||
    typeof raw.conversation_id !== "string" || !uuid.test(raw.conversation_id) ||
    !Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0 ||
    !OPERATION_TYPES.includes(raw.type as OperatorCommand["type"]) ||
    typeof raw.note !== "string" || raw.note.trim().length < 3 || raw.note.length > 2000
  ) {
    throw new Error("INVALID_COMMAND");
  }
  const command: OperatorCommand = {
    command_id: raw.command_id,
    conversation_id: raw.conversation_id,
    expected_revision: Number(raw.expected_revision),
    type: raw.type as OperatorCommand["type"],
    note: raw.note.trim(),
  };
  if (raw.expected_control_version !== undefined || command.type === "RESUME") {
    if (
      typeof raw.expected_control_version !== "string" || !Number.isFinite(Date.parse(raw.expected_control_version))
    ) throw new Error("INVALID_CONTROL_VERSION");
    command.expected_control_version = raw.expected_control_version;
  }
  for (const key of ["goal_id", "action_code", "fact_code", "value", "document_id", "document_status"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || !raw[key] || raw[key].length > 256) throw new Error("INVALID_COMMAND");
      Object.assign(command, { [key]: raw[key] });
    }
  }
  return command;
}

export function applyOperatorCommand(
  previous: ConversationState,
  command: OperatorCommand,
  occurredAt: string,
): ConversationState {
  if (previous.conversation_id !== command.conversation_id) throw new Error("COMMAND_CONVERSATION_MISMATCH");
  if (command.type === "RESOLVE_ACTION") {
    const action = actionOptions(previous).find((item) =>
      item.goal_id === command.goal_id && item.action_code === command.action_code
    );
    const fact = action?.facts.find((item) => item.fact_code === command.fact_code);
    if (!fact || typeof command.value !== "string" || !fact.values.includes(command.value)) {
      throw new Error("ACTION_DECISION_NOT_ALLOWED");
    }
    const goal = previous.goals.find((item) => item.goal_id === command.goal_id)!;
    const identity = fact.fact_code === "exhumation_authorization" && command.value.startsWith("OBTIDA_")
      ? ["burial_reference", "requester_document"]
      : fact.fact_code === "destination_grave_authorization" && command.value.startsWith("OBTIDA_")
      ? ["destination_grave_reference", "requester_document"]
      : [];
    if (
      identity.some((code) => {
        const known = activeFact(previous, code, goal);
        return !known || known.confidence !== "CONFIRMED" || known.conflicts_with !== null ||
          typeof known.value !== "string" || known.value.trim().length === 0;
      })
    ) throw new Error("CASE_IDENTITY_REQUIRED_BEFORE_AUTHORIZATION");
    return applyAuthoritativeSignal(previous, {
      goal_id: command.goal_id,
      facts: [{
        code: fact.fact_code,
        value: command.value,
        source: "SYSTEM",
        confidence: "CONFIRMED",
        authoritative: true,
      }],
      note: command.note,
    });
  }
  if (command.type === "REVIEW_DOCUMENT") {
    const state = structuredClone(previous);
    const index = state.documentos?.findIndex((document) => document.documento_id === command.document_id) ?? -1;
    const doc = state.documentos?.[index];
    if (!doc || !["ACEITO", "ILEGÍVEL_INADEQUADO"].includes(command.document_status ?? "")) {
      throw new Error("DOCUMENT_REVIEW_NOT_ALLOWED");
    }
    const classifyAccepted = doc.estado === "ACEITO" && command.document_status === "ACEITO" && !!command.goal_id &&
      !!command.fact_code;
    state.documentos![index] = classifyAccepted
      ? { ...doc }
      : transitionDocumento(doc, command.document_status!, { ocorrido_em: occurredAt, autoridade: "HUMANO" });
    state.seq += 1;
    // Reviewing a file never grants an administrative authorization.
    if (command.fact_code || command.goal_id) {
      const goal = state.goals.find((item) => item.goal_id === command.goal_id);
      if (command.document_status !== "ACEITO") {
        if (command.fact_code || !goal || (doc.case_id !== null && doc.case_id !== goal.case_id)) {
          throw new Error("DOCUMENT_CLASSIFICATION_NOT_ALLOWED");
        }
        return state;
      }
      if (
        !goal ||
        !["ACTIVE", "WAITING", "SUSPENDED"].includes(goal.status) ||
        !["requester_document", "recadastro_holder_document"].includes(command.fact_code ?? "") ||
        !goalDef(goal.goal_code).required_facts.includes(command.fact_code!) ||
        (doc.case_id !== null && doc.case_id !== goal.case_id)
      ) throw new Error("DOCUMENT_CLASSIFICATION_NOT_ALLOWED");
      state.documentos![index]!.case_id = goal.case_id;
      state.documentos![index]!.tipo = command.fact_code!;
      return applyAuthoritativeSignal(state, {
        goal_id: goal.goal_id,
        facts: [{
          code: command.fact_code!,
          value: `Arquivo conferido: ${doc.documento_id}`,
          source: "DOCUMENT",
          confidence: "CONFIRMED",
          authoritative: true,
        }],
        note: command.note,
      });
    }
    return state;
  }
  const state = structuredClone(previous);
  state.handoff = null;
  // Re-evaluate the same case; a SOCIAL event does not clear facts or goals.
  return applyEvent(state, { kind: "SOCIAL", note: "Retomada solicitada pela equipe" });
}

export function operatorReply(state: ConversationState, command: OperatorCommand): string {
  if (command.type === "REVIEW_DOCUMENT") {
    return command.document_status === "ACEITO"
      ? "A equipe conferiu o arquivo e registrou o aceite documental neste atendimento. As demais verificações do processo continuam sendo tratadas separadamente."
      : "A equipe analisou o arquivo e solicitou um novo envio. Envie uma cópia legível e completa; se tiver dúvida sobre o documento solicitado, peça orientação por aqui.";
  }
  const goal = contextGoal(state);
  const completedExhumation = [...state.goals].reverse().find((item) =>
    item.goal_code === "GOAL_EXUMACAO" && item.status === "RESOLVED" && item.goal_id === command.goal_id
  );
  if (command.type === "RESOLVE_ACTION" && completedExhumation) {
    const authorization = activeFact(state, "exhumation_authorization", completedExhumation);
    if (authorization?.authoritative && String(authorization.value).startsWith("OBTIDA_")) {
      return "A autorização administrativa foi registrada e a coleta de informações deste atendimento foi concluída. Isso não significa que a exumação foi executada; o processo operacional permanece separado e ainda não foi concluído.";
    }
  }
  if (state.pending_question) {
    const question = questionsDoc.questions.find((item) => item.question_code === state.pending_question?.question_code)
      ?.text;
    if (question) return `A equipe atualizou a verificação do atendimento. ${question}`;
  }
  if (goal?.status === "WAITING") {
    return `A equipe registrou a análise. O atendimento de ${
      goalLabel(goal).toLowerCase()
    } ainda tem verificações pendentes; você pode acrescentar informações por aqui.`;
  }
  if (command.type === "RESUME") {
    return "O atendimento automático foi retomado com o histórico e as informações preservados. Como posso ajudar na continuidade?";
  }
  return "A equipe registrou a verificação. Os dados coletados seguem no atendimento para continuidade; essa atualização não confirma execução nem agendamento do serviço.";
}
