/** Narrow conversational controls; never match mixed requests or negations. */
function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
}

export function isGreeting(text: string): boolean {
  return /^(?:o+i+|o+l+a+|bom dia|boa tarde|boa noite)(?: tudo bem)?$/.test(normalized(text));
}

export function isConversationReturn(text: string): boolean {
  return /^(?:(?:oi|ola) )?(?:(?:quero|gostaria de|preciso) )?(?:continuar|retomar)(?: (?:o |meu |este |a |minha |esta )?(?:atendimento|pedido|conversa))?$/
    .test(normalized(text));
}

export function isConversationClose(text: string): boolean {
  return /^(?:(?:quero|gostaria de|pode) )?enc(?:errar|arrar)(?: (?:o |meu |este |a |minha |esta )?(?:atendimento|chat|conversa))?$/
    .test(normalized(text));
}
