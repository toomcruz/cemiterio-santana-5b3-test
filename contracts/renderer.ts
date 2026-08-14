import type { ResponsePlan } from "./decision-plan.ts";

export interface RendererInput {
  schema_version: "1.0";
  decision_id: string;
  release_id: string;
  response_plan: ResponsePlan;
  tone: "INSTITUTIONAL_CLEAR";
  /** Values were resolved by the decision engine from the pinned release. */
  resolved_fields: Record<string, string | number | boolean>;
  /** Never includes raw inbound history, attachments, credentials, or PII. */
  generation_context?: {
    permitted_intent_code?: string;
    permitted_service_code?: string;
    style_instruction_code?: string;
  };
  prohibited_operations: Array<"CHANGE_ACTION" | "ADD_FACT" | "CREATE_REQUEST" | "SET_STATE">;
}

export interface RendererOutput {
  decision_id: string;
  render_status: "OK" | "FALLBACK_TEMPLATE" | "ERROR";
  body: string;
  used_mode: "DETERMINISTIC" | "FIELD_TEMPLATE" | "GEMINI";
  template_id?: string;
  validation_tokens: string[];
}

export const CRITICAL_FACT_TYPES = new Set(["PRICE", "DOCUMENT", "HOURS", "CONDITION", "ASSET"]);

export function rendererRequiresTemplate(plan: ResponsePlan): boolean {
  return plan.allowed_fact_refs.some((ref) => CRITICAL_FACT_TYPES.has(ref.type)) ||
    plan.mode !== "GEMINI" ||
    Boolean(plan.question);
}

export function rendererMayUseModel(plan: ResponsePlan): boolean {
  return plan.mode === "GEMINI" && !plan.allowed_fact_refs.some((ref) => CRITICAL_FACT_TYPES.has(ref.type));
}
