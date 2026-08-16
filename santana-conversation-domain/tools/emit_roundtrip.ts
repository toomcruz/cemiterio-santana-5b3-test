// Gera tests/postgres/p23_roundtrip_generated.sql a partir dos MESMOS cenarios
// C01-C16 / D1-D6 do P0: reducer TypeScript -> diff -> RPC -> conv_state_canonical.
// Executar: deno run --allow-read --allow-write santana-conversation-domain/tools/emit_roundtrip.ts
// O arquivo gerado e versionado; a CI regenera e exige diff vazio.

import {
  applyAuthoritativeSignal,
  applyEvent,
  type ConversationEvent,
  type ConversationState,
  type FactInput,
  initState,
} from "../engine/persistence_deps.ts";
import { canonicalState, diffTransition, type IdMap, newIdMap } from "../engine/persistence.ts";

type Step = { kind: "event"; event: ConversationEvent } | { kind: "signal"; facts: FactInput[] };

const CATALOG_HASH = "a".repeat(64); // hash do catalogo v1 no ambiente de teste
const IDENTITY_KEY_VERSION = 1;
const TEST_IDENTITY_SECRET = "5b4b-roundtrip-identity-secret"; // apenas laboratorio; nunca o segredo da classifier authority

const encoder = new TextEncoder();

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TEST_IDENTITY_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ev = (event: ConversationEvent): Step => ({ kind: "event", event });
const sig = (facts: FactInput[]): Step => ({ kind: "signal", facts });
const answer = (code: string, value: string): Step => ev({ kind: "ANSWER", facts: [{ code, value }] });

const transporte = (caseRef: string): Step => ev({ kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: caseRef });

