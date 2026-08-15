import {
  type ClassifierEvidence,
  type ClassifierInput,
  type ClassifierOutput,
  validateClassifierOutput,
} from "../../contracts/classifier.ts";
import { appendAuditEvent } from "../_shared/audit.ts";
import { requireShadowFeature } from "../_shared/flags.ts";
import { hmacSha256, newId } from "../_shared/crypto.ts";
import { assertMethod, HttpProblem, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";

const AFFIRMATIVE = /^(sim|s|confirmo|confirmar|pode|ok|certo)$/i;
const NEGATIVE = /^(n[aã]o|nao|cancelar|cancela|desistir)$/i;
const MENU = /^(menu|voltar|in[ií]cio)$/i;
const COMPLAINT = /\b(reclama[cç][aã]o|reclamar|insatisfeit[oa]|den[uú]ncia)\b/i;
const HUMAN = /\b(atendente|atendimento humano|pessoa|falar com algu[eé]m|gerente|administra[cç][aã]o)\b/i;
const CLASSIFIER_VERSION = "support-classifier-deterministic-v1";

function evidence(kind: ClassifierEvidence["kind"], summary: string, input: ClassifierInput): ClassifierEvidence {
  return {
    evidence_id: newId(),
    kind,
    message_id: input.message_batch.message_ids.at(-1),
    redacted_summary: summary.slice(0, 240),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickService(text: string, input: ClassifierInput, evidences: ClassifierEvidence[]) {
  const candidates: Array<{ code: string; confidence: number; source: "DETERMINISTIC"; evidence_ids: string[] }> = [];
  for (const service of input.taxonomy.services) {
    if (service.availability_status !== "ACTIVE") continue;
    const alias = service.aliases.find((candidate) =>
      candidate.trim().length >= 2 &&
      new RegExp(`(^|\\s)${escapeRegExp(candidate.trim())}(?=\\s|$|[,.!?])`, "i").test(text)
    );
    if (alias) {
      const itemEvidence = evidence("TEXT_SPAN", `Alias publicado correspondente a ${service.code}`, input);
      evidences.push(itemEvidence);
      candidates.push({
        code: service.code,
        confidence: 0.9,
        source: "DETERMINISTIC",
        evidence_ids: [itemEvidence.evidence_id],
      });
    }
  }
  return candidates.slice(0, 3);
}

function detectLocation(text: string, input: ClassifierInput, evidences: ClassifierEvidence[]) {
  const entries: Array<[RegExp, "QUADRA_GERAL" | "JAZIGO" | "OSSUARIO"]> = [
    [/\bquadra geral\b/i, "QUADRA_GERAL"],
    [/\bjazigo( de fam[ií]lia)?\b/i, "JAZIGO"],
    [/\bossu[aá]rio\b/i, "OSSUARIO"],
  ];
  for (const [pattern, location_type] of entries) {
    if (pattern.test(text)) {
      const itemEvidence = evidence("TEXT_SPAN", `Tipo de local declarado: ${location_type}`, input);
      evidences.push(itemEvidence);
      return { location_type, confidence: 1, evidence_ids: [itemEvidence.evidence_id] };
    }
  }
  return null;
}

export function classifyDeterministically(input: ClassifierInput): Promise<ClassifierOutput> {
  const text = input.message_batch.text.trim();
  const evidences: ClassifierEvidence[] = [];
  if (input.release_id !== input.state.release_id || input.release_id !== input.taxonomy.release_id) {
    return Promise.resolve(blocked(input, "RELEASE_MISMATCH", evidences));
  }
  if (input.technical_signals.duplicate) return Promise.resolve(blocked(input, "DUPLICATE_INBOUND", evidences));
  if (input.technical_signals.human_active || input.state.automation_mode === "HUMAN_ACTIVE") {
    return Promise.resolve(blocked(input, "HUMAN_ACTIVE", evidences));
  }

  const pending = input.state.pending_confirmation;
  const question = input.state.active_topic?.pending_question;
  let message_role: ClassifierOutput["message_role"] = "UNKNOWN";
  let ambiguityCodes: string[] = [];

  if (
    pending && pending.status === "PENDING" &&
    new Date(pending.expires_at) > new Date(input.message_batch.received_at) &&
    input.state.active_topic?.topic_id === pending.topic_id && AFFIRMATIVE.test(text)
  ) {
    const itemEvidence = evidence("PENDING_QUESTION", "Confirmação pendente válida no tópico ativo", input);
    evidences.push(itemEvidence);
    message_role = "CONFIRMATION_AFFIRMATIVE";
  } else if (
    pending && pending.status === "PENDING" &&
    new Date(pending.expires_at) > new Date(input.message_batch.received_at) &&
    input.state.active_topic?.topic_id === pending.topic_id && NEGATIVE.test(text)
  ) {
    const itemEvidence = evidence("PENDING_QUESTION", "Confirmação pendente válida no tópico ativo", input);
    evidences.push(itemEvidence);
    message_role = "CONFIRMATION_NEGATIVE";
  } else if (MENU.test(text)) {
    const itemEvidence = evidence("EXACT_COMMAND", "Comando explícito de navegação", input);
    evidences.push(itemEvidence);
    message_role = "COMMAND";
  } else if (input.message_batch.attachments.length > 0) {
    const itemEvidence = evidence("ATTACHMENT", "Anexo técnico recebido", input);
    evidences.push(itemEvidence);
    message_role = input.message_batch.text ? "CONTINUATION" : "DOCUMENT_SUBMISSION";
  } else if (
    question && question.status === "OPEN" &&
    (!question.expires_at || new Date(question.expires_at) > new Date(input.message_batch.received_at)) &&
    /^\d+\s*$/.test(text) && numericAnswerAllowed(text, question.expected_answer_schema)
  ) {
    const itemEvidence = evidence(
      "PENDING_QUESTION",
      `Resposta numérica vinculada à pergunta ${question.question_code}`,
      input,
    );
    evidences.push(itemEvidence);
    message_role = "ANSWER_TO_PENDING_QUESTION";
  } else if (input.state.active_topic && text.length > 0) {
    message_role = "CONTINUATION";
  } else if (text.length > 0) {
    message_role = "NEW_TOPIC";
  }

  const complaintSignal = COMPLAINT.test(text);
  const intentCandidates = complaintSignal
    ? (() => {
      const itemEvidence = evidence("TEXT_SPAN", "Sinal explícito de reclamação", input);
      evidences.push(itemEvidence);
      return [{
        code: "RECLAMACAO_INTERNA",
        confidence: 0.95,
        source: "DETERMINISTIC" as const,
        evidence_ids: [itemEvidence.evidence_id],
      }];
    })()
    : [];
  const serviceCandidates = pickService(text, input, evidences);
  const locationCandidate = detectLocation(text, input, evidences);

  let transition: ClassifierOutput["topic_transition_candidate"] = "KEEP_ACTIVE";
  if (!input.state.active_topic) transition = "START_NEW";
  if (
    input.state.active_topic && serviceCandidates[0] && input.state.active_topic.service_code &&
    serviceCandidates[0].code !== input.state.active_topic.service_code
  ) {
    transition = "START_NEW";
    message_role = "TOPIC_CHANGE";
  }
  if (
    message_role === "UNKNOWN" || (message_role === "NEW_TOPIC" && !complaintSignal && serviceCandidates.length === 0)
  ) ambiguityCodes = ["NO_CONFIDENT_SERVICE_OR_INTENT"];

  return Promise.resolve({
    schema_version: "1.0",
    correlation_id: input.correlation_id,
    release_id: input.release_id,
    classification_status: ambiguityCodes.length ? "AMBIGUOUS" : "OK",
    message_role,
    intent_candidates: intentCandidates,
    service_candidates: serviceCandidates,
    location_candidate: locationCandidate,
    complaint_signal: complaintSignal,
    human_need_signal: HUMAN.test(text),
    topic_transition_candidate: ambiguityCodes.length ? "AMBIGUOUS" : transition,
    continuation_of_topic_id: message_role === "CONTINUATION" || message_role === "ANSWER_TO_PENDING_QUESTION"
      ? input.state.active_topic?.topic_id ?? null
      : null,
    document_signal: input.message_batch.attachments.length ? "TECHNICAL_DOCUMENT" : "NONE",
    ambiguity_codes: ambiguityCodes,
    evidence: evidences,
  });
}

function blocked(input: ClassifierInput, code: string, evidenceList: ClassifierEvidence[]): ClassifierOutput {
  const itemEvidence = evidence("STATE", code, input);
  evidenceList.push(itemEvidence);
  return {
    schema_version: "1.0",
    correlation_id: input.correlation_id,
    release_id: input.release_id,
    classification_status: "BLOCKED",
    message_role: "UNKNOWN",
    intent_candidates: [],
    service_candidates: [],
    location_candidate: null,
    complaint_signal: false,
    human_need_signal: code === "HUMAN_ACTIVE",
    topic_transition_candidate: "KEEP_ACTIVE",
    continuation_of_topic_id: input.state.active_topic?.topic_id ?? null,
    document_signal: "NONE",
    ambiguity_codes: [code],
    evidence: evidenceList,
  };
}

function maybeEnrichWithModel(output: ClassifierOutput): Promise<ClassifierOutput> {
  // Model transport is absent from this package. MODEL_EVIDENCE_SUMMARY cannot be produced here.
  return Promise.resolve(output);
}

function numericAnswerAllowed(text: string, schema: Record<string, unknown>): boolean {
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return false;
  const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const max = typeof schema.maximum === "number" ? schema.maximum : undefined;
  const values = Array.isArray(schema.enum) ? schema.enum : undefined;
  return (!values || values.includes(n)) && (min === undefined || n >= min) && (max === undefined || n <= max);
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    try {
      assertMethod(request);
      requireInternalShadowAccess(request);
      requireShadowOnly();
      const input = await parseJson<ClassifierInput>(request);
      const rest = new SupabaseRest();
      const inboundMessageId = input.message_batch.message_ids.at(-1);
      if (!inboundMessageId || !input.state.active_topic) {
        throw new HttpProblem(400, "INBOUND_STATE_REQUIRED", "A persisted inbound message requires an active topic");
      }
      const persistedInbound = await rest.rpc<{ content_hash: string } | Array<{ content_hash: string }>>(
        "persist_shadow_inbound_message",
        {
          p_inbound_message_id: inboundMessageId,
          p_session_id: input.state.session_id,
          p_topic_id: input.state.active_topic.topic_id,
          p_release_id: input.release_id,
          p_content: input.message_batch.text,
        },
      );
      const inboundContentHash = Array.isArray(persistedInbound)
        ? persistedInbound[0]?.content_hash
        : persistedInbound?.content_hash;
      if (!inboundContentHash) {
        throw new HttpProblem(
          502,
          "INBOUND_HASH_MISSING",
          "Inbound persistence did not return an authoritative content hash",
        );
      }
      let output = await classifyDeterministically(input);
      await requireShadowFeature(rest, "new_classifier_shadow", [
        { target_type: "CONVERSATION_ID", target_value: input.state.conversation_id },
        { target_type: "PHONE_HASH", target_value: input.technical_signals.phone_hash },
        { target_type: "SERVICE_CODE", target_value: output.service_candidates[0]?.code },
        { target_type: "RELEASE_ID", target_value: input.release_id },
        { target_type: "COMPONENT", target_value: "support-classifier" },
      ]);
      output = await maybeEnrichWithModel(output);
      const errors = validateClassifierOutput(output, input.taxonomy);
      if (errors.length) {
        output = {
          ...output,
          classification_status: "INVALID_INPUT",
          ambiguity_codes: [...output.ambiguity_codes, ...errors],
        };
      }
      if (input.state.active_topic) {
        const classificationCode = output.message_role === "CONFIRMATION_AFFIRMATIVE"
          ? "CONFIRMATION_AFFIRMATIVE"
          : "OTHER";
        const classificationStatus = output.classification_status === "OK"
          ? "OK"
          : output.classification_status === "BLOCKED"
          ? "BLOCKED"
          : "AMBIGUOUS";
        const confirmationId = classificationCode === "CONFIRMATION_AFFIRMATIVE"
          ? input.state.pending_confirmation?.confirmation_id ?? null
          : null;
        const authorityNonce = classificationCode === "CONFIRMATION_AFFIRMATIVE" ? newId() : null;
        const authorityKeyId = classificationCode === "CONFIRMATION_AFFIRMATIVE"
          ? Deno.env.get("SUPPORT_CLASSIFIER_AUTHORITY_KEY_ID") ?? null
          : null;
        const authoritySecret = classificationCode === "CONFIRMATION_AFFIRMATIVE"
          ? Deno.env.get("SUPPORT_CLASSIFIER_ASSERTION_KEY") ?? null
          : null;
        if (
          classificationCode === "CONFIRMATION_AFFIRMATIVE" &&
          (!authorityKeyId || !authoritySecret || !confirmationId || !authorityNonce)
        ) {
          throw new HttpProblem(503, "CLASSIFIER_AUTHORITY_UNCONFIGURED", "Classifier authority is not configured");
        }
        const assertionMaterial = classificationCode === "CONFIRMATION_AFFIRMATIVE"
          ? await rest.rpc<string>("classifier_assertion_material", {
            p_inbound_message_id: inboundMessageId,
            p_content_hash: inboundContentHash,
            p_confirmation_id: confirmationId,
            p_session_id: input.state.session_id,
            p_topic_id: input.state.active_topic.topic_id,
            p_release_id: input.release_id,
            p_classification_code: classificationCode,
            p_classification_status: classificationStatus,
            p_classifier_version: CLASSIFIER_VERSION,
            p_authority_nonce: authorityNonce,
          })
          : null;
        const authorityAssertion = assertionMaterial && authoritySecret
          ? await hmacSha256(authoritySecret, assertionMaterial)
          : null;
        await rest.rpc("persist_inbound_classification", {
          p_classification_id: newId(),
          p_inbound_message_id: inboundMessageId,
          p_confirmation_id: confirmationId,
          p_session_id: input.state.session_id,
          p_topic_id: input.state.active_topic.topic_id,
          p_release_id: input.release_id,
          p_classification_code: classificationCode,
          p_classification_status: classificationStatus,
          p_source: "DETERMINISTIC",
          p_classifier_version: CLASSIFIER_VERSION,
          p_authority_key_id: authorityKeyId,
          p_authority_nonce: authorityNonce,
          p_authority_assertion: authorityAssertion,
        });
      }
      await appendAuditEvent(rest, {
        correlation_id: input.correlation_id,
        component: "support-classifier",
        component_version: "5B.1",
        event_type: "CLASSIFICATION_RUN",
        outcome: output.classification_status,
        actor_type: "EDGE_FUNCTION",
        conversation_id: input.state.conversation_id,
        session_id: input.state.session_id,
        topic_id: input.state.active_topic?.topic_id,
        release_id: input.release_id,
        metadata_redacted: {
          message_role: output.message_role,
          intent_codes: output.intent_candidates.map((item) => item.code),
          service_codes: output.service_candidates.map((item) => item.code),
          ambiguity_codes: output.ambiguity_codes,
          complaint_signal: output.complaint_signal,
        },
      });
      return json(output);
    } catch (error) {
      return problem(error);
    }
  });
}
