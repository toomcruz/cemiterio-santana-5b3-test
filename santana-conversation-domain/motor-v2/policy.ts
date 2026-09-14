import { normalizeText, unique } from "./normalization.ts";
import type {
  AdministrativeGaps,
  MotorV2Message,
  MotorV2Track,
  PolicyAction,
  PolicyDecision,
  ReceiptType,
  UnderstandingResult,
} from "./types.ts";

const COMPLETION_CLAIMS = [
  "UNVERIFIED_CURRENT_RULE",
  "UNVERIFIED_RIGHT",
  "UNVERIFIED_IDENTITY",
  "UNVERIFIED_ELIGIBILITY",
  "UNVERIFIED_DEADLINE",
  "UNVERIFIED_VALUE",
  "UNVERIFIED_DOCUMENT",
  "UNVERIFIED_SCHEDULE",
  "UNVERIFIED_PROCEDURE",
  "PREMATURE_COMPLETION",
];

export interface CurrentPolicyRule {
  policy_id: string;
  domain: string;
  statement: string;
  source_ref: string;
  valid_from: string;
  valid_until: string | null;
  temporal_status: "current";
  review_status: "administratively_confirmed";
}

export class CurrentPolicyRegistry {
  constructor(private readonly rules: readonly CurrentPolicyRule[] = []) {}

  activeAt(instant: string): CurrentPolicyRule[] {
    const at = Date.parse(instant);
    if (Number.isNaN(at)) throw new Error("invalid policy evaluation instant");
    return this.rules.filter((rule) => {
      if (
        !rule ||
        typeof rule !== "object" ||
        rule.temporal_status !== "current" ||
        rule.review_status !== "administratively_confirmed" ||
        typeof rule.policy_id !== "string" ||
        !rule.policy_id.trim() ||
        typeof rule.domain !== "string" ||
        !rule.domain.trim() ||
        typeof rule.statement !== "string" ||
        !rule.statement.trim() ||
        typeof rule.source_ref !== "string" ||
        !rule.source_ref.trim() ||
        typeof rule.valid_from !== "string" ||
        rule.valid_until !== null && typeof rule.valid_until !== "string"
      ) return false;
      const from = Date.parse(rule.valid_from);
      const until = rule.valid_until === null ? null : Date.parse(rule.valid_until);
      return !Number.isNaN(from) && from <= at && (until === null || !Number.isNaN(until) && at <= until);
    }).map((rule) => structuredClone(rule));
  }
}

function hasAny(intents: readonly string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => intents.includes(candidate));
}

function receiptRequirements(understanding: UnderstandingResult, offeredHandoff: boolean): ReceiptType[] {
  const required: ReceiptType[] = [];
  if (offeredHandoff) required.push("handoff_acceptance");
  if (understanding.subintents.includes("CORRECAO_DE_AGENDAMENTO")) {
    required.push("booking_confirmation", "execution_confirmation");
  }
  if (understanding.subintents.includes("RECUPERACAO_APOS_FALHA_DE_PAGAMENTO")) {
    required.push("payment_confirmation", "document_confirmation", "execution_confirmation");
  }
  if (understanding.subintents.includes("CORRECAO_DE_DADO_EM_LAPIDE_PLACA")) {
    required.push("explicit_user_confirmation", "document_confirmation");
  }
  if (hasAny(understanding.subintents, ["RECLAMACAO_OPERACIONAL", "RECLAMACAO_SEM_RETORNO"])) {
    required.push("resolution_confirmation");
  }
  return unique(required);
}

function handoffPayload(understanding: UnderstandingResult, tracks: readonly MotorV2Track[]): string[] {
  const payload = ["tracks", "known_facts", "open_questions", "administrative_gaps", "next_step"];
  if (understanding.risk.level === "P0") payload.push("risk_level", "risk_signals", "explicit_unknowns");
  if (understanding.subintents.includes("SEPULTAMENTO")) payload.push("urgent_track", "deferred_tracks", "burial_need");
  if (tracks.length >= 3) payload.push("three_tracks", "shared_facts", "per_track_gaps");
  if (hasAny(understanding.subintents, ["RECLAMACAO_OPERACIONAL", "RECLAMACAO_SEM_RETORNO"])) {
    payload.push(
      "complaint_history",
      "affected_item",
      "requested_result",
      "requested_action",
      "prior_unsuccessful_contact",
      "responsible_area_if_confirmed",
    );
  }
  if (understanding.subintents.includes("DIVERGENCIA_FISICO_CADASTRAL")) {
    payload.push("observed_facts", "explicit_unknowns", "affected_tracks");
  }
  if (understanding.subintents.includes("CONFLITO_CADASTRAL_DOCUMENTO_LEGADO")) {
    payload.push("source_types", "conflicting_fields", "requested_action");
  }
  if (understanding.subintents.includes("SUPORTE_DOCUMENTAL")) {
    payload.push("reported_error", "evidence_already_provided", "minimal_missing_reference");
  }
  if (understanding.subintents.includes("RECUPERACAO_APOS_FALHA_DE_PAGAMENTO")) {
    payload.push("preserved_state", "failed_operation", "missing_receipts");
  }
  if (understanding.subintents.includes("CONTRADICAO_ENTRE_CANAIS")) {
    payload.push("channel_conflict", "independent_tracks", "unverified_claim");
  }
  return unique(payload);
}

