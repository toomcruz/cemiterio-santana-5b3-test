// Reexporta o que a ferramenta de round-trip usa do reducer canonico.
// Fase 4C / R8: ciclo de sessão NÃO passa por aqui — ver sessao_processo.ts.
export {
  applyAuthoritativeSignal,
  applyEvent,
  type ConversationEvent,
  type ConversationState,
  type FactInput,
  initState,
} from "./engine.ts";

export { DOCUMENTOS_FUTURE_KEY, R8_PROCESS_OBJECT_KEYS } from "./persistence.ts";
