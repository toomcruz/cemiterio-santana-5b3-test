// Estado de um atendimento de EXUMACAO.
//
// E a unica superficie mutavel do Gateway, e `registrarFato` e o unico caminho
// ate ela. Nenhum outro export aceita um caso e o modifica - ha teste de
// superficie exigindo isso.

import { CONFIRMED } from "./dominio/catalogo.ts";
import type { Json } from "./canonico.ts";

export interface FactRecord {
  readonly code: string;
  readonly value: Json;
  readonly source: string;
  readonly status: string;
}

export interface Caso {
  readonly case_id: string;
  readonly facts: Map<string, FactRecord>;
  readonly claims: Map<string, FactRecord>;
}

export function novoCaso(case_id = "caso"): Caso {
  return { case_id, facts: new Map(), claims: new Map() };
}

/** Fatos CONFIRMADOS pre-carregados. Alegacao pendente nao entra por aqui. */
export function comFatosConfirmados(
  caso: Caso,
  fatos: Readonly<Record<string, Json>>,
): Caso {
  for (const [code, value] of Object.entries(fatos)) {
    caso.facts.set(code, { code, value, source: "SYSTEM", status: CONFIRMED });
  }
  return caso;
}

export function confirmado(caso: Caso, code: string): Json | null {
  const registro = caso.facts.get(code);
  return registro && registro.status === CONFIRMED ? registro.value : null;
}

export interface EscritaObservada {
  readonly code: string;
  readonly destino: string;
  readonly status: string;
}

/** Fotografia das escritas do caso, para o executor de vetores comparar. */
export function escritas(caso: Caso): EscritaObservada[] {
  const registros: EscritaObservada[] = [];
  for (const [destino, tabela] of [["facts", caso.facts], ["claims", caso.claims]] as const) {
    for (const r of tabela.values()) {
      registros.push({ code: r.code, destino, status: r.status });
    }
  }
  registros.sort((a, b) =>
    a.destino === b.destino ? (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) : (a.destino < b.destino ? -1 : 1)
  );
  return registros;
}
