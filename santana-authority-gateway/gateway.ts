// Santana Authority Gateway - implementacao definitiva TS/Deno.
//
// Porta unica entre o atendimento e o conhecimento/estado do Cemiterio Santana.
// Duas responsabilidades, e so essas:
//
// 1. `consultar` - responder um ponto do atendimento a partir do catalogo
//    oficial estruturado, sempre com `release_id`, `source_id`, aplicabilidade,
//    vigencia e status. Nao ha caminho que devolva texto gerado por modelo.
// 2. `registrarFato` - segunda validacao obrigatoria antes de qualquer escrita
//    no caso.
//
// Tudo falha fechado: o que nao pode ser determinado vira NOT_AVAILABLE com
// encaminhamento para a Administracao, nunca uma resposta aproximada.
//
// O LLM nao escolhe tarifa, nao escolhe `source_id` e nao decide
// aplicabilidade. Este modulo e onde isso deixa de ser intencao e vira
// impossibilidade estrutural.

import { carregar } from "./catalogo/carregar.ts";
import { consultar as consultarInterno, type Contexto } from "./consulta.ts";
import { ordenar } from "./canonico.ts";
import type { DataCivil, Json } from "./canonico.ts";
import { aceito, type ArgumentosCanonizados, canonizarArgumentos, type ContratoDeTool } from "./argumentos.ts";
import { ARGUMENTOS_NAO_CANONICOS, NAO_DISPONIVEL, resposta, type RespostaAutoritativa } from "./resposta.ts";

export { registrarFato } from "./escrita.ts";
export * from "./resposta.ts";
export type { Contexto } from "./consulta.ts";

export async function descreverRelease(): Promise<Record<string, Json>> {
  const oficial = await carregar();
  const aprovadas = [...oficial.fontes.values()].filter((f) => f.aprovada).map((f) => f.source_id);
  return {
    release_id: oficial.release_id,
    topic: oficial.topic,
    tipos_de_informacao: ordenar(oficial.tipos.keys()),
    fontes_aprovadas: ordenar(aprovadas),
    entradas_vigentes: oficial.entradas.length,
  };
}

export async function releaseId(): Promise<string> {
  return (await carregar()).release_id;
}

export async function consultar(
  tipo_informacao: string,
  contexto: Contexto = {},
  referencia: DataCivil,
): Promise<RespostaAutoritativa> {
  return await consultarInterno(tipo_informacao, contexto, referencia);
}

/**
 * Fronteira do Gateway: canoniza os argumentos ANTES de consultar.
 *
 * Devolve a resposta e o registro de canonizacao - o registro carrega o valor
 * bruto do evento, preservado literalmente para auditoria.
 *
 * Argumento fora do contrato nao e limpado nem ignorado: a consulta nao
 * acontece. Nao se responde uma pergunta cuja chamada chegou fora do contrato.
 */
export async function consultarViaTool(
  contratoDaTool: ContratoDeTool,
  argumentosBrutos: Json,
  tipo_informacao: string,
  contexto: Contexto = {},
  referencia: DataCivil,
): Promise<[RespostaAutoritativa, ArgumentosCanonizados]> {
  const registro = canonizarArgumentos(contratoDaTool, argumentosBrutos);
  if (!aceito(registro)) {
    const oficial = await carregar();
    return [
      resposta({
        release_id: oficial.release_id,
        tipo_informacao,
        status: NAO_DISPONIVEL,
        motivo: ARGUMENTOS_NAO_CANONICOS,
        aplicabilidade: { ...contexto },
      }),
      registro,
    ];
  }
  return [await consultarInterno(tipo_informacao, contexto, referencia), registro];
}
