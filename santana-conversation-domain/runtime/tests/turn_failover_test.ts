import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { initState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn } from "../turn.ts";

function input(text: string) {
  return {
    message_id: `failover-${text}`,
    text,
    state: initState(`failover-${text}`),
    automation_mode: "BOT_ACTIVE" as const,
  };
}

function fallback() {
  return { interpret: (value: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(value)) };
}

Deno.test("canonical enum rejection fails over once to the current deterministic workflow", async () => {
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const result = await planTurn(input("Preciso de exumação."), {
    interpret: () => {
      primaryCalls += 1;
      const error = Object.assign(new Error("structured output rejected"), {
        rejectionCode: "STRUCTURED_OUTPUT_REJECTED",
        rejectionCategory: "canonical_enum_invalid",
      });
      return Promise.reject(error);
    },
  }, {
    route_attempted: "MOTOR_V2",
    fallbackInterpreter: {
      interpret: async (value) => {
        fallbackCalls += 1;
        return interpret(value);
      },
    },
  });

  assertEquals(primaryCalls, 1);
  assertEquals(fallbackCalls, 1);
  assertEquals(result.route.route_attempted, "MOTOR_V2");
  assertEquals(result.route.provider_result, "REJECTED");
  assertEquals(result.route.failover_route, "CURRENT_DETERMINISTIC");
  assertEquals(result.route.reason, "CANONICAL_ENUM_INVALID");
  assertEquals(result.route.ai_output_used, false);
  assertEquals(result.outcome, "PROPOSED");
  assertEquals(result.interpretation?.produced_by, "deterministic-mock/v1");
});

Deno.test("valid V2 output is used and does not invoke deterministic failover", async () => {
  let fallbackCalls = 0;
  const result = await planTurn(input("Preciso de exumação."), {
    interpret: (value) => Promise.resolve(interpret(value)),
  }, {
    route_attempted: "MOTOR_V2",
    fallbackInterpreter: {
      interpret: async (value) => {
        fallbackCalls += 1;
        return interpret(value);
      },
    },
  });

  assertEquals(fallbackCalls, 0);
  assertEquals(result.route.provider_result, "VALID");
  assertEquals(result.route.failover_route, null);
  assertEquals(result.route.ai_output_used, true);
});

Deno.test("unknown subintent rejection is explicit and does not retry", async () => {
  let primaryCalls = 0;
  const result = await planTurn(input("Preciso de exumação."), {
    interpret: () => {
      primaryCalls += 1;
      return Promise.reject(Object.assign(new Error("structured output rejected"), {
        rejectionCode: "STRUCTURED_OUTPUT_REJECTED",
        rejectionCategory: "canonical_enum_invalid",
      }));
    },
  }, { route_attempted: "MOTOR_V2", fallbackInterpreter: fallback() });

  assertEquals(primaryCalls, 1);
  assertEquals(result.route.reason, "CANONICAL_ENUM_INVALID");
  assertEquals(result.route.failover_route, "CURRENT_DETERMINISTIC");
});

Deno.test("HTTP 5xx fails over without a provider retry", async () => {
  let primaryCalls = 0;
  const result = await planTurn(input("Preciso de exumação."), {
    interpret: () => {
      primaryCalls += 1;
      return Promise.reject(Object.assign(new Error("provider HTTP failure"), { rejectionCode: "PROVIDER_HTTP_500" }));
    },
  }, { route_attempted: "MOTOR_V2", fallbackInterpreter: fallback() });

  assertEquals(primaryCalls, 1);
  assertEquals(result.route.reason, "PROVIDER_HTTP_ERROR");
  assertEquals(result.outcome, "PROPOSED");
});

Deno.test("P0 fallback remains a human handoff and never becomes an automatic action", async () => {
  const result = await planTurn(input("Há conflito familiar sobre quem pode autorizar."), {
    interpret: () => Promise.reject(Object.assign(new Error("provider timeout"), { rejectionCode: "PROVIDER_TIMEOUT" })),
  }, {
    route_attempted: "MOTOR_V2",
    fallbackInterpreter: fallback(),
  });

  assertEquals(result.route.reason, "PROVIDER_TIMEOUT");
  assertEquals(result.interpretation?.primary_event?.event_kind, "HUMAN_REQUEST");
  assertEquals(result.next_state.handoff?.priority, "P0");
  assertEquals(result.question_draft, null);
  assertEquals(result.next_state.pending_actions, []);
});

Deno.test("a fallback provider failure without a fallback interpreter remains unavailable", async () => {
  const result = await planTurn(input("Preciso de exumação."), {
    interpret: () => Promise.reject(new Error("provider failure")),
  }, { route_attempted: "MOTOR_V2" });

  assertEquals(result.outcome, "INTERPRETATION_UNAVAILABLE");
  assertEquals(result.route.provider_result, "REJECTED");
  assertEquals(result.next_state, initState("failover-Preciso de exumação."));
});
