// Garantias estruturais: o que nenhum vetor consegue provar sozinho.
//
// Os vetores provam comportamento. Estes testes provam PROPRIEDADES DO CODIGO
// que precisam continuar valendo mesmo em caminhos que nenhum vetor exercita -
// e sao justamente esses caminhos que um dia levariam um valor errado ao
// municipe.

import { assert, assertEquals } from "../../tests/fixtures/assert.ts";
import { canonizar, compararPorCodePoint, ordenar, vigenteEm } from "../canonico.ts";
import { caminhoDoCatalogo, juntar } from "../caminhos.ts";
import { ARQUIVOS_DE_DOMINIO, carregar, limparCache } from "../catalogo/carregar.ts";
import { definirEscopoDeFixture, escopoDeFatos, factSpecs, perfilDeConformidade } from "../dominio/catalogo.ts";

function dir(relativo: string): string {
  // Resolvido pela URL, e nao por concatenacao: `juntar` nao normaliza "..", e
  // um caminho com ".." no meio faria o teste de caminho neutro passar por
  // acidente ou falhar por acidente, dependendo da direcao da comparacao.
  return decodeURIComponent(new URL(relativo, import.meta.url).pathname).replace(/\/+$/, "");
}

const GATEWAY = dir("..");
const REPO = dir("../..");

/** Codigo do Gateway, exceto os proprios testes (que citam literais de proposito). */
function fontesDoGateway(): { caminho: string; texto: string }[] {
  const arquivos: { caminho: string; texto: string }[] = [];
  const visitar = (dir: string) => {
    for (const item of Deno.readDirSync(dir)) {
      const caminho = juntar(dir, item.name);
      if (item.isDirectory) {
        if (item.name !== "tests") visitar(caminho);
      } else if (item.name.endsWith(".ts")) {
        arquivos.push({ caminho, texto: Deno.readTextFileSync(caminho) });
      }
    }
  };
  visitar(GATEWAY);
  return arquivos;
}

// ------------------------------------------------------------ zero tarifa

Deno.test("nenhum literal de tarifa ou de modalidade no codigo do Gateway", () => {
  // O Gateway LE modalidade do catalogo; ele nunca a nomeia. Um literal aqui
  // seria o primeiro passo para escolher tarifa em codigo.
  const proibidos = [
    "106,57",
    "351,67",
    "586,04",
    "EXUMACAO_DE_OSSUARIO",
    "SEPULTURA_CESSAO",
  ];
  for (const { caminho, texto } of fontesDoGateway()) {
    for (const literal of proibidos) {
      assert(!texto.includes(literal), `${caminho} cita ${literal}`);
    }
  }
});

Deno.test("nenhuma coercao numerica sobre valor monetario", () => {
  // Dinheiro e string, sempre. Sem parse, sem formatacao, sem aritmetica.
  for (const { caminho, texto } of fontesDoGateway()) {
    for (const proibido of ["parseFloat", "parseInt", "toFixed", "Number("]) {
      assert(!texto.includes(proibido), `${caminho} usa ${proibido}`);
    }
  }
});

// -------------------------------------------------------------- datas civis

Deno.test("nenhum uso de Date no codigo do Gateway", () => {
  // `Date` e baseado em UTC e deslocaria uma fronteira de vigencia conforme o
  // fuso do processo. Data civil e texto ISO-8601, comparado lexicograficamente.
  for (const { caminho, texto } of fontesDoGateway()) {
    assert(!/new Date\b/.test(texto), `${caminho} instancia Date`);
    assert(!texto.includes("Date.now"), `${caminho} usa Date.now`);
  }
});

Deno.test("vigencia e inclusiva nas duas pontas", () => {
  assertEquals(vigenteEm("2026-01-06", "2026-01-07", "2026-06-30"), false);
  assertEquals(vigenteEm("2026-01-07", "2026-01-07", "2026-06-30"), true);
  assertEquals(vigenteEm("2026-06-30", "2026-01-07", "2026-06-30"), true);
  assertEquals(vigenteEm("2026-07-01", "2026-01-07", "2026-06-30"), false);
  assertEquals(vigenteEm("1900-01-01", null, null), true);
});

