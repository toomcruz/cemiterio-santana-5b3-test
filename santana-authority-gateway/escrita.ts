// Segunda validacao antes de qualquer escrita no caso. Falha fechada.
//
// A primeira validacao e o schema fechado da Tool. Esta aqui existe porque um
// schema correto prova o que foi OFERECIDO ao modelo, nao o que chegou: a
// chamada pode vir de um caminho novo, de um teste, ou de um prompt que
// convenceu o modelo a montar argumento diferente.
//
// Cada barreira recusa pelo SEU codigo. Recusar tudo com um codigo generico
// esconderia qual barreira agiu, e e a barreira que diz o que fazer em seguida.

import { carregar } from "./catalogo/carregar.ts";
import { type Caso } from "./caso.ts";
import { ehEnum, factSpecs, REJECTED, USER_SOURCES } from "./dominio/catalogo.ts";
import type { Json } from "./canonico.ts";

export const FATO_DESCONHECIDO = "FATO_DESCONHECIDO_NO_CATALOGO";
export const FATO_NAO_GRAVAVEL = "FATO_NAO_GRAVAVEL_PELO_ATENDIMENTO";
export const FATO_AUTORITATIVO = "FATO_AUTORITATIVO_SO_PELA_ADMINISTRACAO";
export const VALOR_FORA_DO_DOMINIO = "VALOR_FORA_DO_DOMINIO";
export const VALOR_VAZIO = "VALOR_VAZIO";
export const ORIGEM_INVALIDA = "ORIGEM_NAO_ACEITA";

export const GATEWAY_ID = "SantanaAuthorityGateway/v1";

interface Recusa {
  readonly fact_code: string;
  readonly motivo: string;
  readonly mensagem: string;
  readonly allowed_values?: readonly string[];
  readonly pending_action?: string | null;
}

async function recusar(r: Recusa): Promise<Record<string, Json>> {
  const oficial = await carregar();
  const dados: Record<string, Json> = {
    fact_code: r.fact_code,
    outcome: REJECTED,
    reason: r.motivo,
    message: r.mensagem,
    release_id: oficial.release_id,
    gateway: GATEWAY_ID,
  };
  if (r.allowed_values && r.allowed_values.length > 0) {
    dados["allowed_values"] = [...r.allowed_values];
  }
  if (r.pending_action) dados["pending_action"] = r.pending_action;
  return dados;
}

/**
 * Registra um fato declarado pelo municipe, ou recusa.
 *
 * O caso so e tocado depois que todas as barreiras passam. Em qualquer recusa,
 * nada e escrito - e o que os sete casos do V11 provam.
 */
export async function registrarFato(
  caso: Caso,
  fact_code: string,
  valor: Json,
  source = "USER_EXPLICIT",
): Promise<Record<string, Json>> {
  const specs = factSpecs();
  const spec = specs.get(fact_code);

  if (!spec) {
    return await recusar({
      fact_code,
      motivo: FATO_DESCONHECIDO,
      mensagem: "Fato desconhecido no catalogo do assunto Exumacao.",
    });
  }

  if (spec.authoritative_only) {
    // Nunca exposto em schema gravavel; se chegou aqui, e caminho novo.
    return await recusar({
      fact_code,
      motivo: FATO_AUTORITATIVO,
      mensagem: `'${spec.display_name}' so e confirmado pela Administracao do Cemiterio ` +
        `(sinal autoritativo ou documento).`,
      pending_action: spec.resolution_action,
    });
  }

  if (spec.derived || !spec.ai_extractable) {
    return await recusar({
      fact_code,
      motivo: FATO_NAO_GRAVAVEL,
      mensagem: `'${spec.display_name}' e derivado por regra deterministica ou nao pode ser ` +
        `extraido do atendimento.`,
    });
  }

  if (!(USER_SOURCES as readonly string[]).includes(source)) {
    return await recusar({
      fact_code,
      motivo: ORIGEM_INVALIDA,
      mensagem: `Origem '${source}' nao registra fato declarado pelo municipe.`,
    });
  }

  const texto = valor === null || valor === undefined ? "" : String(valor).trim();
  if (texto.length === 0) {
    return await recusar({
      fact_code,
      motivo: VALOR_VAZIO,
      mensagem: "Valor vazio nao registra fato.",
    });
  }

  if (ehEnum(spec)) {
    const normalizado = texto.toUpperCase().replaceAll(" ", "_");
    if (!spec.allowed_values.includes(normalizado)) {
      return await recusar({
        fact_code,
        motivo: VALOR_FORA_DO_DOMINIO,
        mensagem: `Valor fora do dominio de '${fact_code}'.`,
        allowed_values: spec.allowed_values,
      });
    }
  }

  const oficial = await carregar();
  caso.facts.set(fact_code, {
    code: fact_code,
    value: texto,
    source,
    status: "CONFIRMED",
  });
  return {
    fact_code,
    outcome: "ACCEPTED",
    value: texto,
    release_id: oficial.release_id,
    gateway: GATEWAY_ID,
  };
}
