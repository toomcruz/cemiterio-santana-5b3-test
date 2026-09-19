/** Narrow conversational controls; never match mixed requests or negations. */
function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
}

export function isGreeting(text: string): boolean {
  return /^(?:o+i+|o+l+a+|bom dia|boa tarde|boa noite)(?: tudo bem)?$/.test(normalized(text));
}

export function isConversationReturn(text: string): boolean {
  const value = normalized(text);
  if (/\b(?:outro|outra)\s+(?:falecido|pessoa|caso|atendimento|conversa)\b/.test(value)) return false;
  if (/^(?:(?:oi|ola) )?(?:(?:quero|gostaria de|preciso) )?(?:continuar|retomar)(?: (?:o |meu |este |a |minha |esta )?(?:atendimento|pedido|conversa))?$/.test(value)) return true;
  return /^(?:voltei|volto|retornei|retorno)\b.*\b(?:assunto|atendimento|pedido|conversa|caso|jazigo|falecido|exumacao|recadastro|concessao)\b/.test(value) ||
    /^volto\s+para\b.+/.test(value) ||
    /^(?:quero|gostaria de|preciso)\s+(?:continuar|retomar)\b.+/.test(value);
}

export function isConversationClose(text: string): boolean {
  const value = normalized(text);
  if (/^(?:(?:quero|gostaria de|pode) )?enc(?:errar|arrar)(?: (?:o |meu |este |a |minha |esta )?(?:atendimento|chat|conversa))?$/.test(value)) return true;
  return /^(?:quero|gostaria de|pode|vamos)?\s*enc(?:errar|arrar)\b(?:\s+(?:o |meu |este |a |minha |esta )?(?:atendimento|chat|conversa))?(?:\s+(?:por enquanto|agora))?$/.test(value);
}

/** A restart request without a destination is a navigation command, not an answer. */
export function isConversationRestart(text: string): boolean {
  return /^(?:(?:quero|gostaria de|preciso|pode) )?(?:comecar|iniciar|recomecar)(?: (?:tudo )?(?:novamente|de novo|do zero))?(?: (?:o |um |meu )?(?:atendimento|pedido|conversa))?$/
    .test(normalized(text)) ||
    /^(?:novo|outro) atendimento$/.test(normalized(text));
}

/** Explicitly names a new attendance and therefore preserves the older case. */
export function requestsNewNamedAttendance(text: string): boolean {
  return /^(?:(?:quero|gostaria de|preciso) )?(?:comecar|iniciar|abrir|fazer)? ?(?:um )?(?:novo|outro) atendimento (?:de|sobre|para) .+$/
    .test(normalized(text));
}
