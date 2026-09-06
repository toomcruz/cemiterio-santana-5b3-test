// Fase 4E — ciclo de documentos e autoridade.
// Determinista, sem rede e fail-closed: LLM nunca aceita documentos.

export const DOCUMENTO_ESTADOS = [
  "SOLICITADO",
  "RECEBIDO",
  "ACEITO",
  "ILEGÍVEL_INADEQUADO",
  "CANCELADO",
  "INVALIDADO",
] as const;

export type DocumentoEstado = (typeof DOCUMENTO_ESTADOS)[number];
export type DocumentoAutoridade = "HUMANO" | "SISTEMA";

export interface Documento {
  documento_id: string;
  case_id: string | null;
  tipo: string;
  estado: DocumentoEstado;
  solicitado_em: string;
  recebido_em?: string;
  aceito_em?: string;
  aceito_por?: DocumentoAutoridade;
  descricao?: string;
}

export const TRANSICOES_DOCUMENTO: Record<DocumentoEstado, readonly DocumentoEstado[]> = {
  SOLICITADO: ["RECEBIDO", "CANCELADO"],
  RECEBIDO: ["ACEITO", "ILEGÍVEL_INADEQUADO"],
  ACEITO: ["INVALIDADO"],
  ILEGÍVEL_INADEQUADO: ["RECEBIDO", "CANCELADO"],
  CANCELADO: [],
  INVALIDADO: [],
};

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} obrigatorio`);
  }
}

function assertTimestamp(value: string, name: string): void {
  assertNonEmpty(value, name);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} invalido`);
}

export function createDocumento(input: {
  documento_id: string;
  case_id: string | null;
  tipo: string;
  solicitado_em: string;
  descricao?: string;
}): Documento {
  assertNonEmpty(input.documento_id, "documento_id");
  assertNonEmpty(input.tipo, "tipo");
  assertTimestamp(input.solicitado_em, "solicitado_em");
  return { ...input, estado: "SOLICITADO" };
}

export function valideAccept(
  doc: Documento,
  authority: DocumentoAutoridade,
): boolean {
  return doc.estado === "RECEBIDO" && authority === "HUMANO";
}

export function transitionDocumento(
  doc: Documento,
  next: DocumentoEstado,
  input: { ocorrido_em: string; autoridade?: DocumentoAutoridade },
): Documento {
  assertTimestamp(input.ocorrido_em, "ocorrido_em");
  if (!TRANSICOES_DOCUMENTO[doc.estado].includes(next)) {
    throw new Error(`transicao de documento invalida: ${doc.estado} → ${next}`);
  }
  if (next === "ACEITO" && !valideAccept(doc, input.autoridade ?? "SISTEMA")) {
    throw new Error("ACEITO exige validacao HUMANA explicita");
  }

  const result: Documento = { ...doc, estado: next };
  if (next === "RECEBIDO") result.recebido_em = input.ocorrido_em;
  if (next === "ACEITO") {
    result.aceito_em = input.ocorrido_em;
    result.aceito_por = "HUMANO";
  }
  return result;
}
