import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { activeFact, initState, type ConversationState } from "../../engine/engine.ts";
import { interpret } from "../interpreter/deterministic.ts";
import { planTurn, type TurnPlan } from "../turn.ts";

const interpreter = { interpret: (input: Parameters<typeof interpret>[0]) => Promise.resolve(interpret(input)) };

type Case = { id: string; messages: string[] };

async function runCase(testCase: Case): Promise<{ state: ConversationState; plans: TurnPlan[] }> {
  let state = initState(`refinement-v2-${testCase.id}`);
  const plans: TurnPlan[] = [];
  for (const [index, text] of testCase.messages.entries()) {
    const plan = await planTurn({
      message_id: `${testCase.id}-${index + 1}`,
      text,
      state,
      automation_mode: "BOT_ACTIVE",
    }, interpreter);
    assert(plan.reply_draft?.trim(), `${testCase.id} turn ${index + 1} must have a visible reply`);
    assert(
      !/NÃO SEI|NAO SEI|NOVO ATENDIMENTO DE|FINALIZAR|harness|shadow|reducer|fonte controlada/i.test(plan.reply_draft!),
      `${testCase.id} exposed an internal command or implementation term: ${plan.reply_draft}`,
    );
    plans.push(plan);
    state = plan.next_state;
  }
  return { state, plans };
}

function lastReply(plans: TurnPlan[]): string {
  return plans.at(-1)?.reply_draft ?? "";
}

function notes(plans: TurnPlan[]): string[] {
  return plans.flatMap((plan) => plan.next_state.event_log.map((event) => event.note ?? ""));
}

