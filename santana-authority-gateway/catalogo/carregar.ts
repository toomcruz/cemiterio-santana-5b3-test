// Carga do catalogo oficial estruturado e calculo do `release_id`.
//
// O `release_id` e derivado do CONTEUDO: catalogo oficial mais os cinco
// catalogos de dominio, nesta ordem exata. Duas consequencias praticas - duas
// configuracoes diferentes nunca compartilham cache de avaliacao, e todo log
// fica correlacionavel a uma versao exata do conhecimento.
//
// A ordem dos arquivos de dominio e a ordem alfabetica dos nomes, e nao a ordem
// em que alguem os listou: e o que a implementacao de referencia faz, e um byte
// concatenado fora de ordem produz outro identificador.

import { caminhoDoCatalogo, diretorioDoDominio, juntar } from "../caminhos.ts";
import {
  CATALOGO_NAO_ENCONTRADO,
  ErroDeCatalogo,
  FONTE_INEXISTENTE,
  SCHEMA_NAO_SUPORTADO,
  TIPO_DE_INFORMACAO_NAO_DECLARADO,
} from "./erros.ts";
import { type DataCivil, ehDataCivil, type Json, vigenteEm } from "../canonico.ts";

export const SCHEMA_SUPORTADO = "1.0";

/** Ordem alfabetica - a mesma que o `sorted()` da referencia produz. */
export const ARQUIVOS_DE_DOMINIO = [
  "facts.v1.json",
  "goals.v1.json",
  "questions.v1.json",
  "relations.v1.json",
  "topics.v1.json",
] as const;

export interface Fonte {
  readonly source_id: string;
  readonly tipo: string;
  readonly referencia: string;
  readonly aprovada: boolean;
  readonly nota: string | null;
}

export interface TipoDeInformacao {
  readonly codigo: string;
  readonly forma_do_valor: string;
  readonly campos_de_aplicabilidade: readonly string[];
  readonly exige_fonte_oficial: boolean;
}

export interface Entrada {
  readonly entry_id: string;
  readonly tipo_informacao: string;
  readonly aplicabilidade: Readonly<Record<string, string>>;
  readonly valor: Readonly<Record<string, Json>>;
  readonly source_id: string;
  readonly vigencia_inicio: DataCivil | null;
  readonly vigencia_fim: DataCivil | null;
}

export interface CatalogoOficial {
  readonly release_id: string;
  readonly topic: string;
  readonly fontes: ReadonlyMap<string, Fonte>;
  readonly tipos: ReadonlyMap<string, TipoDeInformacao>;
  readonly entradas: readonly Entrada[];
}

export function especificidade(entrada: Entrada): number {
  return Object.keys(entrada.aplicabilidade).length;
}

export function entradaVigenteEm(entrada: Entrada, referencia: DataCivil): boolean {
  return vigenteEm(referencia, entrada.vigencia_inicio, entrada.vigencia_fim);
}

