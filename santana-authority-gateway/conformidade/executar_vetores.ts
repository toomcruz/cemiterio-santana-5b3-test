// Executor TS/Deno dos vetores de conformidade V1-V12.
//
// Le EXATAMENTE os mesmos arquivos que o executor Python, em
// `conformidade/vetores/`. Nenhum vetor e copiado para dentro desta
// implementacao, e nenhum vetor pode ser ajustado para fazer este codigo
// passar: se o TS divergir, corrige-se o TS.
//
//   PASS     saida real == esperada, documento inteiro, apos canonizacao
//            E escritas observadas == escritas_esperadas
//   FAIL     qualquer diferenca
//   INVALIDO release_id divergente: o vetor nao roda e NAO conta como PASS

import { canonizar, type DataCivil, type Json, ordenar } from "../canonico.ts";
import { juntar } from "../caminhos.ts";
import { limparCache } from "../catalogo/carregar.ts";
import { ErroDeCatalogo } from "../catalogo/erros.ts";
import { definirEscopoDeFixture, limparCaches } from "../dominio/catalogo.ts";
import { asDict as argumentosAsDict, contrato, lerArgumentosDoEvento } from "../argumentos.ts";
import { asDict, camposParaCanned } from "../resposta.ts";
import { type Caso, comFatosConfirmados, escritas, novoCaso } from "../caso.ts";
import { consultar, consultarViaTool, descreverRelease, registrarFato } from "../gateway.ts";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const INVALIDO = "INVALIDO";

const DOMINIO = "santana-conversation-domain";

function raizReal(): string {
  // A raiz real do repositorio, independente de `SANTANA_REPO_ROOT`, que este
  // executor sobrescreve ao montar uma fixture de dominio.
  return decodeURIComponent(new URL("../..", import.meta.url).pathname).replace(/\/+$/, "");
}

const REPO = raizReal();
const VETORES = juntar(REPO, "conformidade", "vetores");
const FIXTURES = juntar(VETORES, "fixtures");

export interface Vetor {
  vector_id: string;
  vetor: string;
  titulo: string;
  catalogo_ref: string;
  dominio_ref?: string;
  release_id_esperado: string | null;
  operacao: string;
  referencia?: string;
  entrada: Record<string, Json>;
  saida_esperada: Json;
  escritas_esperadas: Json;
  estado_do_caso_inicial?: Record<string, Json>;
}

export function carregarVetores(): Vetor[] {
  const vetores: Vetor[] = [];
  const nomes: string[] = [];
  for (const entrada of Deno.readDirSync(VETORES)) {
    if (entrada.isFile && /^v.*\.json$/.test(entrada.name)) nomes.push(entrada.name);
  }
  nomes.sort();
  for (const nome of nomes) {
    const doc = JSON.parse(Deno.readTextFileSync(juntar(VETORES, nome))) as { casos: Vetor[] };
    vetores.push(...doc.casos);
  }
  return vetores;
}

// ---------------------------------------------------------------- ambiente

const dominiosMontados = new Map<string, string>();
let dominioAtual: string | null = null;

/**
 * Monta uma raiz temporaria com o dominio autoritativo MAIS um acrescimo.
 *
 * A fixture declara apenas o que acrescenta. Os catalogos de dominio sao lidos
 * de `santana-conversation-domain/` e copiados sem edicao; so `facts.v1.json`
 * recebe os fatos declarados em `acrescenta_fatos`, anexados ao final.
 *
 * `santana-authority` e `conformidade` entram como links simbolicos para os
 * reais: a fixture troca APENAS o catalogo de dominio, e nao ganha catalogo
 * oficial nem perfil de conformidade proprios pela porta dos fundos.
 */
export function montarDominio(ref: string): string {
  const existente = dominiosMontados.get(ref);
  if (existente) return existente;

  const fixture = JSON.parse(Deno.readTextFileSync(juntar(FIXTURES, ref))) as {
    acrescenta_fatos: Record<string, Json>[];
  };
  const raiz = Deno.makeTempDirSync({ prefix: "vetores-dominio-ts-" });
  Deno.mkdirSync(juntar(raiz, DOMINIO));
  for (const item of Deno.readDirSync(juntar(REPO, DOMINIO))) {
    if (item.isFile && item.name.endsWith(".json")) {
      Deno.copyFileSync(juntar(REPO, DOMINIO, item.name), juntar(raiz, DOMINIO, item.name));
    }
  }

  const alvo = juntar(raiz, DOMINIO, "facts.v1.json");
  const doc = JSON.parse(Deno.readTextFileSync(alvo)) as { facts: Record<string, Json>[] };
  const existentes = new Set(doc.facts.map((f) => String(f["fact_code"])));
  for (const fato of fixture.acrescenta_fatos) {
    const code = String(fato["fact_code"]);
    if (existentes.has(code)) {
      throw new Error(
        `fixture ${ref} tentaria sobrescrever o fato autoritativo ${code}; fixture so acrescenta`,
      );
    }
    doc.facts.push(fato);
  }
  Deno.writeTextFileSync(alvo, `${JSON.stringify(doc, null, 2)}\n`);

  for (const neutro of ["santana-authority", "conformidade"]) {
    Deno.symlinkSync(juntar(REPO, neutro), juntar(raiz, neutro));
  }
  dominiosMontados.set(ref, raiz);
  return raiz;
}