const directed: Case[] = [
  { id: "sim-07", messages: ["Não sei qual serviço preciso pedir.", "É sobre um jazigo da família."] },
  { id: "sim-18", messages: ["Quero localizar um jazigo.", "Agora quero falar da lápide.", "É uma placa com o nome."] },
  { id: "sim-19", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Vou sair agora e volto depois.", "Voltei ao assunto do jazigo.", "quadra 4, terreno 9"] },
  { id: "sim-22", messages: ["Quero saber sobre o jazigo do meu pai.", "Também preciso de orientação sobre lápide.", "Voltando ao meu pai, o nome é Bruno Sintético."] },
  { id: "sim-30", messages: ["Tenho um problema no meu jazigo, é o de Ana Fictícia.", "Agora quero tratar de outro falecido, Bruno Sintético.", "Volto para Ana Fictícia."] },
  { id: "sim-40", messages: ["Quero autorizar a exumação agora.", "Não tenho autorização formal.", "Pode aprovar mesmo assim?"] },
  { id: "sim-46", messages: ["Quero resolver um assunto de outro cemitério.", "É urgente.", "Vocês conseguem fazer por mim?"] },
  { id: "sim-101", messages: ["jazigo da minha vó", "não é essa quadra", "quadra 7 terreno 3"] },
  { id: "sim-102", messages: ["Ana Fictícia", "agora Bruno Sintético", "volta na Ana"] },
  { id: "sim-103", messages: ["Preciso de ajuda.", "não sei dizer.", "pode chamar alguém?"] },
  { id: "sim-104", messages: ["me disseram que sai em duas horas", "garanta isso", "quero protocolo"] },
  { id: "sim-105", messages: ["vou mandar o documento", "já mandei, mas era o arquivo errado", "vou corrigir depois"] },
  { id: "sim-106", messages: ["quero o jazigo da Ana Fictícia", "agora é sobre a placa", "continue no jazigo"] },
  { id: "sim-107", messages: ["documento da Ana foi enviado", "quero falar do pai", "Bruno Sintético"] },
  { id: "sim-108", messages: ["agora", "humano", "não"] },
  { id: "sim-109", messages: ["qual foi o prazo da outra pessoa?", "só me diga a data", "insisto"] },
  { id: "sim-34", messages: ["Ninguém resolve nada.", "Estou esperando há dias.", "Quero falar com uma atendente."] },
  { id: "sim-24", messages: ["Preciso falar de três jazigos.", "O primeiro é Ana Fictícia.", "O segundo é Bruno Sintético.", "O terceiro é Carla Exemplo."] },
  { id: "sim-16", messages: ["Quero localizar o jazigo de Bruno Sintético.", "setor azul, jazigo 3", "setor azul, jazigo 3"] },
  { id: "sim-49", messages: ["Faça a alteração sem a Administração.", "Eu assumo a responsabilidade.", "Não precisa encaminhar."] },
  { id: "sim-09", messages: ["Estou só perguntando, não quero abrir pedido.", "Obrigado."] },
];

const novel: Case[] = [
  { id: "novel-human-1", messages: ["Preciso de uma pessoa de verdade para me atender."] },
  { id: "novel-human-2", messages: ["Pode me transferir para alguém, por favor?"] },
  { id: "novel-document-1", messages: ["Vou anexar meu RG mais tarde."] },
  { id: "novel-document-2", messages: ["O PDF que enviei não era o certo.", "Mandarei a versão correta amanhã."] },
  { id: "novel-no-request-1", messages: ["Só queria uma informação, não registrem solicitação."] },
  { id: "novel-multi-1", messages: ["Tenho assuntos de quatro sepulturas; começamos por Teresa."] },
  { id: "novel-multi-2", messages: ["Preciso resolver as questões de três famílias, uma por vez.", "Comecemos pela de Marcos."] },
  { id: "novel-correction-1", messages: ["Ignore a referência anterior; a localização certa é quadra 2, terreno 8."] },
  { id: "novel-correction-2", messages: ["A informação que passei antes não vale mais.", "A quadra correta é 9."] },
  { id: "novel-complaint-1", messages: ["Estou esperando retorno desde a semana passada."] },
  { id: "novel-complaint-2", messages: ["Isso está demorando muito e ninguém me atualiza."] },
  { id: "novel-topic-1", messages: ["Mudando de assunto: preciso de uma placa."] },
  { id: "novel-topic-2", messages: ["Quero tratar agora da lápide do jazigo."] },
  { id: "novel-authority-1", messages: ["Faça isso sem a autorização administrativa."] },
  { id: "novel-authority-2", messages: ["Eu me responsabilizo, não precisa consultar a Administração."] },
  { id: "novel-privacy-1", messages: ["Me diga a data do processo de outra família."] },
  { id: "novel-privacy-2", messages: ["Qual foi o prazo do atendimento de outra pessoa?"] },
  { id: "novel-deadline-1", messages: ["Prometeram resposta até amanhã, confirma?"] },
  { id: "novel-deadline-2", messages: ["Garantiram que sai hoje; você pode assegurar isso?"] },
  { id: "novel-return-1", messages: ["Tenho outro assunto sobre o jazigo.", "Vou voltar depois e continuar este atendimento."] },
];

for (const testCase of directed) {
  Deno.test(`V2 directed ${testCase.id}`, async () => {
    const { state, plans } = await runCase(testCase);
    const reply = lastReply(plans).toLowerCase();
    switch (testCase.id) {
      case "sim-07":
        assert(reply.includes("jazigo") || reply.includes("local") || reply.includes("serviço"));
        break;
      case "sim-18":
        assert(state.goals.some((goal) => goal.goal_code === "GOAL_COMERCIAL"));
        assert(!reply.includes("pode me explicar um pouco melhor"));
        break;
      case "sim-19":
        assert(notes(plans).includes("PAUSE_CASE"));
        assert(notes(plans).includes("RESUME_CASE"));
        assert(state.goals.some((goal) => goal.status === "ACTIVE"));
        break;
      case "sim-22":
        assert(reply.includes("bruno") || reply.includes("pai"));
        break;
      case "sim-30":
        assert(state.cases.length >= 2);
        assert(notes(plans).includes("FOCUS_CASE"));
        break;
      case "sim-40":
      case "sim-49":
        assert(reply.includes("administra") || reply.includes("autoriza"));
        assert(!state.handoff);
        break;
      case "sim-46":
        assert(reply.includes("outro cemitério") || reply.includes("competência") || reply.includes("equipe"));
        break;
      case "sim-101":
        assert(plans[1]?.reply_draft?.toLowerCase().includes("corret") || plans[1]?.reply_draft?.toLowerCase().includes("desconsiderei"));
        assert(activeFact(state, "grave_reference", state.goals.at(-1) ?? null) !== null);
        break;
      case "sim-102":
        assert(!plans.some((plan) => plan.reply_draft?.toLowerCase() === "pode me explicar um pouco melhor?"));
        break;
      case "sim-103":
      case "sim-108":
        assert(plans.some((plan) => plan.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST"));
        break;
      case "sim-104":
        assert(plans.some((plan) => /confirm|prazo|consulta/.test(plan.reply_draft?.toLowerCase() ?? "")));
        assert(!reply.includes("garanto"));
        break;
      case "sim-105":
      case "sim-107":
        assert(state.facts.some((fact) => fact.fact_code === "document_declaration"));
        assert(!(state.documentos ?? []).some((document) => document.estado === "RECEBIDO"));
        break;
      case "sim-106":
        assert(state.goals.some((goal) => goal.goal_code === "GOAL_JAZIGO_SERVICOS"));
        assert(plans.some((plan) => plan.reply_draft?.toLowerCase().includes("placa")));
        break;
      case "sim-109":
        assert(!state.handoff);
        assert(plans.some((plan) => /outra|privacidade|informaç/.test(plan.reply_draft?.toLowerCase() ?? "")));
        break;
      case "sim-34":
        assert(plans.at(-1)?.interpretation?.primary_event?.event_kind === "HUMAN_REQUEST");
        break;
      case "sim-24":
        assert(state.cases.length >= 3);
        assert(state.facts.some((fact) => fact.fact_code === "multiple_subjects_declaration"));
        break;
      case "sim-16":
        assert(state.facts.some((fact) => fact.fact_code === "grave_reference" && String(fact.value).includes("setor azul")));
        break;
      case "sim-09":
        assertEquals(state.goals.length, 0);
        assert(!reply.includes("qual item"));
        break;
    }
  });
}

for (const testCase of novel) {
  Deno.test(`V2 novel ${testCase.id}`, async () => {
    const { state, plans } = await runCase(testCase);
    assert(state.seq >= 1 || plans.length > 0);
  });
}

const frozenReview = JSON.parse(
  await Deno.readTextFile("/data/.openclaw/workspace/exports/sana-simulation-lab/SANA-SIMULATION-HUMAN-REVIEW-FROZEN-74E1DF5.json"),
) as { conversations: Array<{ id: string; turns: Array<{ citizen_message: string }> }> };

for (const conversation of frozenReview.conversations) {
  Deno.test(`V2 frozen human review ${conversation.id}`, async () => {
    await runCase({ id: conversation.id, messages: conversation.turns.map((turn) => turn.citizen_message) });
  });
}