const scenarios: { name: string; steps: Step[] }[] = [
  {
    name: "C01",
    steps: [
      transporte("C01_A"),
      answer("remains_status", "SEPULTADO"),
      answer("surviving_spouse_status", "FALECIDO"),
      sig([{ code: "exhumation_authorization", value: "OBTIDA_RESPONSAVEL_JAZIGO" }]),
      answer("burial_reference", "Quadra 3 / Jazigo 18"),
      answer("requester_document", "DOC-1"),
    ],
  },
  { name: "C02", steps: [transporte("C02_A"), answer("remains_status", "EXUMADO")] },
  {
    name: "C03",
    steps: [
      transporte("C03_A"),
      answer("remains_status", "SEPULTADO"),
      ev({ kind: "CORRECTION", facts: [{ code: "remains_status", value: "EXUMADO" }] }),
    ],
  },
  {
    name: "C04",
    steps: [
      transporte("C04_A"),
      answer("remains_status", "EXUMADO"),
      answer("transport_destination", "JAZIGO_FAMILIA"),
      answer("destination_grave_reference", "J-12"),
      ev({ kind: "CHANGE_OF_MIND", facts: [{ code: "transport_destination", value: "OUTRO_CEMITERIO" }] }),
    ],
  },
  {
    name: "C05",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "C05_C" }),
      answer("concession_purpose", "TRANSFERENCIA"),
      answer("recadastro_status", "OK"),
      sig([{ code: "recadastro_status", value: "OK" }]),
    ],
  },
  {
    name: "C06",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "C06_C" }),
      answer("concession_purpose", "TRANSFERENCIA"),
      answer("recadastro_status", "PENDENTE"),
      answer("concession_reference", "CONC-77"),
      answer("recadastro_holder_document", "DOC-9"),
    ],
  },
  {
    name: "C07",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "C07_C" }),
      answer("concession_purpose", "RENOVACAO"),
      answer("recadastro_status", "DESCONHECIDO"),
    ],
  },
  {
    name: "C08",
    steps: [
      transporte("C08_A"),
      answer("remains_status", "SEPULTADO"),
      ev({
        kind: "PARALLEL_QUESTION",
        goal_code: "GOAL_INFO_OSSUARIO",
        facts: [{ code: "ossuary_information_request", value: "Quanto custa o ossuario?" }],
      }),
    ],
  },
  {
    name: "C09",
    steps: [
      transporte("C09_A"),
      answer("remains_status", "SEPULTADO"),
      ev({
        kind: "PARALLEL_QUESTION",
        goal_code: "GOAL_INFO_HORARIO",
        facts: [{ code: "service_hours_request", value: "Ate que horas atendem?" }],
      }),
    ],
  },
  {
    name: "C10",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "C10_P" }),
      answer("commercial_item", "LAPIDE"),
      answer("commercial_stage", "ORCAMENTO"),
    ],
  },
  {
    name: "C11",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "C11_P" }),
      answer("commercial_item", "LAPIDE"),
      answer("commercial_stage", "PEDIDO_PAGO"),
      answer("commercial_delivery_status", "PENDENTE"),
      ev({ kind: "COMPLAINT" }),
    ],
  },
  {
    name: "C12",
    steps: [
      transporte("C12_A"),
      answer("remains_status", "EXUMADO"),
      answer("transport_destination", "OUTRO_CEMITERIO"),
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "C12_B" }),
    ],
  },
  {
    name: "C13",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "C13_P" }),
      ev({
        kind: "ANSWER",
        facts: [{ code: "commercial_item", value: "JAZIGO" }, { code: "commercial_stage", value: "ORCAMENTO" }],
      }),
    ],
  },
  {
    name: "C14",
    steps: [
      transporte("C14_A"),
      ev({ kind: "COMPLEMENT", facts: [{ code: "transport_destination", value: "OUTRO_CEMITERIO" }] }),
      answer("remains_status", "EXUMADO"),
    ],
  },
  {
    name: "C15",
    steps: [
      transporte("C15_A"),
      answer("remains_status", "EXUMADO"),
      ev({ kind: "COMPLEMENT", facts: [{ code: "remains_status", value: "SEPULTADO" }] }),
      ev({ kind: "CORRECTION", facts: [{ code: "remains_status", value: "SEPULTADO" }] }),
    ],
  },
  {
    name: "C16",
    steps: [
      transporte("C16_A"),
      answer("remains_status", "SEPULTADO"),
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_COMERCIAL", case_ref: "C16_P", abandon_current: true }),
    ],
  },
  {
    name: "D1",
    steps: [
      transporte("D1_A"),
      answer("remains_status", "EXUMADO"),
      answer("transport_destination", "JAZIGO_FAMILIA"),
      answer("destination_grave_reference", "J-12"),
      sig([{ code: "destination_grave_situation", value: "REGULAR" }]),
    ],
  },
  {
    name: "D2",
    steps: [
      transporte("D2_A"),
      answer("remains_status", "EXUMADO"),
      answer("transport_destination", "JAZIGO_FAMILIA"),
      answer("destination_grave_reference", "J-12"),
      sig([{ code: "destination_grave_situation", value: "REGULAR" }]),
      sig([{ code: "destination_grave_authorization", value: "OBTIDA_ADMINISTRADOR_PROVISORIO" }]),
    ],
  },
  {
    name: "D3",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "D3_C" }),
      answer("concession_purpose", "TRANSFERENCIA"),
      answer("recadastro_status", "DESCONHECIDO"),
      sig([{ code: "recadastro_status", value: "PENDENTE" }]),
    ],
  },
  {
    name: "D4",
    steps: [
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_CONCESSAO", case_ref: "D4_C" }),
      answer("concession_purpose", "NOVA"),
      answer("recadastro_status", "OK"),
      sig([{ code: "recadastro_status", value: "OK" }]),
    ],
  },
  {
    name: "D5",
    steps: [
      transporte("D5_A"),
      answer("remains_status", "EXUMADO"),
      ev({ kind: "NEW_GOAL", goal_code: "GOAL_TRANSPORTE", case_ref: "D5_B" }),
      answer("remains_status", "SEPULTADO"),
      ev({ kind: "CORRECTION", facts: [{ code: "remains_status", value: "EXUMADO" }] }),
      ev({ kind: "CORRECTION", facts: [{ code: "remains_status", value: "SEPULTADO" }] }),
    ],
  },
  {
    name: "D6",
    steps: [
      transporte("D6_A"),
      answer("remains_status", "SEPULTADO"),
      answer("surviving_spouse_status", "VIVO"),
      sig([{ code: "exhumation_authorization", value: "OBTIDA_CONJUGE_E_RESPONSAVEL_JAZIGO", source: "DOCUMENT" }]),
    ],
  },
];

