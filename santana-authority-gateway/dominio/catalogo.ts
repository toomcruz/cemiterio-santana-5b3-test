// Catalogos de dominio e escopo tecnico do assunto EXUMACAO.
//
// Nao reutiliza `santana-conversation-domain/engine/catalog.ts` de proposito:
// aquele modulo carrega os documentos no topo, a partir de caminhos fixos, o
// que e adequado para o P0 conversacional e impossivel para a fixture de
// dominio do V11-G, que precisa apontar para outro diretorio. `engine/` nao e
// tocado - os testes P0 dependem dele.
//
// O escopo de fatos vem do PERFIL COMPARTILHADO em `conformidade/perfis/`, o
// mesmo arquivo que a implementacao de referencia consome. Nao existe lista
// hardcoded aqui, e ha teste que falha se aparecer uma.

import { diretorioDoDominio, juntar, raizDoRepo } from "../caminhos.ts";
import type { Json } from "../canonico.ts";

export interface FactSpec {
  readonly code: string;
  readonly display_name: string;
  readonly value_type: string;
  readonly allowed_values: readonly string[];
  readonly allowed_sources: readonly string[];
  readonly ai_extractable: boolean;
  readonly authoritative_only: boolean;
  readonly derived: boolean;
  readonly resolution_action: string | null;
}

export function ehEnum(spec: FactSpec): boolean {
  return spec.value_type === "ENUM";
}

export interface PerfilDeConformidade {
  readonly topic_code: string;
  readonly primary_goal: string;
  readonly fact_codes: readonly string[];
}

function caminhoDoPerfil(): string {
  return juntar(raizDoRepo(), "conformidade", "perfis", "exumacao.v1.json");
}

const cachePerfil = new Map<string, PerfilDeConformidade>();

export function perfilDeConformidade(): PerfilDeConformidade {
  const caminho = caminhoDoPerfil();
  const cacheado = cachePerfil.get(caminho);
  if (cacheado) return cacheado;
  const doc = JSON.parse(Deno.readTextFileSync(caminho)) as Record<string, Json>;
  const perfil: PerfilDeConformidade = {
    topic_code: String(doc["topic_code"]),
    primary_goal: String(doc["primary_goal"]),
    fact_codes: doc["fact_codes"] as string[],
  };
  cachePerfil.set(caminho, perfil);
  return perfil;
}

// Escopo adicional, usado APENAS pelas fixtures dos vetores. Vazio em runtime,
// e ha teste que exige que continue vazio por padrao. A fixture acrescenta so
// no ambiente de conformidade: o perfil em disco nao e tocado.
let escopoDeFixture: readonly string[] = [];

export function definirEscopoDeFixture(codigos: readonly string[]): void {
  escopoDeFixture = [...codigos];
  cacheSpecs.clear();
}

export function escopoDeFatos(): readonly string[] {
  return [...perfilDeConformidade().fact_codes, ...escopoDeFixture];
}

const cacheSpecs = new Map<string, ReadonlyMap<string, FactSpec>>();

function specDeFato(bruto: Record<string, Json>): FactSpec {
  return {
    code: String(bruto["fact_code"]),
    display_name: String(bruto["display_name"] ?? bruto["fact_code"]),
    value_type: String(bruto["value_type"] ?? "TEXT"),
    allowed_values: (bruto["allowed_values"] ?? []) as string[],
    allowed_sources: (bruto["allowed_sources"] ?? []) as string[],
    ai_extractable: Boolean(bruto["ai_extractable"] ?? false),
    authoritative_only: Boolean(bruto["authoritative_only"] ?? false),
    derived: Boolean(bruto["derived"] ?? false),
    resolution_action: (bruto["resolution_action"] as string | undefined) ?? null,
  };
}

export function factSpecs(): ReadonlyMap<string, FactSpec> {
  const dominio = diretorioDoDominio();
  const chave = `${dominio} ${escopoDeFatos().join(",")}`;
  const cacheado = cacheSpecs.get(chave);
  if (cacheado) return cacheado;

  const doc = JSON.parse(
    Deno.readTextFileSync(juntar(dominio, "facts.v1.json")),
  ) as Record<string, Json>;
  const declarados = new Map<string, Record<string, Json>>();
  for (const bruto of doc["facts"] as Record<string, Json>[]) {
    declarados.set(String(bruto["fact_code"]), bruto);
  }

  const specs = new Map<string, FactSpec>();
  const ausentes: string[] = [];
  for (const code of escopoDeFatos()) {
    const bruto = declarados.get(code);
    if (!bruto) {
      ausentes.push(code);
      continue;
    }
    specs.set(code, specDeFato(bruto));
  }
  if (ausentes.length > 0) {
    throw new Error(`Fatos ausentes em facts.v1.json: ${ausentes.join(", ")}`);
  }
  cacheSpecs.set(chave, specs);
  return specs;
}

export function limparCaches(): void {
  cachePerfil.clear();
  cacheSpecs.clear();
}

// Origens que registram fato declarado pelo municipe.
export const USER_SOURCES = ["USER_EXPLICIT", "USER_CORRECTION"] as const;
export const CONFIRMED = "CONFIRMED";
export const REJECTED = "REJECTED";
