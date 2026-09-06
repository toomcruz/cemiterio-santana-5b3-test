// Contrato público da Fase 4E. A implementação canônica vive no domínio.
export {
  createDocumento,
  DOCUMENTO_ESTADOS,
  TRANSICOES_DOCUMENTO,
  transitionDocumento,
  valideAccept,
} from "../santana-conversation-domain/engine/documento.ts";
export type {
  Documento,
  DocumentoAutoridade,
  DocumentoEstado,
} from "../santana-conversation-domain/engine/documento.ts";