function sessionUuid(index: number): string {
  return `55555555-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function sqlLiteral(value: string): string {
  return `$sq$${value}$sq$`;
}

async function main(): Promise<void> {
  const out: string[] = [
    "-- GERADO por santana-conversation-domain/tools/emit_roundtrip.ts — nao editar a mao.",
    "-- Round-trip: reducer TypeScript -> diff -> RPC 0020 -> conv_state_canonical.",
    "-- Gate: 22/22 cenarios (C01-C16 + D1-D6) com estado identico ao do reducer.",
    "\\set ON_ERROR_STOP on",
    "begin;",
    "",
    "\\ir _helpers.sql",
    "\\ir fixtures/conv_roundtrip_fixture.sql",
    "",
  ];

  let scenarioIndex = 0;
  for (const scenario of scenarios) {
    const session = sessionUuid(scenarioIndex);
    scenarioIndex += 1;
    const map: IdMap = newIdMap(scenarioIndex);
    const subjects = new Map<string, string>();
    const resolver = (ref: string) => ({ hmac: subjects.get(ref) ?? "", key_version: IDENTITY_KEY_VERSION });

    for (const step of scenario.steps) {
      if (step.kind === "event" && step.event.case_ref && !subjects.has(step.event.case_ref)) {
        subjects.set(step.event.case_ref, await hmac(step.event.case_ref));
      }
    }

    let state: ConversationState = initState(scenario.name);
    let seq = 0;
    out.push(`-- ---------------- ${scenario.name} ----------------`);
    for (const [stepIndex, step] of scenario.steps.entries()) {
      const before = state;
      state = step.kind === "event"
        ? applyEvent(before, step.event)
        : applyAuthoritativeSignal(before, { facts: step.facts });
      const ops = diffTransition(before, state, map, resolver);
      const canonical = canonicalState(state, map, resolver);
      const stateHash = await sha256(canonical);
      const idem = await sha256(`${scenario.name}:${stepIndex}:${JSON.stringify(ops)}`);
      const transition = {
        event_kind: step.kind === "event" ? step.event.kind : "AUTHORITATIVE_SIGNAL",
        catalog_hash: CATALOG_HASH,
        state_hash: stateHash,
        ops,
      };
      const expectedSeq = seq;
      seq += 1;
      // Regra do chamador: qualquer transicao que carregue fato autoritativo — inclusive
      // o sinal interno de conclusao de subfluxo — entra pela RPC de autoridade, que
      // exige um registro de sinal com origem externa e ator declarado.
      const authoritativeCodes = ops
        .filter((o) => o.op === "record_fact" && o.authoritative === true)
        .map((o) => String(o.fact_code));
      if (step.kind === "event" && authoritativeCodes.length > 0) {
        const signal = {
          source: "SYSTEM",
          actor: "conclusao-subfluxo-recadastro",
          covered_fact_codes: authoritativeCodes,
        };
        out.push(
          `select pg_temp.assert_true((support_vnext_shadow.conv_apply_authoritative_signal('${session}'::uuid, ${expectedSeq}, ` +
            `${sqlLiteral(JSON.stringify(signal))}::jsonb, ${
              sqlLiteral(JSON.stringify(transition))
            }::jsonb, '${idem}')->>'seq')::bigint = ${seq},` +
            ` '${scenario.name} step ${stepIndex + 1}: sinal interno autoritativo aplicado');`,
        );
      } else if (step.kind === "event") {
        out.push(
          `select pg_temp.assert_true((support_vnext_shadow.conv_apply_transition('${session}'::uuid, ${expectedSeq}, ` +
            `${sqlLiteral(JSON.stringify(transition))}::jsonb, '${idem}')->>'seq')::bigint = ${seq},` +
            ` '${scenario.name} step ${stepIndex + 1}: transicao aplicada');`,
        );
      } else {
        const signal = {
          source: step.facts[0]?.source ?? "SYSTEM",
          actor: "administracao-teste",
          covered_fact_codes: step.facts.map((f) => f.code),
        };
        out.push(
          `select pg_temp.assert_true((support_vnext_shadow.conv_apply_authoritative_signal('${session}'::uuid, ${expectedSeq}, ` +
            `${sqlLiteral(JSON.stringify(signal))}::jsonb, ${
              sqlLiteral(JSON.stringify(transition))
            }::jsonb, '${idem}')->>'seq')::bigint = ${seq},` +
            ` '${scenario.name} step ${stepIndex + 1}: sinal autoritativo aplicado');`,
        );
      }
    }
    const finalCanonical = canonicalState(state, map, resolver);
    out.push(
      `select pg_temp.assert_true(support_vnext_shadow.conv_state_canonical('${session}'::uuid) = ` +
        `${sqlLiteral(finalCanonical)}, '${scenario.name}: estado persistido identico ao do reducer');`,
      "",
    );
  }

  out.push(
    `select pg_temp.assert_true((select count(*) from support_vnext_shadow.conv_conversation_state) = ${scenarios.length},`,
    `  'round-trip cobriu ${scenarios.length} cenarios');`,
    "commit;",
    "",
  );

  await Deno.writeTextFile(
    new URL("../../tests/postgres/p23_roundtrip_generated.sql", import.meta.url),
    out.join("\n"),
  );
  console.log(`p23_roundtrip_generated.sql: ${scenarios.length} cenarios`);
}

await main();
