// Canonizacao compartilhada pelas duas implementacoes do Gateway.
//
// A comparacao dos vetores V1-V12 e TOTAL: o documento inteiro, byte a byte,
// depois de canonizado. Qualquer divergencia de ordenacao, de espacamento ou de
// tratamento de data reprova um vetor sem que nenhuma das duas implementacoes
// esteja logicamente errada. Por isso as regras abaixo sao contrato, nao gosto.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Ordem por CODE POINT Unicode crescente.
 *
 * Nao usar `localeCompare` (difere em acentuacao) nem o `sort()` padrao, que
 * ordena por code unit UTF-16 e diverge do code point fora do BMP. O `sorted()`
 * do Python e por code point, e e com ele que precisamos concordar.
 */
export function compararPorCodePoint(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const pa = ca[i]!.codePointAt(0)!;
    const pb = cb[i]!.codePointAt(0)!;
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  return ca.length === cb.length ? 0 : (ca.length < cb.length ? -1 : 1);
}

export function ordenar(valores: Iterable<string>): string[] {
  return [...valores].sort(compararPorCodePoint);
}

/**
 * Forma canonica de comparacao: equivalente a
 * `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"))`.
 *
 * As chaves sao ordenadas explicitamente, em vez de confiar na ordem de
 * insercao do objeto JS — que vale para chave nao-inteira, mas reordenaria
 * silenciosamente uma chave numerica.
 */
export function canonizar(valor: Json): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonizar).join(",")}]`;
  const chaves = ordenar(Object.keys(valor));
  return `{${chaves.map((c) => `${JSON.stringify(c)}:${canonizar(valor[c]!)}`).join(",")}}`;
}

// --------------------------------------------------------------- datas civis
//
// `Date` NAO entra no Gateway. Ele e baseado em UTC e deslocaria uma fronteira
// de vigencia conforme o fuso do processo. Data civil e texto ISO-8601, e
// ISO-8601 ordena corretamente por comparacao lexicografica.

export type DataCivil = string;

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function ehDataCivil(valor: unknown): valor is DataCivil {
  return typeof valor === "string" && FORMATO_DATA.test(valor);
}

export function exigirDataCivil(valor: unknown, onde: string): DataCivil {
  if (!ehDataCivil(valor)) {
    throw new TypeError(`${onde}: data civil invalida (esperado YYYY-MM-DD): ${String(valor)}`);
  }
  return valor;
}

/** Vigencia inclusiva nas duas pontas. */
export function vigenteEm(
  referencia: DataCivil,
  inicio: DataCivil | null,
  fim: DataCivil | null,
): boolean {
  if (inicio !== null && referencia < inicio) return false;
  if (fim !== null && referencia > fim) return false;
  return true;
}
