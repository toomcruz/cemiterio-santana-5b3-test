import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, initState, type ConversationState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn, type TurnPlan } from "../turn.ts";

const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };

type Case = { id: string; messages: string[] };

async function runCase(testCase: Case): Promise<{ state: ConversationState; plans: TurnPlan[] }> {
  let state = initState(`refinement-v4-${testCase.id}`);
  const plans: TurnPlan[] = [];
  for (const [index, text] of testCase.messages.entries()) {
    const plan = await planTurn({
      message_id: `${testCase.id}-${index + 1}`,
      text,
      state,
      automation_mode: "BOT_ACTIVE",
    }, interpreter);
    if (plan.reply_draft?.trim()) {
      assert(
        !/NÃO SEI|NAO SEI|NOVO ATENDIMENTO DE|FINALIZAR|harness|shadow|reducer|fonte controlada|GOAL_|JAZIGO_/i.test(plan.reply_draft),
        `${testCase.id} exposed internal command or implementation term: ${plan.reply_draft}`,
      );
    } else {
      assert(plan.outcome === "HUMAN_ACTIVE" && plan.next_state.handoff !== null, `${testCase.id} silent turn was not human-owned`);
    }
    plans.push(plan);
    state = plan.next_state;
  }
  return { state, plans };
}

function replies(plans: TurnPlan[]): string[] {
  return plans.map((plan) => plan.reply_draft ?? "");
}

function notes(plans: TurnPlan[]): string[] {
  return plans.flatMap((plan) => plan.next_state.event_log.map((event) => event.note ?? ""));
}

