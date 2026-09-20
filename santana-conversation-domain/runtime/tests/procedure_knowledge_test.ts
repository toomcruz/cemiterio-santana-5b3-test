import { assert, assertEquals } from "../../../tests/fixtures/assert.ts";
import { buildPrompt } from "../adapter/prompt.ts";
import { interpret } from "../interpreter/deterministic.ts";
import {
  findProcedure,
  proceduralDirectReply,
  procedureRouteHint,
  procedureRouteHintsForPrompt,
} from "../procedure_knowledge.ts";

function input(text: string, openGoal: string | null = null) {
  return {
    message_id: "procedure-test",
    text,
    context: {
      has_open_goal: openGoal !== null,
      open_goal_code: openGoal,
      pending_question_fact: null,
      known_subject_hints: [],
    },
  };
}

Deno.test("historical procedure names route into existing safe goals", () => {
  const cases = [
    ["Preciso de administração provisória", "ADMINISTRACAO_PROVISORIA", "GOAL_CONCESSAO"],
    ["Quero pagar a taxa de concessão", "CONCESSAO_TAXA", "GOAL_CONCESSAO"],
    ["Meu pai faleceu hoje e temos jazigo da família", "OBITO_RECENTE_COM_JAZIGO", "GOAL_OUTROS_ASSUNTOS"],
    ["Preciso remarcar a exumação", "REMARCACAO_EXUMACAO", "GOAL_EXUMACAO"],
    ["Quero falar com a ouvidoria", "OUVIDORIA", "GOAL_OUTROS_ASSUNTOS"],
    ["Como funciona o translado?", "TRANSLADO_PARA_SANTANA", "GOAL_TRANSPORTE"],
    ["Quero colocar cinzas no jazigo", "CINZAS_EM_JAZIGO", "GOAL_COMERCIAL"],
  ] as const;
  for (const [text, procedure, goal] of cases) {
    const hint = procedureRouteHint(text);
    assertEquals(hint?.procedure_code, procedure);
    assertEquals(hint?.goal_code, goal);
  }
});

Deno.test("deterministic fallback uses procedural routing without inventing business facts", () => {
  const result = interpret(input("Preciso de administração provisória"));
  assertEquals(result.goal?.goal_code, "GOAL_CONCESSAO");
  assertEquals(result.primary_event?.event_kind, "NEW_GOAL");
  assertEquals(result.facts.length, 0);

  const recent = interpret(input("Meu pai faleceu hoje e temos jazigo da família"));
  assertEquals(recent.goal?.goal_code, "GOAL_OUTROS_ASSUNTOS");
  assertEquals(recent.facts.length, 0);
});

Deno.test("existing grave occurrence classification stays authoritative", () => {
  const result = interpret(input("Meu jazigo está violado"));
  assertEquals(result.goal?.goal_code, "GOAL_JAZIGO_SERVICOS");
  assertEquals(result.primary_event?.event_kind, "COMPLAINT");
  assert(result.facts.some((fact) => fact.fact_code === "complaint_description"));
});

Deno.test("procedure context answers documents and preserves the pending flow", () => {
  const answer = proceduralDirectReply({
    text: "Quais documentos preciso?",
    activeGoalCode: "GOAL_EXUMACAO",
    pendingQuestion: "Qual é a finalidade da exumação?",
  });
  assert(answer?.includes("Quadra Geral"));
  assert(answer?.includes("Jazigo de Família"));
  assert(answer?.includes("Qual é a finalidade da exumação?"));
  assert(!answer?.includes("aprovação confirmada"));
});

Deno.test("volatile values are never presented without a current-verification warning", () => {
  const price = proceduralDirectReply({ text: "Quanto custa a exumação em quadra geral?" });
  assert(price?.includes("R$ 351,67"));
  assert(price?.includes("precisa ser confirmado na fonte oficial vigente"));

  const deadline = proceduralDirectReply({ text: "Qual o prazo do processo de concessão?" });
  assert(deadline?.includes("180 dias"));
  assert(deadline?.includes("precisa ser confirmado na fonte oficial vigente"));
});

Deno.test("concession payment is never confused with process approval", () => {
  const answer = proceduralDirectReply({
    text: "Paguei a taxa de concessão. Meu processo já está aprovado?",
  });
  assert(answer?.includes("não significa"));
  assert(answer?.includes("aberto ou aprovado"));
});

Deno.test("already-contracted plaque is service follow-up, not a new quote", () => {
  const answer = proceduralDirectReply({
    text: "Já comprei a lápide. Como vejo o status da instalação?",
  });
  assert(answer?.includes("acompanhamento de serviço"));
  assert(answer?.includes("não um novo orçamento"));
  assert(answer?.includes("data da compra"));
});

Deno.test("recent death keeps maximum priority separate from schedule confirmation", () => {
  const answer = proceduralDirectReply({
    text: "Meu pai faleceu hoje e temos jazigo da família",
  });
  assert(answer?.includes("máxima prioridade"));
  assert(answer?.includes("não significa horário automaticamente confirmado"));
  assert(answer?.includes("nome do falecido"));
});

Deno.test("remarculation never invents a replacement appointment", () => {
  const answer = proceduralDirectReply({ text: "Preciso reagendar a exumação" });
  assert(answer?.includes("somente então se confirma uma nova data"));
  assert(answer?.includes("não deve ser informada como agendada"));
});

Deno.test("procedure prompt exposes routing aliases but not historical prices or deadlines", () => {
  const prompt = buildPrompt(input("Preciso de administração provisória"));
  assert(prompt.includes("procedure_routes"));
  assert(prompt.includes("ADMINISTRACAO_PROVISORIA"));
  assert(prompt.includes("GOAL_CONCESSAO"));
  assert(!prompt.includes("R$ 94,00"));
  assert(!prompt.includes("R$ 351,67"));
  assert(!prompt.includes("180 dias"));
});

Deno.test("all procedural routes stay inside the existing closed goal catalog", () => {
  const allowed = new Set([
    "GOAL_TRANSPORTE", "GOAL_EXUMACAO", "GOAL_RECADASTRO", "GOAL_CONCESSAO",
    "GOAL_COMERCIAL", "GOAL_JAZIGO_SERVICOS", "GOAL_RECLAMACAO",
    "GOAL_INFO_OSSUARIO", "GOAL_INFO_HORARIO", "GOAL_OUTROS_ASSUNTOS",
  ]);
  for (const route of procedureRouteHintsForPrompt()) assert(allowed.has(route.goal_code));
  assertEquals(procedureRouteHintsForPrompt().length, 16);
});

Deno.test("the full operational source categories are represented", () => {
  for (const query of [
    "recadastro",
    "exumação em quadra geral",
    "exumação jazigo de família",
    "renovação de ossuário",
    "adquirir ossuário",
    "processo de concessão",
    "taxa de concessão",
    "administração provisória",
    "cinzas em jazigo",
    "translado",
    "óbito recente",
    "manutenção do jazigo",
    "serviço funerário",
    "remarcação de exumação",
    "jazigo violado",
    "ouvidoria",
  ]) {
    assert(findProcedure(query), "procedimento sem representação: " + query);
  }
});
