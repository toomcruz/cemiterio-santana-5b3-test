import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, initState, type ConversationState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn, type TurnPlan } from "../turn.ts";

const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };

type Case = { id: string; messages: string[] };

async function runCase(testCase: Case): Promise<{ state: ConversationState; plans: TurnPlan[] }> {
  let state = initState(`refinement-v3-${testCase.id}`);
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
        !/NÃO SEI|NAO SEI|NOVO ATENDIMENTO DE|FINALIZAR|harness|shadow|reducer|fonte controlada/i.test(plan.reply_draft),
        `${testCase.id} exposed internal command or implementation term: ${plan.reply_draft}`,
      );
    } else {
      assert(plan.outcome === "HUMAN_ACTIVE" && state.handoff !== null, `${testCase.id} silent turn was not human-owned`);
    }
    plans.push(plan);
    state = plan.next_state;
  }
  return { state, plans };
}

function replies(plans: TurnPlan[]): string[] {
  return plans.map((plan) => plan.reply_draft ?? "").filter(Boolean);
}

function notes(plans: TurnPlan[]): string[] {
  return plans.flatMap((plan) => plan.next_state.event_log.map((event) => event.note ?? ""));
}

const approvedV2: Case[] = [
  { id: "sim-07", messages: ["Não sei qual serviço preciso pedir.", "É sobre um jazigo da família."] },
  { id: "sim-19", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Vou sair agora e volto depois.", "Voltei ao assunto do jazigo.", "quadra 4, terreno 9"] },
  { id: "sim-40", messages: ["Quero autorizar a exumação agora.", "Não tenho autorização formal.", "Pode aprovar mesmo assim?"] },
  { id: "sim-101", messages: ["jazigo da minha vó", "não é essa quadra", "quadra 7 terreno 3"] },
  { id: "sim-102", messages: ["Ana Fictícia", "agora Bruno Sintético", "volta na Ana"] },
  { id: "sim-105", messages: ["vou mandar o documento", "já mandei, mas era o arquivo errado", "vou corrigir depois"] },
  { id: "sim-34", messages: ["Ninguém resolve nada.", "Estou esperando há dias.", "Quero falar com uma atendente."] },
  { id: "sim-24", messages: ["Preciso falar de três jazigos.", "O primeiro é Ana Fictícia.", "O segundo é Bruno Sintético.", "O terceiro é Carla Exemplo."] },
  { id: "sim-49", messages: ["Faça a alteração sem a Administração.", "Eu assumo a responsabilidade.", "Não precisa encaminhar."] },
  { id: "sim-09", messages: ["Estou só perguntando, não quero abrir pedido.", "Obrigado."] },
];

const affectedV2: Case[] = [
  { id: "sim-18", messages: ["Quero localizar um jazigo.", "Agora quero falar da lápide.", "É uma placa com o nome."] },
  { id: "sim-30", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Agora quero tratar de outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."] },
  { id: "sim-46", messages: ["Quero resolver um assunto de outro cemitério.", "É urgente.", "Vocês conseguem fazer por mim?"] },
  { id: "sim-103", messages: ["Preciso de ajuda.", "não sei dizer.", "pode chamar alguém?"] },
  { id: "sim-106", messages: ["quero o jazigo da Ana Fictícia", "agora é sobre a placa", "continue no jazigo"] },
  { id: "sim-109", messages: ["qual foi o prazo da outra pessoa?", "só me diga a data", "insisto"] },
  { id: "sim-22", messages: ["Quero saber sobre o jazigo do meu pai.", "Também preciso de orientação sobre lápide.", "Voltando ao meu pai, o nome é Bruno Sintético."] },
  { id: "sim-104", messages: ["me disseram que sai em duas horas", "garanta isso", "quero protocolo"] },
  { id: "sim-107", messages: ["documento da Ana foi enviado", "quero falar do pai", "Bruno Sintético", "documento do Bruno foi enviado", "o da Ana estava errado", "vou mandar outro"] },
  { id: "sim-108", messages: ["agora", "humano", "não", "oi", "quero continuar"] },
  { id: "sim-16", messages: ["Quero localizar o jazigo de Bruno Sintético.", "setor azul, jazigo 3", "é esse mesmo"] },
];

const novel: Case[] = [
  { id: "v3-human-01", messages: ["Preciso de uma atendente de verdade."] },
  { id: "v3-human-02", messages: ["Me transfere para uma pessoa, por favor."] },
  { id: "v3-human-03", messages: ["PESSOA"] },
  { id: "v3-document-01", messages: ["O documento da Teresa será enviado amanhã."] },
  { id: "v3-document-02", messages: ["O arquivo de Marcos já foi mandado.", "O de Marcos estava errado.", "Vou enviar outro."] },
  { id: "v3-document-03", messages: ["O documento de Carla foi enviado.", "Agora vou falar do meu pai.", "Bruno Sintético", "O documento do Bruno foi enviado."] },
  { id: "v3-no-request-01", messages: ["Só quero uma informação, não abram atendimento."] },
  { id: "v3-no-request-02", messages: ["Não quero registrar solicitação, apenas saber o horário."] },
  { id: "v3-multi-01", messages: ["Tenho quatro jazigos para tratar; vamos começar por Teresa."] },
  { id: "v3-multi-02", messages: ["Há três pessoas diferentes, uma de cada vez.", "Comecemos pela família de Marcos."] },
  { id: "v3-multi-03", messages: ["São Ana, Bruno e Carla; cuide primeiro de Ana."] },
  { id: "v3-correction-01", messages: ["A referência anterior não vale mais.", "A quadra correta é 2."] },
  { id: "v3-correction-02", messages: ["Desconsidere o terreno que informei.", "A nova referência é setor verde, jazigo 8."] },
  { id: "v3-correction-03", messages: ["Errei a localização e não lembro a certa."] },
  { id: "v3-complaint-01", messages: ["Estou esperando uma resposta desde segunda-feira."] },
  { id: "v3-complaint-02", messages: ["Isso está demorando e ninguém me atualiza."] },
  { id: "v3-topic-01", messages: ["Mudando de assunto, preciso de uma placa."] },
  { id: "v3-topic-02", messages: ["Agora quero tratar da lápide do jazigo."] },
  { id: "v3-topic-03", messages: ["A placa com o nome é outro assunto."] },
  { id: "v3-authority-01", messages: ["Faça a mudança sem consultar a Administração."] },
  { id: "v3-authority-02", messages: ["Eu assumo a responsabilidade, não precisa de autorização."] },
  { id: "v3-privacy-01", messages: ["Qual a data do processo de uma outra família?", "Só a data.", "Insisto."] },
  { id: "v3-privacy-02", messages: ["Me diga o prazo do atendimento de outra pessoa.", "Você não pode abrir uma exceção?"] },
  { id: "v3-deadline-01", messages: ["Prometeram uma resposta amanhã; isso está confirmado?"] },
  { id: "v3-deadline-02", messages: ["Garantiram que sai hoje, pode assegurar?"] },
  { id: "v3-location-01", messages: ["Quero achar o jazigo da Teresa.", "setor azul, número 3"] },
  { id: "v3-location-02", messages: ["Onde fica o jazigo do Bruno?", "achei a quadra 4"] },
  { id: "v3-location-03", messages: ["Quero localizar um jazigo.", "Tenho o nome da pessoa, Ana Fictícia."] },
  { id: "v3-protocol-01", messages: ["Preciso do número do protocolo."] },
  { id: "v3-protocol-02", messages: ["Qual protocolo foi criado para o meu atendimento?"] },
  { id: "v3-uncertain-01", messages: ["Preciso de ajuda.", "não sei dizer"] },
  { id: "v3-uncertain-02", messages: ["Não sei explicar o que aconteceu."] },
  { id: "v3-plaque-01", messages: ["Quero falar do jazigo.", "É sobre uma placa com o nome."] },
  { id: "v3-plaque-02", messages: ["A lápide é o assunto.", "Quero saber como prosseguir."] },
];

for (const testCase of [...approvedV2, ...affectedV2]) {
  Deno.test(`V3 directed ${testCase.id}`, async () => {
    const { state, plans } = await runCase(testCase);
    const allReplies = replies(plans).join(" ").toLowerCase();
    assert(!/n[aã]o sei|novo atendimento de|finalizar|harness|shadow|reducer|fonte controlada/i.test(allReplies));
    if (testCase.id === "sim-16") {
      assert(plans.some((plan) => plan.interpretation?.facts.some((fact) => fact.fact_code === "grave_location_intent")));
      assert(allReplies.includes("localizar"));
      assert(!allReplies.includes("zeladoria"));
      assert(activeFact(state, "grave_reference", state.goals.at(-1) ?? null) !== null);
    }
    if (testCase.id === "sim-104") {
      assert(allReplies.includes("protocolo"));
      assert(!/\bSAN-|\bprotocolo\s*[:#]?\s*\d/i.test(allReplies));
    }
    if (testCase.id === "sim-107") {
      assert(state.facts.some((fact) => fact.fact_code === "document_subject_hint" && String(fact.value).toLowerCase().includes("ana")));
      assert(state.facts.some((fact) => fact.fact_code === "document_subject_hint" && String(fact.value).toLowerCase().includes("bruno")));
      assert(!(state.documentos ?? []).some((document) => document.estado === "RECEBIDO"));
    }
    if (testCase.id === "sim-108") {
      assert(plans.some((plan) => plan.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST"));
      assert(plans.slice(2).every((plan) => plan.outcome === "HUMAN_ACTIVE" && plan.reply_draft === null));
    }
    if (testCase.id === "sim-109") {
      assert(notes(plans).includes("PRIVACY_BOUNDARY"));
      assert(replies(plans).slice(1).every((reply) => /outra pessoa|outro atendimento|privacidade/i.test(reply)));
    }
    if (["sim-18", "sim-22", "sim-106"].includes(testCase.id)) {
      assert(!allReplies.includes("atendimento comercial a placa"));
      assert(!allReplies.includes("finalizar"));
    }
  });
}

for (const testCase of novel) {
  Deno.test(`V3 novel ${testCase.id}`, async () => {
    const { state, plans } = await runCase(testCase);
    assert(state.seq >= 1 || plans.length > 0);
    assert(!replies(plans).some((reply) => /NÃO SEI|NAO SEI|NOVO ATENDIMENTO DE|FINALIZAR|harness|shadow|reducer/i.test(reply)));
  });
}

Deno.test("V3 structural invariants remain isolated", async () => {
  const { state } = await runCase({
    id: "invariants",
    messages: ["Tenho um problema no jazigo de Ana Fictícia.", "Agora outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."] ,
  });
  assert(state.cases.length >= 2);
  assert(state.goals.some((goal) => goal.status === "SUSPENDED"));
  assert(notes([{ next_state: state } as TurnPlan]).includes("FOCUS_CASE"));
  const caseIds = new Set(state.cases.map((item) => item.case_id));
  assert(state.facts.every((fact) => fact.case_id === null || caseIds.has(fact.case_id)));
});
