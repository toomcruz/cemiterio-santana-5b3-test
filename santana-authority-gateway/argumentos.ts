// Contrato canonico de argumentos de tool (R1) e leitor de eventos.
//
// Por que este modulo existe
// --------------------------
// A C1 registrou `arguments = null` para uma tool de zero argumentos. A causa
// nao era o modelo nem o Parlant: era o leitor de eventos da POC, que usava
// `chamada.get("arguments") or chamada.get("args")`. `{}` e falsy em Python, o
// `or` caia para uma chave inexistente, e o resultado virava `None`.
//
// Em JavaScript `{}` e truthy, entao aquele defeito especifico nao se
// reproduz aqui. A distincao que importa continua sendo a mesma e continua
// precisando ser explicita: chave AUSENTE e chave PRESENTE COM `{}` sao coisas
// diferentes, e quem decide o que fazer com cada uma e a canonizacao, que
// conhece o contrato da tool.
//
// O contrato
// ----------
// A forma canonica de uma tool de ZERO argumentos e `{}`.
//
// A normalizacao de ausente/`null` para `{}` vale SOMENTE para tools cujo
// contrato declara zero argumentos. Para tools com parametros, ausencia e
// tratada pelo schema especifico e nenhum valor e criado em silencio:
// obrigatorio ausente e recusa, nao default.
//
// O que este modulo NAO faz: limpar um argumento indevido e seguir. Argumento
// fora do contrato e falha fechada - e o vetor de risco real e um modelo
// injetando `modalidade_tarifaria` numa consulta de preco.

import type { Json } from "./canonico.ts";
import { ordenar } from "./canonico.ts";

// Marcador que o ToolCaller emite quando nao conseguiu extrair um argumento.
// Nunca pode chegar ao Gateway como se fosse valor.
export const MARCADOR_MISSING = "__missing__";

// Codigo unico de recusa, exposto ao Gateway. Os motivos detalhados ficam em
// `motivos` - sao diagnostico, nao contrato de status.
export const ARGUMENTOS_NAO_CANONICOS = "ARGUMENTOS_NAO_CANONICOS";

export const TIPO_INVALIDO = "TIPO_INVALIDO";
export const CHAVE_EXTRA = "CHAVE_EXTRA";
export const OBRIGATORIO_AUSENTE = "OBRIGATORIO_AUSENTE";
export const VALOR_NULO = "VALOR_NULO";
export const VALOR_MISSING = "VALOR_MISSING";

/** O que a tool declara aceitar. `parametros` vazio = tool de zero argumentos. */
export interface ContratoDeTool {
  readonly nome: string;
  readonly parametros: readonly string[];
  readonly obrigatorios: readonly string[];
}

export function contrato(
  nome: string,
  parametros: readonly string[] = [],
  obrigatorios: readonly string[] = [],
): ContratoDeTool {
  return { nome, parametros, obrigatorios };
}

export function zeroArgumentos(c: ContratoDeTool): boolean {
  return c.parametros.length === 0;
}

export interface ArgumentosCanonizados {
  readonly contrato: string;
  readonly bruto: Json;
  readonly canonico: Record<string, Json> | null;
  readonly codigo: string | null;
  readonly motivos: readonly string[];
}

export function aceito(a: ArgumentosCanonizados): boolean {
  return a.codigo === null;
}

/**
 * Forma canonica do registro de canonizacao.
 *
 * ATENCAO: `bruto` e emitido SEMPRE, inclusive quando vale `null`. Ele e o
 * valor bruto do evento preservado literalmente para auditoria, e essa e a
 * unica excecao declarada a regra "null nao existe na forma canonica". Os
 * vetores V12-B, V12-C e V12-G esperam exatamente `"bruto": null`.
 */
