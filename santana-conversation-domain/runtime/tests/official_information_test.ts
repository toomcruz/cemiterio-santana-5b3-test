import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { type ConversationState, type FactRecord, initState } from "../../engine/engine.ts";
import { loadOfficialInformationCatalog, officialInformationReply } from "../official_information.ts";
import { carregarDeBytes } from "../../../santana-authority-gateway/catalogo/carregar.ts";
import { consultar } from "../../../santana-authority-gateway/gateway.ts";

function waitingExhumation(): ConversationState {
  const state = initState("information-test");
  state.current_topic = "EXUMACAO";
  state.cases.push({ case_id: "case-current", subject_kind: "DECEASED", subject_ref: "current", opened_at_seq: 1 });
  state.goals.push({
    goal_id: "exhumation-current",
    goal_code: "GOAL_EXUMACAO",
    case_id: "case-current",
    status: "WAITING",
    status_reason: "AUTHORITATIVE_SIGNAL_REQUIRED",
    parent_goal_id: null,
    overlay_of: null,
    stack_index: 0,
    informational: false,
    return_to_parent: false,
    opened_at_seq: 1,
    closed_at_seq: null,
    created_by_relation: null,
  });
  state.pending_actions.push({
    action_code: "ACTION_COLLECT_EXHUMATION_AUTHORIZATION",
    executor: "HUMAN",
    goal_id: "exhumation-current",
    requested_at_seq: 2,
  });
  return state;
}

function spouse(caseId: string, value: string): FactRecord {
  return {
    fact_id: `spouse-${caseId}`,
    fact_code: "surviving_spouse_status",
    case_id: caseId,
    goal_id: null,
    value,
    source: "USER_EXPLICIT",
    confidence: "CONFIRMED",
    status: "ACTIVE",
    recorded_at_seq: 2,
    superseded_by: null,
    superseded_at_seq: null,
    supersession_reason: null,
    conflicts_with: null,
    authoritative: false,
    derived_from: [],
  };
}

Deno.test({
  name: "official information executes in an Edge with no filesystem, environment or network permissions",
  permissions: { read: false, env: false, net: false },
  fn: async () => {
    const result = await officialInformationReply({
      text: "O que é ossuário?",
      state: initState("new"),
      referenceDate: "2026-09-09",
    });
    assertEquals(result?.status, "AVAILABLE");
    assertEquals(result?.authority?.source_id, "SRC_DOMAIN_TOPICS_V1");
    assert(result?.text.includes("destino possivel"));
    assert((await loadOfficialInformationCatalog()).release_id.startsWith("exu-1.0-"));
  },
});

Deno.test("parallel price question preserves the waiting case and cannot choose the ossuary destination tariff", async () => {
  const state = waitingExhumation();
  state.facts.push({
    ...spouse("case-current", "OSSUARIO"),
    fact_id: "destination",
    fact_code: "transport_destination",
  });
  const before = JSON.stringify(state);
  const result = await officialInformationReply({
    text: "Quais são os valores da exumação para ossuário?",
    state,
    referenceDate: "2026-09-09",
  });
  assertEquals(result?.status, "NEEDS_CONTEXT");
  assertEquals(result?.authority?.valor, null);
  assertEquals(result?.authority?.contexto_faltante, ["modalidade_tarifaria"]);
  assertEquals(result?.preserves_goal, true);
  assertEquals(result?.administration_required, true);
  assert(!result?.text.includes("R$"));
  assertEquals(JSON.stringify(state), before);
});

Deno.test("explicit tariff terminology still cannot resolve the unapproved mapping or table validity", async () => {
  const result = await officialInformationReply({
    text: "Qual valor da exumação de sepultura em cessão de gaveta unitária a prazo fixo?",
    state: waitingExhumation(),
    referenceDate: "2026-09-09",
  });
  assertEquals(result?.status, "NEEDS_CONTEXT");
  assertEquals(result?.authority?.valor, null);
  assert(result?.text.includes("vigência"));
});

Deno.test("current waiting case supplies confirmed spouse context and not facts from another deceased", async () => {
  const state = waitingExhumation();
  state.facts.push(spouse("case-other", "VIVO"), spouse("case-current", "FALECIDO"));
  const result = await officialInformationReply({ text: "Quem assina a autorização da exumação?", state });
  assertEquals(result?.authority?.entry_id, "EXU_ASSINATURA_SEM_CONJUGE");
  assert(result?.text.startsWith("Sem conjuge sobrevivente"));
});

