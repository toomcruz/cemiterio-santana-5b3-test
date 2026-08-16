import { factsDoc, goalsDoc } from "../../engine/catalog.ts";
import { validateAgainstSchema } from "../../engine/validate.ts";
import type { Interpretation, InterpreterInput } from "../interpreter/types.ts";

const schema = JSON.parse(Deno.readTextFileSync(new URL("../interpretation.schema.json", import.meta.url))) as Record<
  string,
  unknown
>;
const factCodes = new Set(factsDoc.facts.map((fact) => fact.fact_code));
const goalCodes = new Set(goalsDoc.goals.map((goal) => goal.goal_code));

export class InvalidInterpretationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`invalid interpretation: ${reasons.join("; ")}`);
    this.name = "InvalidInterpretationError";
  }
}

export function assertStrictInterpretation(value: unknown): asserts value is Interpretation {
  const errors = validateAgainstSchema(schema, schema, value, "interpretation");
  if (errors.length) throw new InvalidInterpretationError(errors);
}

export function parseStrictInterpretation(raw: string, input: InterpreterInput): Interpretation {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InvalidInterpretationError(["response is not JSON"]);
  }
  assertStrictInterpretation(value);
  const result = value as Interpretation;
  const semantic: string[] = [];
  if (result.message_id !== input.message_id) semantic.push("message_id does not match request");
  if (result.goal && !goalCodes.has(result.goal.goal_code)) semantic.push(`unknown goal ${result.goal.goal_code}`);
  for (const fact of result.facts) {
    if (!factCodes.has(fact.fact_code)) semantic.push(`unknown fact ${fact.fact_code}`);
    if (!input.text.includes(fact.evidence)) semantic.push(`evidence is not present in message for ${fact.fact_code}`);
  }
  if (semantic.length) throw new InvalidInterpretationError(semantic);
  return result;
}
