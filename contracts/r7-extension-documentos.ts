// R7 Extension — Documentos (FASE 4E, fora da fronteira)
// Contrato: estados de documento, invalidação seletiva, autoridade (humano/sistema)

export type DocumentoEstado = "SOLICITADO" | "RECEBIDO" | "ACEITO" | "ILEGÍVEL_INADEQUADO";
export type DocumentoAutoridade = "HUMANO" | "SISTEMA"; // Nunca LLM

export interface Documento {
  estado: DocumentoEstado;
  recebido_em?: string;        // ISO timestamp
  aceito_por?: DocumentoAutoridade;
  invalidado?: boolean;          // Seletivo por mudança de fato
  tipo?: string;                 // Foto, ID, Contrato, etc
  descricao?: string;
}

// Transições válidas por evento
export const TRANSICOES_DOCUMENTO = {
  SOLICITADO: ["RECEBIDO", "CANCELADO"],
  RECEBIDO: ["ACEITO", "ILEGÍVEL_INADEQUADO"],
  ACEITO: ["INVALIDADO"],
  ILEGÍVEL_INADEQUADO: ["RECEBIDO"],
  CANCELADO: [],
  INVALIDADO: [],
} as const;

// Validação: nenhuma inferência automática em ACEITO
export function valideAccept(doc: Documento, authority: DocumentoAutoridade): boolean {
  if (doc.estado !== "RECEBIDO") return false;
  if (authority === "HUMANO") return true;
  // Sistema só aceita se houver regra declarada (fora de 4E; TODO em 4F)
  return false;
}