function aplicarDominio(ref: string | undefined): void {
  const alvo = ref ?? null;
  if (alvo === dominioAtual) return;
  if (alvo === null) {
    Deno.env.delete("SANTANA_REPO_ROOT");
    definirEscopoDeFixture([]);
  } else {
    Deno.env.set("SANTANA_REPO_ROOT", montarDominio(alvo));
    const fixture = JSON.parse(Deno.readTextFileSync(juntar(FIXTURES, alvo))) as {
      acrescenta_fatos: Record<string, Json>[];
    };
    definirEscopoDeFixture(fixture.acrescenta_fatos.map((f) => String(f["fact_code"])));
  }
  limparCaches();
  limparCache();
  dominioAtual = alvo;
}

/**
 * Aponta o catalogo da execucao.
 *
 * Para `oficial` a variavel de ambiente e REMOVIDA, e nao apontada para o
 * caminho conhecido: assim o vetor exercita a resolucao padrao de
 * `caminhoDoCatalogo()` de verdade, e uma mudanca errada nela reprova.
 */
function aplicarCatalogo(ref: string): void {
  if (ref === "oficial") {
    Deno.env.delete("SANTANA_CATALOGO_OFICIAL");
    return;
  }
  Deno.env.set("SANTANA_CATALOGO_OFICIAL", juntar(FIXTURES, ref));
}

// ---------------------------------------------------------------- execucao

export interface Execucao {
  saida: Json;
  escritas: Json;
  release_id: string | null;
}

function contratoDoVetor(bruto: Record<string, Json>): ReturnType<typeof contrato> {
  return contrato(
    String(bruto["nome"]),
    (bruto["parametros"] ?? []) as string[],
    (bruto["obrigatorios"] ?? []) as string[],
  );
}

export async function executar(vetor: Vetor): Promise<Execucao> {
  aplicarDominio(vetor.dominio_ref);
  limparCache();
  aplicarCatalogo(vetor.catalogo_ref);

  const entrada = vetor.entrada ?? {};
  const referencia = (vetor.referencia ?? null) as DataCivil | null;
  let release_id: string | null = null;
  let escritasObservadas: Json = [];
  let saida: Json;

  switch (vetor.operacao) {
    case "carregar": {
      try {
        const descricao = await descreverRelease();
        release_id = String(descricao["release_id"]);
        saida = descricao;
      } catch (erro) {
        if (!(erro instanceof ErroDeCatalogo)) throw erro;
        saida = { erro_codigo: erro.codigo };
      }
      break;
    }

    case "consultar": {
      const r = await consultar(
        String(entrada["tipo_informacao"]),
        (entrada["contexto"] ?? {}) as Record<string, string>,
        referencia!,
      );
      release_id = r.release_id;
      saida = asDict(r);
      break;
    }

    case "consultar_com_canned": {
      // V6: alem da resposta, expoe o que uma canned response poderia
      // interpolar. Fora de AVAILABLE o mapa tem de ser vazio.
      const r = await consultar(
        String(entrada["tipo_informacao"]),
        (entrada["contexto"] ?? {}) as Record<string, string>,
        referencia!,
      );
      release_id = r.release_id;
      saida = { resposta: asDict(r), campos_para_canned: camposParaCanned(r) };
      break;
    }

    case "consultar_via_tool": {
      const [r, registro] = await consultarViaTool(
        contratoDoVetor(entrada["contrato"] as Record<string, Json>),
        lerArgumentosDoEvento(entrada["evento"] as Record<string, Json>),
        String(entrada["tipo_informacao"]),
        (entrada["contexto"] ?? {}) as Record<string, string>,
        referencia!,
      );
      release_id = r.release_id;
      saida = { resposta: asDict(r), argumentos: argumentosAsDict(registro) };
      break;
    }

    case "canonizar_argumentos": {
      const { canonizarArgumentos } = await import("../argumentos.ts");
      const bruto = lerArgumentosDoEvento(entrada["evento"] as Record<string, Json>);
      saida = argumentosAsDict(
        canonizarArgumentos(contratoDoVetor(entrada["contrato"] as Record<string, Json>), bruto),
      );
      break;
    }

    case "registrar_fato": {
      const caso: Caso = comFatosConfirmados(
        novoCaso("vetor"),
        ((vetor.estado_do_caso_inicial ?? {})["fatos_confirmados"] ?? {}) as Record<string, Json>,
      );
      const resultado = await registrarFato(
        caso,
        String(entrada["fact_code"]),
        entrada["valor"] ?? null,
        String(entrada["source"] ?? "USER_EXPLICIT"),
      );
      release_id = (resultado["release_id"] as string | undefined) ?? null;
      saida = resultado;
      escritasObservadas = escritas(caso) as unknown as Json;
      break;
    }

    default:
      throw new Error(`operacao desconhecida: ${vetor.operacao}`);
  }

  return { saida, escritas: escritasObservadas, release_id };
}