Deno.test("uncertain spouse information uses the approved general explanation", async () => {
  const state = waitingExhumation();
  state.facts.push({ ...spouse("case-current", "VIVO"), confidence: "UNCERTAIN" });
  const result = await officialInformationReply({ text: "Quem assina a autorização da exumação?", state });
  assertEquals(result?.authority?.entry_id, "EXU_ASSINATURA_GERAL");
});

Deno.test("past resolved informational goal does not erase the context of the waiting exhumation", async () => {
  const state = waitingExhumation();
  state.facts.push(spouse("case-current", "VIVO"));
  state.goals.push({
    ...state.goals[0]!,
    goal_id: "old-information",
    goal_code: "GOAL_INFO_OSSUARIO",
    status: "RESOLVED",
    case_id: null,
    stack_index: 1,
    closed_at_seq: 2,
    informational: true,
  });
  const result = await officialInformationReply({ text: "Quem assina a autorização?", state });
  assertEquals(result?.authority?.entry_id, "EXU_ASSINATURA_CONJUGE_VIVO");
});

for (
  const text of [
    "Quais documentos preciso para a exumação?",
    "Qual é o prazo da exumação?",
    "Como funciona a exumação?",
  ]
) {
  Deno.test(`missing official content is explicit: ${text}`, async () => {
    const result = await officialInformationReply({ text, state: waitingExhumation() });
    assertEquals(result?.status, "NOT_AVAILABLE");
    assertEquals(result?.authority?.valor, null);
    assertEquals(result?.authority?.motivo, "SEM_FONTE_OFICIAL_CARREGADA");
    assert(result?.text.includes("Ainda não tenho"));
    assert(!result?.text.includes("encaminhei"));
  });
}

for (
  const text of [
    "Qual o horário de atendimento?",
    "Quanto custa o recadastro?",
    "Quais documentos para concessão?",
    "Quanto custa o ossuário?",
  ]
) {
  Deno.test(`another service cannot borrow exhumation prices or rules: ${text}`, async () => {
    const result = await officialInformationReply({ text, state: waitingExhumation() });
    assertEquals(result?.status, "NOT_AVAILABLE");
    assertEquals(result?.authority, null);
    assert(!result?.text.includes("R$"));
  });
}

for (
  const text of [
    "Corrigindo: a exumação será para cremação. Qual o valor?",
    "Quero cancelar a exumação, quanto custa?",
    "Quero falar com um atendente sobre o preço da exumação",
    "Quero realizar a exumação, quais documentos?",
    "A exumação da minha tia também: quais documentos?",
    "Quero iniciar outro atendimento. Qual preço da exumação?",
    "Já enviei meu documento, qual o prazo?",
    "Não",
    "Ossuário",
    "Quero colocar nas gavetas",
    "Meu pai faleceu",
  ]
) {
  Deno.test(`information lane preserves operational input: ${text}`, async () => {
    assertEquals(await officialInformationReply({ text, state: waitingExhumation() }), null);
  });
}

Deno.test("human-owned context does not receive an automatic informational response", async () => {
  const state = waitingExhumation();
  state.handoff = {
    requested_at_seq: 3,
    goal_code: "GOAL_EXUMACAO",
    goal_status: "WAITING",
    case_id: "case-current",
    current_step: "WAITING",
    confirmed_facts: [],
    pending_facts: [],
    current_question: null,
    essential_context: { goal_stack: [], open_overlays: [], pending_actions: [] },
  };
  assertEquals(await officialInformationReply({ text: "Quem assina a exumação?", state }), null);
});

Deno.test("injected byte loader retains Gateway fail-closed filtering of unapproved sources", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    schema_version: "1.0",
    topic: "EXUMACAO",
    fontes: [{ source_id: "UNAPPROVED", tipo: "TEST", referencia: "test", aprovada: false }],
    tipos_de_informacao: {
      PROCEDIMENTO_ADMINISTRATIVO: { forma_do_valor: "TEXTO_CONTEXTUAL", exige_fonte_oficial: true },
    },
    entradas: [{
      entry_id: "UNAPPROVED_TEXT",
      source_id: "UNAPPROVED",
      tipo_informacao: "PROCEDIMENTO_ADMINISTRATIVO",
      valor: { texto: "must not leak" },
    }],
  }));
  const catalog = await carregarDeBytes(bytes, new Map());
  const result = await consultar("PROCEDIMENTO_ADMINISTRATIVO", {}, "2026-09-09", () => Promise.resolve(catalog));
  assertEquals(result.status, "NOT_AVAILABLE");
  assertEquals(result.valor, null);
});