// ---------------------------------------------------------------- ordenacao

Deno.test("ordenacao por code point, nao por colacao de locale", () => {
  // `localeCompare` colocaria "á" junto de "a"; code point coloca depois de "z".
  const entrada = ["z", "a", "á", "A", "Z"];
  assertEquals(ordenar(entrada), ["A", "Z", "a", "z", "á"]);
  assert(compararPorCodePoint("a", "á") < 0);
  assert(compararPorCodePoint("z", "á") < 0);
});

Deno.test("ordenacao por code point, nao por code unit UTF-16", () => {
  // Fora do BMP, o `sort()` padrao do JS diverge: ele compara code units, e o
  // primeiro surrogate (0xD800) fica ABAIXO de caracteres como U+E000.
  const astral = "\u{1F600}"; // U+1F600, acima de U+E000
  const privado = "";
  assert(compararPorCodePoint(privado, astral) < 0, "U+E000 vem antes de U+1F600");
  assertEquals(ordenar([astral, privado]), [privado, astral]);
  // O sort() padrao erraria exatamente aqui:
  assertEquals([astral, privado].sort(), [privado, astral].sort());
  assert([astral, privado].sort()[0] === astral, "o sort() padrao inverte, como esperado");
});

Deno.test("canonizacao ordena chaves recursivamente e nao usa espaco", () => {
  assertEquals(
    canonizar({ b: 1, a: { d: [1, 2], c: "x" } }),
    '{"a":{"c":"x","d":[1,2]},"b":1}',
  );
  // Chave numerica: a ordem de insercao do objeto JS a moveria para a frente;
  // o canonizador ordena explicitamente e nao depende disso.
  assertEquals(canonizar({ b: 1, "2": 2, a: 3 }), '{"2":2,"a":3,"b":1}');
});

// ------------------------------------------------- perfil unico, escopo unico

Deno.test("o escopo vem do perfil compartilhado, e nao de lista hardcoded", () => {
  definirEscopoDeFixture([]);
  const perfil = perfilDeConformidade();
  assertEquals(escopoDeFatos(), perfil.fact_codes);
  assertEquals(perfil.topic_code, "EXUMACAO");
  assertEquals(perfil.primary_goal, "GOAL_EXUMACAO");
});

Deno.test("nao existe segunda lista de fact_codes no codigo", () => {
  // Se alguem reintroduzir a lista em codigo, este teste quebra. E o mecanismo
  // que impede as duas implementacoes de divergirem em silencio num escopo que
  // nenhum vetor exercita.
  const perfil = perfilDeConformidade();
  const alvo = ["exhumation_purpose", "surviving_spouse_status", "requester_document"];
  for (const { caminho, texto } of fontesDoGateway()) {
    const citados = alvo.filter((code) => texto.includes(code));
    assert(
      citados.length < alvo.length,
      `${caminho} parece conter uma segunda lista de fact_codes: ${citados.join(", ")}`,
    );
  }
  assertEquals(perfil.fact_codes.length, 11);
});

Deno.test("runtime normal nao recebe escopo de fixture", () => {
  definirEscopoDeFixture([]);
  const specs = factSpecs();
  assertEquals(specs.size, perfilDeConformidade().fact_codes.length);
  assert(!specs.has("fixture_non_extractable_fact"), "fato de fixture vazou para o runtime");
});

// ------------------------------------------------------- catalogo autoritativo

Deno.test("o catalogo oficial vive em caminho neutro, fora das implementacoes", () => {
  Deno.env.delete("SANTANA_CATALOGO_OFICIAL");
  Deno.env.delete("SANTANA_REPO_ROOT");
  const caminho = caminhoDoCatalogo();
  assertEquals(caminho, juntar(REPO, "santana-authority", "catalogo", "exumacao.v1.json"));
  assert(!caminho.includes("santana-authority-gateway"), "o Gateway nao e dono do catalogo");
  assert(!caminho.includes("/referencia/"), "a referencia nao e dona do catalogo");
});