export function entradasDoTipo(catalogo: CatalogoOficial, tipo: string): Entrada[] {
  return catalogo.entradas.filter((e) => e.tipo_informacao === tipo);
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function releaseId(bruto: Uint8Array, dominio: string): Promise<string> {
  const partes: Uint8Array[] = [bruto];
  for (const nome of ARQUIVOS_DE_DOMINIO) {
    try {
      partes.push(Deno.readFileSync(juntar(dominio, nome)));
    } catch {
      // Arquivo ausente nao entra no digest - mesma tolerancia da referencia.
      continue;
    }
  }
  const total = partes.reduce((n, p) => n + p.length, 0);
  const juncao = new Uint8Array(total);
  let deslocamento = 0;
  for (const parte of partes) {
    juncao.set(parte, deslocamento);
    deslocamento += parte.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", juncao);
  return `exu-${SCHEMA_SUPORTADO}-${hex(digest).slice(0, 12)}`;
}

function dataOuNulo(valor: unknown, onde: string): DataCivil | null {
  if (valor === null || valor === undefined) return null;
  if (!ehDataCivil(valor)) {
    throw new ErroDeCatalogo(
      SCHEMA_NAO_SUPORTADO,
      `${onde}: vigencia deve ser data civil YYYY-MM-DD, recebido ${String(valor)}`,
    );
  }
  return valor;
}

const cache = new Map<string, CatalogoOficial>();

/**
 * Carrega o catalogo apontado por `caminhoDoCatalogo()`.
 *
 * O cache e por caminho, nao global: os vetores V3, V4, V7 e V8 rodam contra
 * catalogos-fixture, e um cache sem chave devolveria o catalogo oficial para
 * todos eles depois da primeira carga.
 */
export async function carregar(): Promise<CatalogoOficial> {
  const caminho = caminhoDoCatalogo();
  const dominio = diretorioDoDominio();
  const chave = `${caminho} ${dominio}`;
  const cacheado = cache.get(chave);
  if (cacheado) return cacheado;

  let bruto: Uint8Array;
  try {
    bruto = Deno.readFileSync(caminho);
  } catch {
    throw new ErroDeCatalogo(
      CATALOGO_NAO_ENCONTRADO,
      `Catalogo oficial nao encontrado: ${caminho}`,
    );
  }

  const dados = JSON.parse(new TextDecoder().decode(bruto)) as Record<string, Json>;
  const versao = dados["schema_version"];
  if (versao !== SCHEMA_SUPORTADO) {
    throw new ErroDeCatalogo(
      SCHEMA_NAO_SUPORTADO,
      `Catalogo oficial em schema ${JSON.stringify(versao)}; este runtime suporta ` +
        `${JSON.stringify(SCHEMA_SUPORTADO)}. Falha fechada: um catalogo de schema ` +
        `desconhecido nao pode ser interpretado.`,
      { encontrado: versao, suportado: SCHEMA_SUPORTADO },
    );
  }

  const fontes = new Map<string, Fonte>();
  for (const bruta of (dados["fontes"] ?? []) as Record<string, Json>[]) {
    const source_id = String(bruta["source_id"]);
    fontes.set(source_id, {
      source_id,
      tipo: String(bruta["tipo"]),
      referencia: String(bruta["referencia"]),
      aprovada: Boolean(bruta["aprovada"] ?? false),
      nota: (bruta["nota"] as string | undefined) ?? null,
    });
  }

  const tipos = new Map<string, TipoDeInformacao>();
  const brutosTipos = (dados["tipos_de_informacao"] ?? {}) as Record<string, Record<string, Json>>;
  for (const [codigo, spec] of Object.entries(brutosTipos)) {
    tipos.set(codigo, {
      codigo,
      forma_do_valor: String(spec["forma_do_valor"]),
      campos_de_aplicabilidade: (spec["campos_de_aplicabilidade"] ?? []) as string[],
      exige_fonte_oficial: Boolean(spec["exige_fonte_oficial"] ?? true),
    });
  }

  const entradas: Entrada[] = [];
  for (const bruta of (dados["entradas"] ?? []) as Record<string, Json>[]) {
    const entry_id = String(bruta["entry_id"]);
    const source_id = String(bruta["source_id"]);
    const fonte = fontes.get(source_id);
    if (!fonte) {
      throw new ErroDeCatalogo(
        FONTE_INEXISTENTE,
        `Entrada ${entry_id} aponta para fonte inexistente ${JSON.stringify(source_id)}.`,
        { entry_id, source_id },
      );
    }
    // Falha fechada: fonte nao aprovada nao entra em runtime. O descarte e na
    // CARGA, nao na resposta - uma entrada filtrada depois existiria no
    // processo e poderia vazar por outro caminho (V7).
    if (!fonte.aprovada) continue;

    const tipo_informacao = String(bruta["tipo_informacao"]);
    if (!tipos.has(tipo_informacao)) {
      throw new ErroDeCatalogo(
        TIPO_DE_INFORMACAO_NAO_DECLARADO,
        `Entrada ${entry_id} usa tipo de informacao nao declarado ` +
          `${JSON.stringify(tipo_informacao)}.`,
        { entry_id, tipo_informacao },
      );
    }

    const vigencia = (bruta["vigencia"] ?? {}) as Record<string, Json>;
    entradas.push({
      entry_id,
      tipo_informacao,
      aplicabilidade: (bruta["aplicabilidade"] ?? {}) as Record<string, string>,
      valor: bruta["valor"] as Record<string, Json>,
      source_id,
      vigencia_inicio: dataOuNulo(vigencia["inicio"], entry_id),
      vigencia_fim: dataOuNulo(vigencia["fim"], entry_id),
    });
  }

  const catalogo: CatalogoOficial = {
    release_id: await releaseId(bruto, dominio),
    topic: String(dados["topic"] ?? "EXUMACAO"),
    fontes,
    tipos,
    entradas,
  };
  cache.set(chave, catalogo);
  return catalogo;
}

export function limparCache(): void {
  cache.clear();
}
