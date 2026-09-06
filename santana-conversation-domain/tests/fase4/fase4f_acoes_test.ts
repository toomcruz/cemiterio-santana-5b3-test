// Fase 4F — testes do ciclo real de ações e acompanhamentos.
import { assert, assertEquals, assertRejects } from "../../../tests/fixtures/assert.ts";
import {
  createAcao,
  createAcompanhamento,
  transitionAcao,
  transitionAcompanhamento,
  verificaNaoColapso,
} from "../../catalogo-acoes.ts";
import { initState } from "../../engine/engine.ts";
import { validateState } from "../../engine/validate.ts";

const T0 = "2026-09-06T11:00:00Z";
const T1 = "2026-09-06T11:01:00Z";

Deno.test("4F: catálogo determina o executor e rejeita autoridade incorreta", async () => {
  const acao = createAcao({ id: "a1", tipo: "ENVIO_WHATSAPP", executor: "SISTEMA", agendado_em: T0 });
  assertEquals(acao.estado, "AGENDADA");
  await assertRejects(
    () => createAcao({ id: "a2", tipo: "CHAMADA_HUMANO", executor: "SISTEMA", agendado_em: T0 }),
    /exige executor HUMANO/,
  );
});

Deno.test("4F: acompanhamento mantém identidade e ciclo próprios", () => {
  const acao = createAcao({ id: "a1", tipo: "ENVIO_EMAIL", executor: "SISTEMA", agendado_em: T0 });
  const acompanhamento = createAcompanhamento({ id: "acomp-1", acao_id: acao.id, criado_em: T0 });
  const pausado = transitionAcompanhamento(acompanhamento, "PAUSADO", T1);
  assert(verificaNaoColapso(acao, pausado));
  assertEquals(pausado.id, "acomp-1");
  assertEquals(pausado.acao_id, "a1");
  assertEquals(pausado.ciclo_proprio, 1);
  assertEquals(verificaNaoColapso({ ...acao, id: "outra" }, pausado), false);
});

Deno.test("4F: ação e acompanhamento coexistem no schema sem colapso", () => {
  const acao = createAcao({ id: "a3", tipo: "ATUALIZAR_CASO", executor: "HUMANO", agendado_em: T0 });
  const acompanhamento = createAcompanhamento({ id: "acomp-3", acao_id: acao.id, criado_em: T0 });
  const executada = transitionAcao(acao, "EXECUTADA", T1);
  const state = {
    ...initState("conv-4f"),
    acoes: [executada],
    acompanhamentos: [acompanhamento],
  };
  assertEquals(executada.executado_em, T1);
  assertEquals(validateState(state), []);
});

Deno.test("4F: estados terminais não reabrem", async () => {
  const acao = transitionAcao(
    createAcao({ id: "a4", tipo: "ENVIO_EMAIL", executor: "SISTEMA", agendado_em: T0 }),
    "CANCELADA",
    T1,
  );
  await assertRejects(() => transitionAcao(acao, "AGENDADA", T1), /transicao de acao invalida/);
});