export interface Resultado {
  vector_id: string;
  vetor: string;
  titulo?: string;
  resultado: string;
  detalhe?: string;
  diferencas?: string[];
  esperado?: Json;
  real?: Json;
  escritas_esperadas?: Json;
  escritas_reais?: Json;
}

export async function avaliar(vetor: Vetor): Promise<Resultado> {
  const real = await executar(vetor);
  const esperadoRelease = vetor.release_id_esperado;

  if (esperadoRelease && real.release_id && real.release_id !== esperadoRelease) {
    return {
      vector_id: vetor.vector_id,
      vetor: vetor.vetor,
      resultado: INVALIDO,
      detalhe: `release_id ${real.release_id} != esperado ${esperadoRelease}; ` +
        `o vetor nao roda e nao conta como PASS`,
    };
  }

  const diferencas: string[] = [];
  if (canonizar(real.saida) !== canonizar(vetor.saida_esperada)) diferencas.push("saida");
  if (canonizar(real.escritas) !== canonizar(vetor.escritas_esperadas ?? [])) {
    diferencas.push("escritas");
  }

  const resultado: Resultado = {
    vector_id: vetor.vector_id,
    vetor: vetor.vetor,
    titulo: vetor.titulo,
    resultado: diferencas.length === 0 ? PASS : FAIL,
  };
  if (diferencas.length > 0) {
    resultado.diferencas = diferencas;
    resultado.esperado = vetor.saida_esperada;
    resultado.real = real.saida;
    if (diferencas.includes("escritas")) {
      resultado.escritas_esperadas = vetor.escritas_esperadas ?? [];
      resultado.escritas_reais = real.escritas;
    }
  }
  return resultado;
}

export async function relatorio(): Promise<Record<string, Json>> {
  const vetores = carregarVetores();
  const resultados: Resultado[] = [];
  for (const vetor of vetores) resultados.push(await avaliar(vetor));

  const porVetor: Record<string, string> = {};
  for (const r of resultados) {
    if (porVetor[r.vetor] !== FAIL) porVetor[r.vetor] = r.resultado === PASS ? PASS : FAIL;
  }
  const ordenadas: Record<string, Json> = {};
  for (const chave of Object.keys(porVetor).sort()) ordenadas[chave] = porVetor[chave]!;

  return {
    implementacao: "gateway-ts-deno",
    total_de_casos: resultados.length,
    pass: resultados.filter((r) => r.resultado === PASS).length,
    fail: resultados.filter((r) => r.resultado === FAIL).length,
    invalido: resultados.filter((r) => r.resultado === INVALIDO).length,
    por_vetor: ordenadas,
    casos: resultados as unknown as Json,
  };
}

/**
 * Saida REAL canonizada de cada caso, para comparacao byte a byte.
 *
 * E o modo forte da comparacao entre implementacoes: em vez de confiar que dois
 * PASS implicam saidas iguais, compara-se o que cada uma realmente emitiu.
 */
export async function despejar(): Promise<Record<string, Record<string, string>>> {
  const despejo: Record<string, Record<string, string>> = {};
  for (const vetor of carregarVetores()) {
    const real = await executar(vetor);
    despejo[vetor.vector_id] = {
      saida: canonizar(real.saida),
      escritas: canonizar(real.escritas),
      release_id: real.release_id ?? "",
    };
  }
  return despejo;
}

if (import.meta.main) {
  const destinoDespejo = Deno.env.get("VETORES_DESPEJO");
  if (destinoDespejo) {
    // Chaves ordenadas nos DOIS niveis, para o arquivo sair byte a byte igual ao
    // que o executor Python escreve com `sort_keys=True`. Assim a igualdade dos
    // despejos pode ser conferida por sha256, sem depender do comparador.
    const despejo = await despejar();
    const ordenado: Record<string, Record<string, string>> = {};
    for (const chave of ordenar(Object.keys(despejo))) {
      const caso = despejo[chave]!;
      const interno: Record<string, string> = {};
      for (const campo of ordenar(Object.keys(caso))) interno[campo] = caso[campo]!;
      ordenado[chave] = interno;
    }
    Deno.writeTextFileSync(destinoDespejo, `${JSON.stringify(ordenado, null, 2)}\n`);
  }

  const doc = await relatorio();
  const destino = Deno.env.get("VETORES_RELATORIO");
  if (destino) Deno.writeTextFileSync(destino, `${JSON.stringify(doc, null, 2)}\n`);

  for (const r of doc["casos"] as unknown as Resultado[]) {
    console.log(`${r.resultado.padEnd(8)} ${r.vector_id.padEnd(10)} ${r.titulo ?? ""}`);
    if (r.resultado !== PASS) console.log(JSON.stringify(r, null, 2));
  }
  console.log(
    `\nCASOS: ${doc["total_de_casos"]}  PASS: ${doc["pass"]}  ` +
      `FAIL: ${doc["fail"]}  INVALIDO: ${doc["invalido"]}`,
  );
  Deno.exit(doc["fail"] === 0 && doc["invalido"] === 0 ? 0 : 1);
}