function requiresPriority(understanding: UnderstandingResult, tracks: readonly MotorV2Track[], text: string): boolean {
  return /urgente|demanda funeraria|situacao sensivel|desaparecid/.test(text) ||
    tracks.length >= 3 && hasAny(understanding.subintents, ["CREMACAO", "SUCESSAO"]) ||
    hasAny(understanding.subintents, [
      "DIVERGENCIA_FISICO_CADASTRAL",
      "CONFLITO_CADASTRAL_DOCUMENTO_LEGADO",
      "CONTRADICAO_ENTRE_CANAIS",
    ]);
}

function isConversationClosing(lastUserText: string, understanding: UnderstandingResult): boolean {
  if (understanding.risk.level !== "none") return false;
  return /^(?:ok|obrigad[oa]|perfeito|certo|entendi|ta bom|tudo bem)[.! ]*$/.test(lastUserText);
}

function needsAdministrativeReview(understanding: UnderstandingResult, lastUserText: string): boolean {
  if (understanding.risk.level !== "none") return true;
  if (understanding.transverse_states.includes("MEDIA_NOT_ANALYZED")) return true;
  if (hasAny(understanding.subintents, [
    "CORRECAO_DE_AGENDAMENTO",
    "RECUPERACAO_APOS_FALHA_DE_PAGAMENTO",
    "SUPORTE_DOCUMENTAL",
    "ASSINATURA_DIGITAL_DOCUMENTO",
    "CONFLITO_CADASTRAL_DOCUMENTO_LEGADO",
    "CONTRADICAO_ENTRE_CANAIS",
  ])) return true;
  return /(?:regra|documento|autorizacao|agendamento|agenda|pagamento|valor|prazo|procedimento|confirmad|pode|como fazer)/.test(
    lastUserText,
  );
}

/** Deterministic safety layer. It never turns corpus language into a current rule. */
export function evaluatePolicy(input: {
  understanding: UnderstandingResult;
  messages: readonly MotorV2Message[];
  tracks: readonly MotorV2Track[];
  gaps: AdministrativeGaps;
  currentPolicies?: readonly CurrentPolicyRule[];
  at?: string;
}): PolicyDecision {
  const { understanding, tracks, gaps } = input;
  const text = normalizeText(input.messages.map((message) => message.content).join("\n"));
  const acceptedVerifiedContingency = understanding.subintents.includes("CONTINGENCIA_FUNERARIA_POR_RAMIFICACAO") &&
    /contingencia verificada/.test(text) && /aceito explicitamente/.test(text);
  const versionedDraft = understanding.subintents.includes("CORRECAO_DE_DADO_EM_LAPIDE_PLACA");
  const noHandoff = understanding.risk.level !== "P0" && (acceptedVerifiedContingency || versionedDraft);
  const lastUserText = normalizeText(input.messages.filter((message) => message.role === "user").at(-1)?.content ?? "");
  const requestedHumanNow = /falar com (?:um |uma )?atendente|atendimento humano|alguem pode responder/.test(
    lastUserText,
  );
  const closing = isConversationClosing(lastUserText, understanding);
  const currentPolicyNeeded = Object.values(gaps).some((status) => status !== "unknown") &&
    needsAdministrativeReview(understanding, lastUserText);
  const offered = !noHandoff && !closing && (
    understanding.risk.level !== "none" ||
    requestedHumanNow ||
    currentPolicyNeeded
  );

  const actions: PolicyAction[] = [];
  if (tracks.length > 1 || /continua de outro dia|sem pedir novamente|nao quero perder/.test(text)) {
    actions.push("PRESERVE_STATE");
  }
  if (understanding.subintents.includes("SEPULTAMENTO") && /urgente|situacao sensivel|demanda funeraria/.test(text)) {
    actions.push("PRIORITIZE_URGENT");
  }
  if (hasAny(understanding.subintents, ["CONFLITO_CADASTRAL_DOCUMENTO_LEGADO", "CONTRADICAO_ENTRE_CANAIS"])) {
    actions.push("ACKNOWLEDGE_UNCERTAINTY");
  }
  if (versionedDraft && understanding.risk.level !== "P0") actions.push("REQUEST_EXPLICIT_CONFIRMATION");
  if (understanding.subintents.includes("CORRECAO_DE_AGENDAMENTO")) actions.push("WAIT_FOR_RECEIPT");
  if (offered) actions.push("HANDOFF");

  const priority = !offered
    ? "none"
    : understanding.risk.level === "P0"
    ? "P0"
    : requiresPriority(understanding, tracks, text)
    ? "priority"
    : "normal";
  const asked_fact_keys = versionedDraft && understanding.risk.level !== "P0" ? ["explicit_user_confirmation"] : [];
  const policy_gaps =
    (Object.entries(gaps) as Array<[keyof AdministrativeGaps, AdministrativeGaps[keyof AdministrativeGaps]]>)
      .map(([field, status]) => ({ field, status }));
  const currentPolicyRefs = input.currentPolicies && input.at
    ? new CurrentPolicyRegistry(input.currentPolicies).activeAt(input.at).map((rule) => rule.policy_id)
    : [];

  return {
    actions: unique(actions),
    asked_fact_keys: asked_fact_keys.slice(0, 1),
    handoff: {
      lifecycle: offered ? "offered" : "none",
      offered,
      priority,
      reason: offered
        ? understanding.risk.level === "P0"
          ? "Risco P0 exige validação humana antes de orientação ou ação."
          : "Há decisão, fonte atual ou operação que exige validação humana."
        : "Nenhum handoff é necessário para o próximo passo seguro.",
      payload_fields: offered ? handoffPayload(understanding, tracks) : [],
      accepted: "unknown",
    },
    blocked_claims: COMPLETION_CLAIMS,
    required_receipt_types: receiptRequirements(understanding, offered),
    policy_gaps,
    current_policy_refs: currentPolicyRefs,
  };
}
