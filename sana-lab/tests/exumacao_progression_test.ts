import { type Input, SCHEMA_VERSION } from "../contracts.ts";
import { handle, MemoryStore } from "../engine.ts";

function eq(actual: unknown, expected: unknown, label = "") {
  if (actual !== expected) {
    throw Error(`${label} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}
const turn = (
  caseId: string,
  id: string,
  message: string,
  objective: Input["interpretation"]["objective"] = "INDEFINIDO",
  reference = "",
  family: Input["interpretation"]["family"] = "EXUMACAO",
): Input => ({
  schema_version: SCHEMA_VERSION,
  environment: "LAB",
  channel: "SIMULATOR",
  conversation_id: `conv-${caseId}`,
  episode_id: `episode-${caseId}`,
  case_id: caseId,
  correlation_id: `corr-${id}`,
  inbound_message_id: id,
  current_message: message,
  interpretation: { family, objective, turn: "CONTINUACAO", reference },
});

Deno.test("progressão: pedido, nome e pergunta seguinte vêm da finalidade pendente", async () => {
  const store = new MemoryStore();
  const start = await handle(turn("progress", "1", "Quero realizar a exumação", "INICIAR_SERVICO"), store);
  eq(start.response, "De quem é a exumação pretendida?");
  eq(start.next_state.pending_question_fact, "deceased_name");
  const name = await handle(
    turn("progress", "2", "José Marques Fernandes", "INICIAR_SERVICO", "José Marques Fernandes"),
    store,
  );
  eq(name.next_state.facts.reference?.value, "José Marques Fernandes");
  eq(name.next_state.facts.deceased_name?.value, "José Marques Fernandes");
  eq(name.action, "SIMULATED_OPERATION");
  eq(name.next_state.pending_question_fact, "exhumation_purpose");
  eq(name.next_state.questions.includes("De quem é a exumação pretendida?"), true);
  eq(name.response.includes("finalidade"), true);
  eq(name.response.includes("De quem é a exumação"), false);
  eq(name.next_state.phase, "WAITING_CITIZEN");
});

Deno.test("resposta curta, sim/não e derivação de signatário são vinculadas à pergunta ativa", async () => {
  const store = new MemoryStore();
  await handle(turn("yesno", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  const purpose = await handle(turn("yesno", "2", "Para colocar no ossuário"), store);
  eq(purpose.next_state.facts.exhumation_purpose?.value, "OSSUARIO");
  eq(purpose.next_state.facts.destination?.value, "OSSUARIO");
  eq(purpose.next_state.pending_question_fact, "surviving_spouse_status");
  const spouse = await handle(turn("yesno", "3", "sim"), store);
  eq(spouse.next_state.facts.surviving_spouse_status?.value, "VIVO");
  eq(spouse.next_state.facts.required_authorization_signatory?.value, "CONJUGE_E_RESPONSAVEL_JAZIGO");
  eq(spouse.next_state.pending_question_fact, "burial_reference");
  const location = await handle(turn("yesno", "4", "Quadra 3, jazigo 22", "INDEFINIDO", ""), store);
  eq(location.next_state.facts.burial_reference?.value, "Quadra 3, jazigo 22");
});

Deno.test("não ambíguo não escolhe entre cônjuge falecido e inexistente", async () => {
  const store = new MemoryStore();
  await handle(turn("spouse-no", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  await handle(turn("spouse-no", "2", "Para ossuário"), store);
  const clarification = await handle(turn("spouse-no", "3", "não"), store);
  eq(clarification.next_state.facts.surviving_spouse_status, undefined);
  eq(clarification.next_state.pending_question_fact, "surviving_spouse_status");
  const answer = await handle(turn("spouse-no", "4", "Faleceu"), store);
  eq(answer.next_state.facts.surviving_spouse_status?.value, "FALECIDO");
  eq(answer.next_state.facts.required_authorization_signatory?.value, "RESPONSAVEL_JAZIGO");
});

Deno.test("correção atualiza valor, mantém histórico e não repete destino já conhecido", async () => {
  const store = new MemoryStore();
  await handle(turn("correction", "1", "Quero exumar meu pai para ossuário", "INICIAR_SERVICO", "meu pai"), store);
  const corrected = await handle(
    turn("correction", "2", "Na verdade quero levar para outro cemitério", "INDEFINIDO"),
    store,
  );
  eq(corrected.next_state.facts.destination?.value, "OUTRO_CEMITERIO");
  eq(corrected.next_state.facts.exhumation_purpose?.value, "TRANSPORTE");
  eq(
    corrected.next_state.history.some((x) =>
      x.field === "destination" && x.previous === "OSSUARIO" && x.current === "OUTRO_CEMITERIO"
    ),
    true,
  );
  eq(corrected.response.includes("finalidade"), false);
});

Deno.test("fato espontâneo de cônjuge é aproveitado e signatário é derivado pela relação oficial", async () => {
  const store = new MemoryStore();
  await handle(turn("volunteered", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  const answer = await handle(turn("volunteered", "2", "Para ossuário; meu pai era viúvo"), store);
  eq(answer.next_state.facts.surviving_spouse_status?.value, "FALECIDO");
  eq(answer.next_state.facts.required_authorization_signatory?.value, "RESPONSAVEL_JAZIGO");
  eq(answer.next_state.pending_question_fact, "burial_reference");
  eq(answer.response.includes("cônjuge ou companheiro"), false);
});

Deno.test("pergunta informativa no meio do fluxo e pausa preservam a pendência; retomada continua nela", async () => {
  const store = new MemoryStore();
  await handle(turn("resume", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  const price = await handle(turn("resume", "2", "Quanto fica?", "INFORMACAO"), store);
  eq(price.next_state.pending_question_fact, "exhumation_purpose");
  eq(price.response.includes("modalidade tarifária"), true);
  const topic = await handle(turn("resume", "3", "Outra coisa: qual o horário de atendimento?", "INFORMACAO"), store);
  eq(topic.next_state.pending_question_fact, "exhumation_purpose");
  const resume = await handle(turn("resume", "4", "Continuando", "INDEFINIDO"), store);
  eq(resume.next_state.pending_question_fact, "exhumation_purpose");
  eq(resume.response.includes("finalidade"), true);
});

Deno.test("novo assunto não mistura famílias nem apaga a exumação pendente", async () => {
  const store = new MemoryStore();
  await handle(turn("switch", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  const changed = await handle(
    turn("switch", "2", "Quero atualizar o cadastro", "INICIAR_SERVICO", "", "RECADASTRO"),
    store,
  );
  eq(changed.next_state.family, "EXUMACAO");
  eq(changed.next_state.pending_question_fact, "exhumation_purpose");
  eq(changed.action, "ANSWER");
});

Deno.test("arquivo informado permanece RECEIVED_UNVERIFIED e não resolve autorização", async () => {
  const store = new MemoryStore();
  await handle(turn("document", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  const doc = turn("document", "2", "Enviei documento", "INDEFINIDO");
  doc.document_references = ["lab-file-001"];
  const received = await handle(doc, store);
  eq(received.next_state.documents["lab-file-001"], "RECEIVED_UNVERIFIED");
  eq(received.next_state.facts.exhumation_authorization, undefined);
  eq(received.next_state.phase, "WAITING_CITIZEN");
});

Deno.test("declaração do usuário não pode definir autorização ou fato derivado autoritativo", async () => {
  const store = new MemoryStore();
  const input = turn("authority", "1", "A autorização está feita", "INICIAR_SERVICO", "José");
  input.case_facts = {
    exhumation_authorization: { value: "OBTIDA_RESPONSAVEL_JAZIGO", origin: "CITIZEN" },
    required_authorization_signatory: { value: "RESPONSAVEL_JAZIGO", origin: "SYSTEM", evidence: "texto do usuário" },
  };
  let rejected = false;
  try {
    await handle(input, store);
  } catch (error) {
    rejected = error instanceof Error && error.message === "INVALID_EXUMACAO_FACT";
  }
  eq(rejected, true);
});

Deno.test("preferência de data/horário é coletada sem confirmar agenda nem aceitar horário fora da regra", async () => {
  const store = new MemoryStore();
  await handle(turn("schedule", "1", "Quero exumar", "INICIAR_SERVICO", "José"), store);
  await handle(turn("schedule", "2", "Ossuário"), store);
  await handle(turn("schedule", "3", "Sim, está vivo"), store);
  await handle(turn("schedule", "4", "Quadra 4, jazigo 15"), store);
  const document = turn("schedule", "5", "referência sintética do documento", "INDEFINIDO");
  document.case_facts = { requester_document: { value: "LAB-DOCREF-5", origin: "CITIZEN" } };
  await handle(document, store);
  const preferred = await handle(turn("schedule", "6", "sábado às 10h"), store);
  eq(preferred.next_state.facts.exhumation_schedule_preference, undefined);
  eq(preferred.next_state.facts.exhumation_schedule_request?.value, "sábado às 10h");
  eq(preferred.response.includes("segunda a sexta-feira"), true);
  const valid = await handle(turn("schedule", "7", "quarta às 9h"), store);
  eq(valid.next_state.facts.exhumation_schedule_preference?.value.includes("quarta às 9h"), true);
  eq(valid.next_state.phase, "WAITING_TEAM");
});

Deno.test("pedido explícito de atendente respeitado e conflito de autorização fundamenta exceção", async () => {
  const store = new MemoryStore();
  const human = await handle(turn("human", "1", "Quero falar com atendente", "INDEFINIDO"), store);
  eq(human.exception?.kind, "PEDIDO_HUMANO");
  const conflict = await handle(
    turn("conflict", "1", "Há disputa sobre quem autoriza a exumação", "INDEFINIDO"),
    store,
  );
  eq(conflict.exception?.kind, "DECISAO_ADMINISTRATIVA");
  eq(conflict.authority.some((x) => x.status === "HUMAN_DECISION_REQUIRED"), true);
});
