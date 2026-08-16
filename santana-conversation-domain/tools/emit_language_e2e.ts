// Gera tests/postgres/p26_language_e2e_generated.sql:
// mensagem em pt-BR -> interpretacao -> guarda -> reducer -> transition -> RPC 0020
// -> conv_state_canonical. Prova que a camada de linguagem nao contorna o dominio.
// Executar: deno run --allow-read --allow-write santana-conversation-domain/tools/emit_language_e2e.ts

import { applyEvent, type ConversationState, initState } from "../engine/persistence_deps.ts";
import { canonicalState, diffTransition, type IdMap, newIdMap } from "../engine/persistence.ts";
import { interpret } from "../runtime/interpreter/deterministic.ts";
import { guardInterpretation } from "../runtime/interpreter/guard.ts";
import { contextFromState, toConversationEvents } from "../runtime/interpreter/bridge.ts";

const CATALOG_HASH = "a".repeat(64);
const IDENTITY_KEY_VERSION = 1;
const TEST_IDENTITY_SECRET = "5b4c-language-identity-secret";
const encoder = new TextEncoder();

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TEST_IDENTITY_SECRET),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
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

interface Conversation {
  name: string;
  hints: string[];
  messages: { id: string; text: string; expect_clarification?: boolean }[];
}

const conversations: Conversation[] = [
  {
    name: "L01-transporte-direto",
    hints: ["meu pai"],
    messages: [
      { id: "L01-1", text: "Meu pai já foi tirado do túmulo e quero levar para outro cemitério" },
      { id: "L01-2", text: "não tenho data ainda, pode ser mês que vem" },
    ],
  },
  {
    name: "L02-correcao",
    hints: ["meu pai"],
    messages: [
      { id: "L02-1", text: "quero fazer o translado do meu pai, ele ainda está sepultado" },
      { id: "L02-2", text: "na verdade me enganei, ele já foi exumado" },
    ],
  },
  {
    name: "L03-pergunta-paralela",
    hints: ["meu pai"],
    messages: [
      { id: "L03-1", text: "quero fazer o translado do meu pai, ele ainda está sepultado" },
      { id: "L03-2", text: "aproveitando, até que horas vocês atendem?" },
    ],
  },
  {
    name: "L04-reclamacao-comercial",
    hints: [],
    messages: [
      { id: "L04-1", text: "paguei a lápide faz meses e até hoje não colocaram, isso é um absurdo" },
    ],
  },
  {
    name: "L05-recadastro-alegado",
    hints: [],
    messages: [
      { id: "L05-1", text: "quero transferir a concessão para meu nome" },
      { id: "L05-2", text: "já fiz o recadastro sim" },
    ],
  },
  {
    name: "L06-ambiguidade-e-autoridade",
    hints: ["meu pai"],
    messages: [
      { id: "L06-1", text: "quero fazer o translado do meu pai, ele ainda está sepultado" },
      { id: "L06-2", text: "a família já autorizou a exumação, pode marcar", expect_clarification: true },
      { id: "L06-3", text: "queria resolver a situação do jazigo", expect_clarification: true },
    ],
  },
];

function sessionUuid(index: number): string {
  // p23 usa 1..22, p24 usa 23; a camada de linguagem comeca em 24.
  return `55555555-0000-4000-8000-${String(24 + index).padStart(12, "0")}`;
}
const sqlLiteral = (value: string) => `$sq$${value}$sq$`;

