// Codigos estruturados de falha de carga.
//
// Existem porque mensagem de excecao nao e portavel: o vetor V07-C compara a
// MESMA coisa nas duas implementacoes, e uma frase em portugues nao atravessa a
// fronteira Python/TypeScript. A frase continua, como diagnostico humano; o que
// o vetor compara e o codigo.

export const CATALOGO_NAO_ENCONTRADO = "CATALOGO_NAO_ENCONTRADO";
export const SCHEMA_NAO_SUPORTADO = "SCHEMA_NAO_SUPORTADO";
export const FONTE_INEXISTENTE = "FONTE_INEXISTENTE";
export const TIPO_DE_INFORMACAO_NAO_DECLARADO = "TIPO_DE_INFORMACAO_NAO_DECLARADO";

export class ErroDeCatalogo extends Error {
  readonly codigo: string;
  readonly mensagem: string;
  readonly detalhe: Record<string, unknown>;

  constructor(codigo: string, mensagem: string, detalhe: Record<string, unknown> = {}) {
    super(`${codigo}: ${mensagem}`);
    this.name = "ErroDeCatalogo";
    this.codigo = codigo;
    this.mensagem = mensagem;
    this.detalhe = detalhe;
  }
}
