import { assertEquals } from "../fixtures/assert.ts";
import { assertAConfirmarPlan, type DecisionPlan } from "../../contracts/decision-plan.ts";
import { resolveShadowFeature } from "../../edge-functions/_shared/flags.ts";
import type { RpcOnly } from "../fixtures/rpc.ts";

Deno.test("A_CONFIRMAR cannot propose a request", () => {
  const plan = {
    outcome: "A_CONFIRMAR",
    request_plan: { mode: "PROPOSE" },
    actions: ["RESPONDER"],
  } as unknown as DecisionPlan;
  assertEquals(assertAConfirmarPlan(plan), ["A_CONFIRMAR_CANNOT_PROPOSE_REQUEST"]);
});

Deno.test("feature resolver sends target_value and global fallback", () => {
  let candidates: unknown[] = [];
  const rest: RpcOnly = {
    rpc: <T>(_name: string, input: unknown): Promise<T> => {
      const candidatesInput = input as { p_candidates: unknown[] };
      candidates = candidatesInput.p_candidates;
      return Promise.resolve({ mode: "SHADOW_ONLY" as const } as T);
    },
  };
  return resolveShadowFeature(rest, "x", [{ target_type: "PHONE_HASH", target_value: "hash" }]).then((mode) => {
    assertEquals(mode, "SHADOW_ONLY");
    assertEquals(candidates, [{ target_type: "PHONE_HASH", target_value: "hash" }, {
      target_type: "GLOBAL",
      target_value: "GLOBAL",
    }]);
  });
});
