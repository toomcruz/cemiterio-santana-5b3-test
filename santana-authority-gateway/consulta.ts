// Resolucao de aplicabilidade: o coracao do Gateway.
//
// Tres grupos, e a diferenca entre eles e o que separa "nao sei" de "de qual
// caso voce esta falando":
//
//   excluida    - algum criterio esta no contexto com OUTRO valor;
//   determinada - todos os criterios dela estao no contexto e batem;
//   candidata   - nao foi excluida, mas depende de criterio que o contexto nao
//                 informa.
//
// Com tres tarifas de exumacao na base, juntar candidata e excluida no mesmo
// balde esconderia exatamente a pergunta que precisa ser feita.

import {
  carregar,
  type CatalogoOficial,
  type Entrada,
  entradasDoTipo,
  entradaVigenteEm,
  especificidade,
} from "./catalogo/carregar.ts";
import { compararPorCodePoint, type DataCivil, type Json, ordenar } from "./canonico.ts";
import {
  CONFLITO,
  CONTEXTO_INCOMPATIVEL,
  CONTEXTO_INSUFICIENTE,
  DISPONIVEL,
  FONTES_EM_CONFLITO,
  FORA_DE_VIGENCIA,
  NAO_DISPONIVEL,
  PRECISA_DE_CONTEXTO,
  resposta,
  type RespostaAutoritativa,
  SEM_FONTE_OFICIAL,
  TIPO_DESCONHECIDO,
} from "./resposta.ts";

export type Contexto = Readonly<Record<string, string>>;

/**
 * A entrada esta descartada para este caso?
 *
 * So quando o contexto AFIRMA outra coisa. Criterio que o contexto nao informa
 * nao descarta nem confirma - vira pergunta.
 */
function excluida(aplicabilidade: Readonly<Record<string, string>>, contexto: Contexto): boolean {
  return Object.entries(aplicabilidade).some(
    ([chave, valor]) => chave in contexto && contexto[chave] !== valor,
  );
}

function assinaturaDoValor(entrada: Entrada): string {
  const chaves = ordenar(Object.keys(entrada.valor));
  return JSON.stringify(chaves.map((c) => [c, entrada.valor[c]] as [string, Json]));
}

export async function consultar(
  tipo_informacao: string,
  contexto: Contexto = {},
  referencia: DataCivil,
): Promise<RespostaAutoritativa> {
  const oficial: CatalogoOficial = await carregar();
  const base = { release_id: oficial.release_id, tipo_informacao };

  const spec = oficial.tipos.get(tipo_informacao);
  if (!spec) {
    return resposta({
      ...base,
      status: NAO_DISPONIVEL,
      motivo: TIPO_DESCONHECIDO,
      aplicabilidade: { ...contexto },
    });
  }

  const doTipo = entradasDoTipo(oficial, tipo_informacao);
  if (doTipo.length === 0) {
    // Nada publicado. Se o tipo exige fonte oficial, o motivo e esse; se nao
    // exige, e ausencia de entrada mesmo. Os dois encaminham.
    return resposta({
      ...base,
      status: NAO_DISPONIVEL,
      motivo: spec.exige_fonte_oficial ? SEM_FONTE_OFICIAL : FORA_DE_VIGENCIA,
      aplicabilidade: { ...contexto },
    });
  }

  const vigentes = doTipo.filter((e) => entradaVigenteEm(e, referencia));
  if (vigentes.length === 0) {
    return resposta({
      ...base,
      status: NAO_DISPONIVEL,
      motivo: FORA_DE_VIGENCIA,
      aplicabilidade: { ...contexto },
    });
  }

  const determinadas: Entrada[] = [];
  const candidatas: Entrada[] = [];
  for (const entrada of vigentes) {
    if (excluida(entrada.aplicabilidade, contexto)) continue;
    if (Object.keys(entrada.aplicabilidade).every((chave) => chave in contexto)) {
      determinadas.push(entrada);
    } else {
      candidatas.push(entrada);
    }
  }

  if (determinadas.length > 0) {
    const melhor = Math.max(...determinadas.map(especificidade));
    const finalistas = determinadas.filter((e) => especificidade(e) === melhor);

    const valores = new Set(finalistas.map(assinaturaDoValor));
    if (valores.size > 1) {
      // Fontes oficiais discordam para o mesmo caso: falha segura. Nenhum valor
      // sai daqui, e nao se desempata por fonte, por data ou por ordem.
      return resposta({
        ...base,
        status: CONFLITO,
        motivo: FONTES_EM_CONFLITO,
        aplicabilidade: { ...contexto },
        entradas_em_conflito: ordenar(finalistas.map((e) => e.entry_id)),
      });
    }

    // Desempate deterministico. Os finalistas ja tem valor identico, mas
    // `entry_id`, `source_id` e vigencia saem da entrada escolhida - e escolher
    // pela ordem do arquivo faria duas implementacoes corretas divergirem em V1
    // e V6. A ordem e por code point do `entry_id`, nunca colacao de locale.
    const escolhida = finalistas.reduce((a, b) => compararPorCodePoint(a.entry_id, b.entry_id) <= 0 ? a : b);
    return resposta({
      ...base,
      status: DISPONIVEL,
      valor: { ...escolhida.valor },
      aplicabilidade: { ...escolhida.aplicabilidade },
      source_id: escolhida.source_id,
      entry_id: escolhida.entry_id,
      vigencia_inicio: escolhida.vigencia_inicio,
      vigencia_fim: escolhida.vigencia_fim,
    });
  }

  if (candidatas.length === 0) {
    // O contexto contradiz todas as entradas conhecidas. Responder qualquer uma
    // seria responder o caso de outra pessoa.
    return resposta({
      ...base,
      status: NAO_DISPONIVEL,
      motivo: CONTEXTO_INCOMPATIVEL,
      aplicabilidade: { ...contexto },
    });
  }

  // Ha conhecimento oficial, falta saber de qual caso se trata. Quem pergunta e
  // o atendimento; o valor nunca e escolhido aqui nem pelo modelo.
  const faltantes = ordenar(
    new Set(
      candidatas.flatMap((e) => Object.keys(e.aplicabilidade).filter((c) => !(c in contexto))),
    ),
  );

  // Opcoes POR CAMPO, nunca uma lista plana. Com mais de um campo faltante a
  // lista plana nao dizia a qual campo cada opcao pertencia, e o atendimento
  // pergunta um campo por vez (R6): perguntar "servico" com as opcoes de
  // "modalidade_tarifaria" misturadas seria pedir ao municipe que escolhesse
  // numa lista que nao e a dele.
  const opcoes_por_campo: Record<string, readonly string[]> = {};
  for (const chave of faltantes) {
    opcoes_por_campo[chave] = ordenar(
      new Set(
        candidatas
          .filter((e) => chave in e.aplicabilidade)
          .map((e) => String(e.aplicabilidade[chave])),
      ),
    );
  }

  return resposta({
    ...base,
    status: PRECISA_DE_CONTEXTO,
    motivo: CONTEXTO_INSUFICIENTE,
    aplicabilidade: { ...contexto },
    contexto_faltante: faltantes,
    opcoes_por_campo,
  });
}