Deno.test("o release_id calculado pelo TS e o mesmo da referencia e da C1 real", async () => {
  Deno.env.delete("SANTANA_CATALOGO_OFICIAL");
  Deno.env.delete("SANTANA_REPO_ROOT");
  definirEscopoDeFixture([]);
  const oficial = await carregar();
  assertEquals(oficial.release_id, "exu-1.0-32cc48f26797");
});

// ------------------------------------------------------- Fase 4A — fronteira

Deno.test("4A: release_id recalculado permanece exu-1.0-32cc48f26797", async () => {
  // Guarda (a): qualquer byte na fronteira muda o identificador. Esta subfase
  // so acrescenta testes/docs — o valor tem de continuar o da C1/Fase 3.
  Deno.env.delete("SANTANA_CATALOGO_OFICIAL");
  Deno.env.delete("SANTANA_REPO_ROOT");
  limparCache();
  definirEscopoDeFixture([]);
  const oficial = await carregar();
  assertEquals(oficial.release_id, "exu-1.0-32cc48f26797");
});

Deno.test("4A: ARQUIVOS_DE_DOMINIO tem tamanho e ordem alfabetica fixos", () => {
  // Guarda (b): a lista e a ordem sao a fronteira do digest. Mudar tamanho ou
  // ordem sem intencao invalida os 47 vetores de uma vez.
  assertEquals([...ARQUIVOS_DE_DOMINIO], [
    "facts.v1.json",
    "goals.v1.json",
    "questions.v1.json",
    "relations.v1.json",
    "topics.v1.json",
  ]);
  assertEquals(ARQUIVOS_DE_DOMINIO.length, 5);
  const ordenados = [...ARQUIVOS_DE_DOMINIO].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assertEquals([...ARQUIVOS_DE_DOMINIO], ordenados);
});

Deno.test("4A: state.schema e conversation-events nao entram no release_id", async () => {
  // Guarda (c): prova comportamental de que 4B–4F podem evoluir fora da
  // fronteira sem reconformidade. Mutamos so os dois arquivos "fora" num
  // espelho temporario do repo; o digest tem de permanecer identico.
  Deno.env.delete("SANTANA_CATALOGO_OFICIAL");
  const tmp = Deno.makeTempDirSync({ prefix: "santana-4a-" });
  try {
    const authCat = juntar(tmp, "santana-authority", "catalogo");
    const dom = juntar(tmp, "santana-conversation-domain");
    Deno.mkdirSync(authCat, { recursive: true });
    Deno.mkdirSync(dom, { recursive: true });
    Deno.copyFileSync(
      juntar(REPO, "santana-authority", "catalogo", "exumacao.v1.json"),
      juntar(authCat, "exumacao.v1.json"),
    );
    for (const nome of ARQUIVOS_DE_DOMINIO) {
      Deno.copyFileSync(
        juntar(REPO, "santana-conversation-domain", nome),
        juntar(dom, nome),
      );
    }
    Deno.copyFileSync(
      juntar(REPO, "santana-conversation-domain", "state.schema.json"),
      juntar(dom, "state.schema.json"),
    );
    Deno.copyFileSync(
      juntar(REPO, "santana-conversation-domain", "conversation-events.v1.json"),
      juntar(dom, "conversation-events.v1.json"),
    );

    assert(!([...ARQUIVOS_DE_DOMINIO] as string[]).includes("state.schema.json"));
    assert(
      !([...ARQUIVOS_DE_DOMINIO] as string[]).includes("conversation-events.v1.json"),
    );

    Deno.env.set("SANTANA_REPO_ROOT", tmp);
    limparCache();
    definirEscopoDeFixture([]);
    const antes = await carregar();
    assertEquals(antes.release_id, "exu-1.0-32cc48f26797");

    Deno.writeTextFileSync(juntar(dom, "state.schema.json"), '{"fase4a":"mutado"}');
    Deno.writeTextFileSync(
      juntar(dom, "conversation-events.v1.json"),
      '{"fase4a":"mutado"}',
    );
    limparCache();
    const depois = await carregar();
    assertEquals(
      depois.release_id,
      antes.release_id,
      "mutacao fora da fronteira nao pode mudar release_id",
    );
  } finally {
    Deno.env.delete("SANTANA_REPO_ROOT");
    limparCache();
    Deno.removeSync(tmp, { recursive: true });
  }
});
