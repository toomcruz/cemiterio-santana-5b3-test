// Formato unico de resposta autoritativa.
//
// Toda resposta carrega de onde veio e a que caso se aplica. E isso que permite
// auditar depois, e e isso que impede o LLM de substituir o valor: o texto
// entregue ao municipe sai de `camposParaCanned()`, nunca de geracao livre.
//
// Status e motivos sao CODIGOS, nunca frases. O texto que chega ao municipe vem
// de canned response e do lexico de apresentacao (R5), nao daqui.

import type { DataCivil, Json } from "./canonico.ts";
import { ordenar } from "./canonico.ts";

export const DISPONIVEL = "AVAILABLE";
export const NAO_DISPONIVEL = "NOT_AVAILABLE";
export const CONFLITO = "CONFLICT";
// Ha conhecimento oficial e mais de uma entrada possivel para este caso. Nao e
// indisponibilidade e nao e conflito entre fontes: e falta de contexto. A saida
// certa e perguntar, nunca escolher - nem pelo Gateway, nem pelo modelo.
export const PRECISA_DE_CONTEXTO = "NEEDS_CONTEXT";

export const SEM_FONTE_OFICIAL = "SEM_FONTE_OFICIAL_CARREGADA";
export const TIPO_DESCONHECIDO = "TIPO_DE_INFORMACAO_DESCONHECIDO";
export const FORA_DE_VIGENCIA = "SEM_ENTRADA_VIGENTE";
export const FONTES_EM_CONFLITO = "FONTES_OFICIAIS_EM_CONFLITO";
export const CONTEXTO_INCOMPATIVEL = "CONTEXTO_INCOMPATIVEL_COM_AS_ENTRADAS";
export const CONTEXTO_INSUFICIENTE = "CONTEXTO_INSUFICIENTE_PARA_DETERMINAR";
// A chamada da tool violou o contrato canonico de argumentos (R1/V12). Falha
// fechada: nao se responde uma consulta cuja chamada chegou fora do contrato,
// nem se limpa o argumento e segue.
export const ARGUMENTOS_NAO_CANONICOS = "ARGUMENTOS_NAO_CANONICOS";

export interface RespostaAutoritativa {
  readonly release_id: string;
  readonly tipo_informacao: string;
  readonly status: string;
  readonly aplicabilidade: Readonly<Record<string, string>>;
  readonly valor: Readonly<Record<string, Json>> | null;
  readonly source_id: string | null;
  readonly entry_id: string | null;
  readonly vigencia_inicio: DataCivil | null;
  readonly vigencia_fim: DataCivil | null;
  readonly motivo: string | null;
  readonly entradas_em_conflito: readonly string[];
  readonly contexto_faltante: readonly string[];
  readonly opcoes_por_campo: Readonly<Record<string, readonly string[]>>;
}

export function resposta(
  parcial: Partial<RespostaAutoritativa> & {
    release_id: string;
    tipo_informacao: string;
    status: string;
  },
): RespostaAutoritativa {
  return {
    aplicabilidade: {},
    valor: null,
    source_id: null,
    entry_id: null,
    vigencia_inicio: null,
    vigencia_fim: null,
    motivo: null,
    entradas_em_conflito: [],
    contexto_faltante: [],
    opcoes_por_campo: {},
    ...parcial,
  };
}

/**
 * Falha segura: o que nao esta disponivel ou esta em conflito vai para a
 * Administracao. `NEEDS_CONTEXT` NAO encaminha - a informacao existe, falta
 * saber de qual caso se trata, e o caminho ali e perguntar.
 */
export function encaminharAdministracao(r: RespostaAutoritativa): boolean {
  return r.status === NAO_DISPONIVEL || r.status === CONFLITO;
}

export function precisaDeContexto(r: RespostaAutoritativa): boolean {
  return r.status === PRECISA_DE_CONTEXTO;
}

/**
 * Forma canonica da resposta.
 *
 * Ausencia por OMISSAO: a chave simplesmente nao aparece. `null` nao existe
 * nesta forma, e vazio e o valor vazio do tipo. A comparacao dos vetores e
 * total, entao emitir uma chave a mais reprova tanto quanto emitir uma a menos.
 */
export function asDict(r: RespostaAutoritativa): Record<string, Json> {
  const dados: Record<string, Json> = {
    release_id: r.release_id,
    tipo_informacao: r.tipo_informacao,
    status: r.status,
    aplicabilidade: { ...r.aplicabilidade },
    encaminhar_administracao: encaminharAdministracao(r),
    precisa_de_contexto: precisaDeContexto(r),
  };
  if (r.valor !== null) dados["valor"] = { ...r.valor };
  if (r.source_id !== null) dados["source_id"] = r.source_id;
  if (r.entry_id !== null) dados["entry_id"] = r.entry_id;
  if (r.vigencia_inicio !== null) dados["vigencia_inicio"] = r.vigencia_inicio;
  if (r.vigencia_fim !== null) dados["vigencia_fim"] = r.vigencia_fim;
  if (r.motivo !== null) dados["motivo"] = r.motivo;
  if (r.entradas_em_conflito.length > 0) {
    dados["entradas_em_conflito"] = [...r.entradas_em_conflito];
  }
  if (r.contexto_faltante.length > 0) {
    dados["contexto_faltante"] = [...r.contexto_faltante];
  }
  const campos = Object.keys(r.opcoes_por_campo);
  if (campos.length > 0) {
    const opcoes: Record<string, Json> = {};
    for (const campo of ordenar(campos)) opcoes[campo] = [...r.opcoes_por_campo[campo]!];
    dados["opcoes_por_campo"] = opcoes;
  }
  return dados;
}

/**
 * Campos que uma canned response pode interpolar.
 *
 * So sai campo quando o status e AVAILABLE. Em STRICT, uma resposta que depende
 * de um campo ausente nao pode ser enviada - que e exatamente o comportamento
 * desejado quando nao ha valor oficial.
 */
export function camposParaCanned(r: RespostaAutoritativa): Record<string, string> {
  if (r.status !== DISPONIVEL || r.valor === null) return {};
  const campos: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(r.valor)) campos[chave] = String(valor);
  return campos;
}