const approvedV3: Case[] = [
  { id: "sim-07", messages: ["Não sei qual serviço preciso pedir.", "É sobre um jazigo da família."] },
  { id: "sim-19", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Vou sair agora e volto depois.", "Voltei ao assunto do jazigo.", "quadra 4, terreno 9"] },
  { id: "sim-40", messages: ["Quero autorizar a exumação agora.", "Não tenho autorização formal.", "Pode aprovar mesmo assim?"] },
  { id: "sim-101", messages: ["jazigo da minha vó", "não é essa quadra", "quadra 7 terreno 3"] },
  { id: "sim-104", messages: ["me disseram que sai em duas horas", "garanta isso", "quero protocolo"] },
  { id: "sim-108", messages: ["agora", "humano", "não", "oi", "quero continuar"] },
  { id: "sim-34", messages: ["Ninguém resolve nada.", "Estou esperando há dias.", "Quero falar com uma atendente."] },
  { id: "sim-24", messages: ["Preciso falar de três jazigos.", "O primeiro é Ana Fictícia.", "O segundo é Bruno Sintético.", "O terceiro é Carla Exemplo."] },
  { id: "sim-49", messages: ["Faça a alteração sem a Administração.", "Eu assumo a responsabilidade.", "Não precisa encaminhar."] },
  { id: "sim-09", messages: ["Estou só perguntando, não quero abrir pedido.", "Obrigado."] },
];

const focused: Case[] = [
  { id: "sim-18", messages: ["Quero localizar um jazigo.", "Agora quero falar da lápide.", "É uma placa com o nome."] },
  { id: "sim-106", messages: ["quero o jazigo da Ana Fictícia", "agora é sobre a placa", "continue no jazigo"] },
  { id: "sim-16", messages: ["Quero localizar o jazigo de Bruno Sintético.", "setor azul, jazigo 3", "setor azul, jazigo 3"] },
  { id: "sim-22", messages: ["Quero saber sobre o jazigo do meu pai.", "Também preciso de orientação sobre lápide.", "Voltando ao meu pai, o nome é Bruno Sintético."] },
  { id: "sim-30", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Agora quero tratar de outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."] },
  { id: "sim-103", messages: ["Preciso de ajuda.", "não sei dizer.", "pode chamar alguém?"] },
  { id: "sim-107", messages: ["documento da Ana foi enviado", "quero falar do pai", "Bruno Sintético", "documento do Bruno foi enviado", "o da Ana estava errado", "vou mandar outro"] },
  { id: "sim-109", messages: ["qual foi o prazo da outra pessoa?", "só me diga a data", "insisto"] },
];

const novel: Case[] = [
  { id: "v4-location-01", messages: ["Quero achar o sepultamento de Teresa.", "quadra 2"] },
  { id: "v4-location-02", messages: ["Onde fica o jazigo do Bruno?", "achei o setor azul, número 3"] },
  { id: "v4-location-03", messages: ["Preciso encontrar o jazigo de Carla.", "é o terreno 8"] },
  { id: "v4-protocol-01", messages: ["Pode me dizer meu protocolo?"] },
  { id: "v4-protocol-02", messages: ["Preciso consultar o número do atendimento."] },
  { id: "v4-document-01", messages: ["O arquivo da Teresa vai ser enviado amanhã."] },
  { id: "v4-document-02", messages: ["Já mandei o arquivo de Marcos, mas estava incorreto.", "Vou reenviar."] },
  { id: "v4-document-03", messages: ["O documento de Carla foi enviado.", "Agora é o atendimento do meu pai.", "Bruno Sintético"] },
  { id: "v4-human-01", messages: ["Atendente, por favor."] },
  { id: "v4-human-02", messages: ["Me chama uma pessoa da equipe."] },
  { id: "v4-human-03", messages: ["Quero falar com alguém de verdade."] },
  { id: "v4-privacy-01", messages: ["Qual a data do processo de outra família?", "Não pode abrir uma exceção?", "Eu insisto nisso."] },
  { id: "v4-privacy-02", messages: ["Me conte o prazo do atendimento de outra pessoa.", "Só uma pista já ajuda."] },
  { id: "v4-topic-01", messages: ["Quero tratar do jazigo.", "Mudando para a placa.", "Voltemos ao jazigo."] },
  { id: "v4-topic-02", messages: ["Também preciso de uma lápide.", "Agora continuo no jazigo."] },
  { id: "v4-uncertain-01", messages: ["Preciso de orientação.", "Não sei dizer o que aconteceu."] },
  { id: "v4-uncertain-02", messages: ["Não lembro qual serviço é.", "Pode me ajudar a escolher?"] },
  { id: "v4-authority-01", messages: ["Dá para fazer sem a Administração?", "Eu me responsabilizo."] },
  { id: "v4-multi-01", messages: ["Tenho três pessoas para tratar.", "Comecemos por Ana.", "Depois Bruno."] },
  { id: "v4-multi-02", messages: ["Há dois jazigos diferentes.", "Quero começar pelo de Carla.", "Volto para o de Teresa."] },
];

for (const testCase of focused) {
  Deno.test(`V4 focused ${testCase.id}`, async () => {
    const { state, plans } = await runCase(testCase);
    const all = replies(plans).join(" ").toLowerCase();
    const rs = replies(plans);
    if (testCase.id === "sim-18") {
      assert(/placa|lápide|lapide/.test(rs[1]!.toLowerCase()));
      assert(!/localizar|localização|localizacao/.test(rs[1]!.toLowerCase()));
      assert(!plans[1]!.interpretation?.facts.some((fact) => fact.fact_code === "grave_location_intent"));
    }
    if (testCase.id === "sim-106") {
      assert(!all.includes("atendimento de atendimento"));
      assert(!all.includes("goal_"));
      assert(rs[1]!.toLowerCase().includes("placa"));
      assert(rs[2]!.toLowerCase().includes("jazigo"));
    }
    if (testCase.id === "sim-16") {
      assert(rs[0]!.includes("Bruno Sintético"));
      assert(rs[2]!.toLowerCase().includes("já está registrada"));
      assert(activeFact(state, "grave_reference", state.goals.at(-1) ?? null) !== null);
      assert(state.facts.some((fact) => fact.fact_code === "deceased_name" && fact.value === "Bruno Sintético"));
    }
    if (testCase.id === "sim-22") {
      assert(replies(plans).at(-1)?.includes("seu pai"));
      assert(replies(plans).at(-1)?.includes("Bruno Sintético"));
    }
    if (testCase.id === "sim-30") {
      assert(notes(plans).includes("FOCUS_CASE"));
      assert(replies(plans).at(-1)?.includes("Ana Fictícia"));
    }
    if (testCase.id === "sim-103") {
      assert(rs[1]!.length < 240);
      assert(plans[2]!.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST");
      assert(plans[2]!.next_state.handoff !== null);
    }
    if (testCase.id === "sim-107") {
      const ana = state.facts.find((fact) => fact.fact_code === "document_subject_hint" && String(fact.value).toLowerCase().includes("ana"));
      const bruno = state.facts.find((fact) => fact.fact_code === "document_subject_hint" && String(fact.value).toLowerCase().includes("bruno"));
      assert(ana !== undefined && bruno !== undefined);
      const brunoName = state.facts.find((fact) => fact.fact_code === "deceased_name" && fact.value === "Bruno Sintético");
      assert(brunoName?.case_id !== null && brunoName?.case_id !== undefined);
      assert(ana?.case_id === null && bruno?.case_id === null);
      assert(brunoName?.case_id !== ana?.case_id);
      assert(!(state.documentos ?? []).some((document) => document.estado === "RECEBIDO"));
    }
    if (testCase.id === "sim-109") {
      assert(notes(plans).includes("PRIVACY_BOUNDARY"));
      assert(new Set(replies(plans)).size === 3);
      assert(replies(plans).every((reply) => /outra pessoa|outro atendimento|data|prazo|privacidade/i.test(reply)));
    }
  });
}

for (const testCase of approvedV3) {
  Deno.test(`V4 approved regression ${testCase.id}`, async () => {
    await runCase(testCase);
  });
}

for (const testCase of novel) {
  Deno.test(`V4 novel ${testCase.id}`, async () => {
    const { plans } = await runCase(testCase);
    assert(plans.length > 0);
  });
}

Deno.test("V4 structural invariants remain isolated and authoritative", async () => {
  const { state, plans } = await runCase({
    id: "invariants",
    messages: ["Tenho um problema no jazigo de Ana Fictícia.", "Agora outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."],
  });
  assert(state.cases.length >= 2);
  assert(state.goals.some((goal) => goal.status === "SUSPENDED"));
  assert(notes(plans).includes("FOCUS_CASE"));
  const caseIds = new Set(state.cases.map((item) => item.case_id));
  assert(state.facts.every((fact) => fact.case_id === null || caseIds.has(fact.case_id)));
});

Deno.test("V4 negative protocol/document/privacy/handoff invariants", async () => {
  const protocol = await runCase({ id: "negative-protocol", messages: ["Quero meu protocolo."] });
  assert(!/\b(?:SAN-|protocolo\s*[:#]?\s*\d{3,})/i.test(replies(protocol.plans).join(" ")));
  const privacy = await runCase({ id: "negative-privacy", messages: ["Qual a data da outra pessoa?", "Só me diga a data."] });
  assert(!/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(replies(privacy.plans).join(" ")));
  const handoff = await runCase({ id: "negative-handoff", messages: ["Quero falar com um atendente.", "Oi"] });
  assert(handoff.plans[0]!.next_state.handoff !== null);
  assert(handoff.plans[1]!.reply_draft === null);
});