export function asDict(a: ArgumentosCanonizados): Record<string, Json> {
  const dados: Record<string, Json> = {
    contrato: a.contrato,
    aceito: aceito(a),
    bruto: a.bruto,
  };
  if (a.canonico !== null) dados["canonico"] = { ...a.canonico };
  if (a.codigo !== null) dados["codigo"] = a.codigo;
  if (a.motivos.length > 0) dados["motivos"] = [...a.motivos];
  return dados;
}

/**
 * Le os argumentos de um evento de tool call sem depender de veracidade.
 *
 * `{}` presente e `{}`, e nao vira `null`. Ausencia continua sendo ausencia -
 * quem decide o que fazer com ela e a canonizacao.
 */
export function lerArgumentosDoEvento(chamada: Record<string, Json>): Json {
  for (const chave of ["arguments", "args"]) {
    if (chave in chamada) return chamada[chave]!;
  }
  return null;
}

function ehMapa(valor: Json): valor is Record<string, Json> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Rotulo de tipo usado nos motivos.
 *
 * Os vetores fixam o rotulo do lado Python (`list`, `str`, `int`...), entao o
 * mapeamento JS -> rotulo faz parte do contrato, nao do gosto de quem
 * implementa. V12-E fixa `TIPO_INVALIDO:list`.
 */
export function rotuloDeTipo(valor: Json): string {
  if (valor === null) return "NoneType";
  if (Array.isArray(valor)) return "list";
  if (typeof valor === "string") return "str";
  if (typeof valor === "boolean") return "bool";
  if (typeof valor === "number") return Number.isInteger(valor) ? "int" : "float";
  return "dict";
}

/** Aplica o contrato canonico. Falha fechada, nunca corrige em silencio. */
export function canonizarArgumentos(c: ContratoDeTool, bruto: Json): ArgumentosCanonizados {
  const motivos: string[] = [];
  const recusar = (): ArgumentosCanonizados => ({
    contrato: c.nome,
    bruto,
    canonico: null,
    codigo: ARGUMENTOS_NAO_CANONICOS,
    motivos: ordenar(new Set(motivos)),
  });

  if (bruto === null) {
    if (zeroArgumentos(c)) {
      // Unica normalizacao permitida: ausencia numa tool que declara zero
      // argumentos e, por construcao, `{}`.
      return { contrato: c.nome, bruto, canonico: {}, codigo: null, motivos: [] };
    }
    if (c.obrigatorios.length > 0) {
      for (const p of ordenar(c.obrigatorios)) motivos.push(`${OBRIGATORIO_AUSENTE}:${p}`);
      return recusar();
    }
    // Tool com parametros, todos opcionais, nenhum informado. `{}` aqui nao cria
    // valor nenhum - apenas registra que nada foi passado.
    return { contrato: c.nome, bruto, canonico: {}, codigo: null, motivos: [] };
  }

  if (!ehMapa(bruto)) {
    motivos.push(`${TIPO_INVALIDO}:${rotuloDeTipo(bruto)}`);
    return recusar();
  }

  for (const chave of ordenar(Object.keys(bruto))) {
    if (!c.parametros.includes(chave)) {
      motivos.push(`${CHAVE_EXTRA}:${chave}`);
      continue;
    }
    const valor = bruto[chave]!;
    if (valor === null) {
      motivos.push(`${VALOR_NULO}:${chave}`);
    } else if (typeof valor === "string" && valor.includes(MARCADOR_MISSING)) {
      motivos.push(`${VALOR_MISSING}:${chave}`);
    }
  }

  for (const parametro of ordenar(c.obrigatorios)) {
    if (!(parametro in bruto)) motivos.push(`${OBRIGATORIO_AUSENTE}:${parametro}`);
  }

  if (motivos.length > 0) return recusar();

  const canonico: Record<string, Json> = {};
  for (const chave of ordenar(Object.keys(bruto))) canonico[chave] = bruto[chave]!;
  return { contrato: c.nome, bruto, canonico, codigo: null, motivos: [] };
}
