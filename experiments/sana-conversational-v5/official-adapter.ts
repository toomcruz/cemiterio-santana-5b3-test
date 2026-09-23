/** No new reducer. This adapter uses the existing official interpretation/turn boundary. */
import { contextGoal, type ConversationState } from "../../santana-conversation-domain/engine/engine.ts";
import { questionForFact } from "../../santana-conversation-domain/engine/catalog.ts";
import { buildPrompt } from "../../santana-conversation-domain/runtime/adapter/prompt.ts";
import { parseStrictInterpretation } from "../../santana-conversation-domain/runtime/adapter/schema.ts";
import { contextFromState } from "../../santana-conversation-domain/runtime/interpreter/bridge.ts";
import { planTurn } from "../../santana-conversation-domain/runtime/turn.ts";
import { officialInformationReply } from "../../santana-conversation-domain/runtime/official_information.ts";
import interpretationSchema from "../../santana-conversation-domain/runtime/interpretation.schema.json" with { type: "json" };
import type { Bridge, InfoKind, Message } from "./core.ts";

function interpreterInput(state: ConversationState, message: Message) {
  if (state.conversation_id !== message.conversationId) throw new Error("CONVERSATION_MISMATCH");
  return { message_id: message.id, text: message.text, context: contextFromState(state) };
}
const queries: Record<InfoKind, string> = {
  DOCUMENTOS: "Quais documentos para exumação?",
  PRECO: "Qual o valor da exumação?",
  PRAZO: "Qual o prazo da exumação?",
  PROCEDIMENTO_ADMINISTRATIVO: "Como funciona a exumação?",
};
export function officialBridge(): Bridge<ConversationState> {
  return {
    snapshot(state) {
      const goal = contextGoal(state);
      return {
        conversationId: state.conversation_id, seq: state.seq,
        topic: state.current_topic ?? goal?.goal_code ?? null,
        caseId: goal?.case_id ?? null, goalId: goal?.goal_id ?? null,
        humanActive: state.handoff !== null,
        facts: state.facts.filter((f) => f.status === "ACTIVE").map((f) => ({
          id: f.fact_id, key: f.fact_code, value: f.value, caseId: f.case_id,
          goalId: f.goal_id, source: f.source, conflict: f.conflicts_with !== null,
        })),
        pending: state.pending_question ? {
          key: state.pending_question.fact_code,
          text: questionForFact(state.pending_question.fact_code).text,
        } : null,
      };
    },
    interpretationPrompt(state, message) {
      return JSON.stringify({
        contract: buildPrompt(interpreterInput(state, message)),
        schema: interpretationSchema,
      });
    },
    async preview(state, message, raw) {
      const request = interpreterInput(state, message);
      const interpretation = parseStrictInterpretation(JSON.stringify(raw), request);
      const plan = await planTurn({
        message_id: message.id, text: message.text, state: structuredClone(state),
        automation_mode: state.handoff === null ? "BOT_ACTIVE" : "HUMAN_ACTIVE",
      }, { interpret: () => Promise.resolve(interpretation) });
      return { state: plan.next_state, outcome: plan.outcome, legacyDraft: plan.reply_draft };
    },
    async lookup(state, question, referenceDate) {
      // Exumação-only vertical. Do not silently query legacy SQL tables or assert their currency.
      const topic = state.current_topic ?? contextGoal(state)?.goal_code ?? "EXUMACAO";
      const supported = ["EXUMACAO", "GOAL_EXUMACAO", "TRANSPORTE", "GOAL_TRANSPORTE"].includes(topic);
      const result = supported ? await officialInformationReply({
        text: queries[question.kind], state: structuredClone(state), referenceDate,
      }) : null;
      const value = {
        kind: question.kind,
        status: result?.status ?? "NOT_AVAILABLE" as const,
        text: result?.text ?? "Este laboratório ainda não possui uma orientação validada para essa consulta.",
      };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
        referenceDate, value, authority: result?.authority ?? null,
      })));
      const version = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { id: `authority:${question.kind}`, version, ...value };
    },
  };
}