async function main(): Promise<void> {
  const out: string[] = [
    "-- GERADO por santana-conversation-domain/tools/emit_language_e2e.ts — nao editar a mao.",
    "-- Cadeia completa: mensagem -> interpretacao -> guarda -> reducer -> transition -> banco.",
    "-- Mensagens sinteticas em pt-BR; nenhuma PII real; SHADOW_ONLY.",
    "\\set ON_ERROR_STOP on",
    "begin;",
    "",
    "\\ir _helpers.sql",
    "\\ir fixtures/conv_roundtrip_fixture.sql",
    "",
  ];

  let clarifications = 0;
  let applied = 0;

  for (const [index, conversation] of conversations.entries()) {
    const session = sessionUuid(index);
    const map: IdMap = newIdMap(100 + index);
    const subjects = new Map<string, string>();
    for (const hint of [...conversation.hints, "L04-1", "L05-1", "L06-1"]) {
      subjects.set(hint, await hmac(hint));
    }
    const resolver = (ref: string) => {
      if (!subjects.has(ref)) subjects.set(ref, "");
      return { hmac: subjects.get(ref) ?? "", key_version: IDENTITY_KEY_VERSION };
    };
    // Garante HMAC para qualquer case_ref que o bridge venha a usar.
    for (const message of conversation.messages) subjects.set(message.id, await hmac(message.id));

    let state: ConversationState = initState(conversation.name);
    let seq = 0;
    out.push(`-- ---------------- ${conversation.name} ----------------`);

    for (const message of conversation.messages) {
      const interpretation = guardInterpretation(interpret({
        message_id: message.id,
        text: message.text,
        context: contextFromState(state, conversation.hints),
      }));
      const bridged = toConversationEvents(interpretation);

      if (bridged.events.length === 0) {
        clarifications += 1;
        out.push(
          `-- ${message.id}: sem evento (esclarecimento) — motivo: ${bridged.clarification?.reason ?? "n/a"}`,
        );
        continue;
      }

      for (const [step, event] of bridged.events.entries()) {
        const before = state;
        state = applyEvent(before, event);
        const ops = diffTransition(before, state, map, resolver);
        if (ops.length === 0) continue;
        const canonical = canonicalState(state, map, resolver);
        const stateHash = await sha256(canonical);
        const idem = await sha256(`${conversation.name}:${message.id}:${step}:${JSON.stringify(ops)}`);
        const authoritativeCodes = ops
          .filter((o) => o.op === "record_fact" && o.authoritative === true)
          .map((o) => String(o.fact_code));
        const transition = {
          event_kind: event.kind,
          catalog_hash: CATALOG_HASH,
          state_hash: stateHash,
          ops,
        };
        const expectedSeq = seq;
        seq += 1;
        applied += 1;
        if (authoritativeCodes.length > 0) {
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
              ` '${message.id}: sinal autoritativo interno aplicado');`,
          );
        } else {
          out.push(
            `select pg_temp.assert_true((support_vnext_shadow.conv_apply_transition('${session}'::uuid, ${expectedSeq}, ` +
              `${sqlLiteral(JSON.stringify(transition))}::jsonb, '${idem}')->>'seq')::bigint = ${seq},` +
              ` '${message.id}: transicao da linguagem aplicada');`,
          );
        }
      }
    }

    out.push(
      `select pg_temp.assert_true(support_vnext_shadow.conv_state_canonical('${session}'::uuid) = ` +
        `${
          sqlLiteral(canonicalState(state, map, resolver))
        }, '${conversation.name}: estado persistido igual ao do reducer');`,
      "",
    );
  }

  // Invariante transversal: nenhum fato autoritativo nasceu da linguagem.
  out.push(
    "select pg_temp.assert_true((select count(*) from support_vnext_shadow.conv_facts f",
    "   join support_vnext_shadow.conv_conversation_state s on s.session_id = f.session_id",
    "  where f.session_id in (" +
      conversations.map((_, i) => `'${sessionUuid(i)}'::uuid`).join(", ") +
      ") and f.authoritative and f.source in ('USER_EXPLICIT','USER_CORRECTION')) = 0,",
    "  'nenhum fato de origem de usuario virou autoritativo');",
    "",
    `select pg_temp.assert_true((select count(*) from support_vnext_shadow.conv_events where session_id in (` +
      conversations.map((_, i) => `'${sessionUuid(i)}'::uuid`).join(", ") + `)) = ${applied},`,
    `  'a linguagem produziu exatamente ${applied} transicoes persistidas');`,
    "commit;",
    "",
  );

  await Deno.writeTextFile(
    new URL("../../tests/postgres/p26_language_e2e_generated.sql", import.meta.url),
    out.join("\n"),
  );
  console.log(
    `p26_language_e2e_generated.sql: ${conversations.length} conversas, ${applied} transicoes, ${clarifications} esclarecimentos`,
  );
}

await main();
