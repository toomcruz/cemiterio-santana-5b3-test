import { assertEquals } from "../fixtures/assert.ts";
import { assertAConfirmarPlan, type DecisionPlan } from "../../contracts/decision-plan.ts";
import { resolveShadowFeature } from "../../edge-functions/_shared/flags.ts";

Deno.test("A_CONFIRMAR cannot propose a request", () => {
  const plan = {
    outcome: "A_CONFIRMAR",
    request_plan: { mode: "PROPOSE" },
    actions: ["RESPONDER"],
  } as unknown as DecisionPlan;
  assertEquals(assertAConfirmarPlan(plan), ["A_CONFIRMAR_CANNOT_PROPOSE_REQUEST"]);
});

Deno.test("feature resolver sends target_value and global fallback", async () => {
  let candidates: unknown[] = [];
  const rest = {
    rpc: async (_name: string, input: { p_candidates: unknown[] }) => {
      candidates = input.p_candidates;
      return { mode: "SHADOW_ONLY" as const };
    },
  } as any;
  assertEquals(
    await resolveShadowFeature(rest, "x", [{ target_type: "PHONE_HASH", target_value: "hash" }]),
    "SHADOW_ONLY",
  );
  assertEquals(candidates, [{ target_type: "PHONE_HASH", target_value: "hash" }, {
    target_type: "GLOBAL",
    target_value: "GLOBAL",
  }]);
});
