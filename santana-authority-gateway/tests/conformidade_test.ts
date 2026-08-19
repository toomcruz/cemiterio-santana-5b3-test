// Conformidade do Gateway TS/Deno contra os vetores V1-V12.
//
// Duas coisas precisam ser verdade, e a segunda importa tanto quanto a
// primeira:
//
// 1. os 47 casos passam contra esta implementacao;
// 2. os vetores REPROVAM quando a implementacao regride.
//
// Sem (2), "47 PASS" nao prova nada: um vetor que nao consegue falhar nao e
// prova, e apenas decoracao.

import { assert, assertEquals } from "../../tests/fixtures/assert.ts";
import {
  avaliar,
  carregarVetores,
  executar,
  FAIL,
  INVALIDO,
  PASS,
  type Vetor,
} from "../conformidade/executar_vetores.ts";
import { canonizar } from "../canonico.ts";

function porId(vectorId: string): Vetor {
  const vetor = carregarVetores().find((v) => v.vector_id === vectorId);
  assert(vetor, `vetor inexistente: ${vectorId}`);
  return JSON.parse(JSON.stringify(vetor)) as Vetor;
}

Deno.test("os 47 casos de V1-V12 passam nesta implementacao", async () => {
  const falhas: string[] = [];
  for (const vetor of carregarVetores()) {
    const r = await avaliar(vetor);
    if (r.resultado !== PASS) falhas.push(`${r.vector_id}=${r.resultado}`);
  }
  assertEquals(falhas, [], `vetores nao-PASS: ${falhas.join(", ")}`);
});

Deno.test("os doze vetores estao cobertos", () => {
  const cobertos = new Set(carregarVetores().map((v) => v.vetor));
  const esperados = new Set(Array.from({ length: 12 }, (_, i) => `V${i + 1}`));
  assertEquals([...cobertos].sort(), [...esperados].sort());
});

Deno.test("o total de casos e o mesmo que a referencia Python reporta", () => {
  assertEquals(carregarVetores().length, 47);
});

// ------------------------------------------------- o executor consegue reprovar

Deno.test("saida diferente reprova", async () => {
  const vetor = porId("V02-A");
  (vetor.saida_esperada as Record<string, unknown>)["status"] = "AVAILABLE";
  assertEquals((await avaliar(vetor)).resultado, FAIL);
});

Deno.test("chave extra no esperado reprova", async () => {
  const vetor = porId("V01-A");
  (vetor.saida_esperada as Record<string, unknown>)["campo_que_nao_existe"] = 1;
  assertEquals((await avaliar(vetor)).resultado, FAIL);
});

Deno.test("escrita inesperada reprova", async () => {
  const vetor = porId("V11-A");
  vetor.escritas_esperadas = [{ code: "x", destino: "facts", status: "CONFIRMED" }];
  assertEquals((await avaliar(vetor)).resultado, FAIL);
});

Deno.test("release_id divergente e INVALIDO, e INVALIDO nao e PASS", async () => {
  const vetor = porId("V01-A");
  vetor.release_id_esperado = "exu-1.0-000000000000";
  const r = await avaliar(vetor);
  assertEquals(r.resultado, INVALIDO);
  assert(r.resultado !== PASS);
});

// --------------------------------------------------------- garantias de dominio

Deno.test("nenhuma tarifa aparece quando falta modalidade_tarifaria (V10)", async () => {
  const tarifas = ["106,57", "351,67", "586,04"];
  for (const vetor of carregarVetores().filter((v) => v.vetor === "V10")) {
    const texto = canonizar((await executar(vetor)).saida);
    for (const tarifa of tarifas) {
      assert(!texto.includes(tarifa), `${vetor.vector_id} vazou ${tarifa}`);
    }
  }
});

Deno.test("V10-C: destino OSSUARIO nao seleciona EXUMACAO_DE_OSSUARIO", async () => {
  const real = await executar(porId("V10-C"));
  const saida = real.saida as Record<string, unknown>;
  assertEquals(saida["status"], "NEEDS_CONTEXT");
  assert(!("valor" in saida), "nenhum valor pode sair sem modalidade determinada");
  assert(!("entry_id" in saida), "nenhuma entrada pode ser selecionada");
});

Deno.test("nenhuma escrita acontece nos sete casos do V11", async () => {
  for (const vetor of carregarVetores().filter((v) => v.vetor === "V11")) {
    const real = await executar(vetor);
    assertEquals(canonizar(real.escritas), "[]", `${vetor.vector_id} escreveu`);
  }
});
