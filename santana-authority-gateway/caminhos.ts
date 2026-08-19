// Resolucao de caminhos, identica a da implementacao de referencia.
//
// O catalogo oficial NAO vive dentro de nenhuma implementacao. Ele fica em
// `santana-authority/catalogo/`, caminho neutro, e as duas implementacoes leem
// o mesmo arquivo — uma unica copia operacional.
//
// Sem dependencia externa, como todo o resto do repositorio: nenhum import de
// jsr, npm ou URL. A juncao de caminho e feita a mao porque o unico separador
// que este projeto precisa e `/`.

export const DOMINIO = "santana-conversation-domain";

export function juntar(...partes: string[]): string {
  return partes
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter((p) => p.length > 0)
    .join("/");
}

/** Raiz do repositorio. `SANTANA_REPO_ROOT` existe para as fixtures dos vetores. */
export function raizDoRepo(): string {
  const override = Deno.env.get("SANTANA_REPO_ROOT");
  if (override) return override.replace(/\/+$/, "");
  // .../gateway/caminhos.ts -> raiz
  return decodeURIComponent(new URL("..", import.meta.url).pathname).replace(/\/+$/, "");
}

export function caminhoDoCatalogo(): string {
  const override = Deno.env.get("SANTANA_CATALOGO_OFICIAL");
  if (override) return override;
  return juntar(raizDoRepo(), "santana-authority", "catalogo", "exumacao.v1.json");
}

export function diretorioDoDominio(): string {
  return juntar(raizDoRepo(), DOMINIO);
}
