from pathlib import Path
import subprocess

root = Path.cwd()
expected = {
    'santana-conversation-domain/runtime/interpreter/deterministic.ts': '07c057d5058c52bdbef4423407187a49e92bcdee',
    'santana-conversation-domain/runtime/official_information.ts': '0ab02ae5e40735085ad7a26cca411e8781e6860f',
    'santana-conversation-domain/runtime/procedure_knowledge.ts': '4cc0a129348634adffbbbd884e9fe28224d2fbf1',
    'santana-conversation-domain/runtime/reply.ts': '030efe147ba5e4091aede388216fa32c783811e9',
    'santana-conversation-domain/runtime/tests/procedure_knowledge_test.ts': 'f920dc3d4004cb172a4c831c98f02b9cbb4fe6af',
}
for path, sha in expected.items():
    assert subprocess.check_output(['git', 'hash-object', path], text=True).strip() == sha, 'Source changed: ' + path

p = root / 'santana-conversation-domain/runtime/procedure_knowledge.ts'
s = p.read_text()
s = s.replace('santana-procedures/1.0.0', 'santana-procedures/1.0.1')
s = s.replace('const VERIFY_NOTICE =\n  "Esse dado vem do material operacional anterior e precisa ser confirmado na fonte oficial vigente antes de ser tratado como atual.";', '''// Historical source values stay in the inventory for review. They are NOT a
// second authoritative price/document/calendar service.
export const PROCEDURAL_SOURCE = {
  id: "PROCEDIMENTOS_CEMITERIO_SANTANA_FLUXOGRAMA_E_RESUMOS.md",
  version: PROCEDURAL_CONTEXT_VERSION,
  authority: "CONTEXT_ONLY",
} as const;''')
s = s[:s.index('function aliasScore(')] + r'''
function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${P(phrase)} `);
}

/** A location alone is not a service. Negative and multiple requests need the
 * normal interpreter; string matching is never sufficient to change a case. */
export function findProcedure(text: string): ProcedureDefinition | null {
  const value = P(text);
  if (/\b(nao|nem|exceto|menos)\b/.test(value)) return null;
  // The source summary and the legacy commercial policy classify damaged
  // or stolen fixtures differently. Do not settle that conflict by alias.
  if (/\b(roub\w*|furt\w*|arromb\w*|viol\w*|danific\w*|vandal\w*)\b/.test(value) &&
    /\b(portao|porta|grade|lapide|placa)\b/.test(value)) return null;
  const matches: Array<{ procedure: ProcedureDefinition; score: number }> = [];
  for (const procedure of PROCEDURES) {
    if (procedure.code === "EXUMACAO_QUADRA_GERAL" && !/\b(exumacao|exumar)\b/.test(value)) continue;
    if (procedure.code === "OBITO_RECENTE_COM_JAZIGO" && !/\b(jazigo|concessao)\b/.test(value)) continue;
    // The source describes incoming transport. Generic/outgoing transport
    // cannot silently borrow that workflow.
    if (procedure.code === "TRANSLADO_PARA_SANTANA" &&
      (!/\b(?:para|pra|p|no) (?:o cemiterio )?santana\b/.test(value) ||
        /\b(?:sair|saindo|retirar|retirada|de santana para)\b/.test(value))) continue;
    const score = Math.max(0, ...procedure.aliases.filter(alias => containsPhrase(value, alias))
      .map(alias => P(alias).length));
    if (score) matches.push({ procedure, score });
  }
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best) return null;
  // Avoid a broad service-name hit obscuring an incident or a second request.
  if (matches.some(item => item.procedure.code === "VIOLACAO_FURTO_DANO") &&
    matches.some(item => item.procedure.code === "JAZIGO_LAPIDE_MANUTENCAO")) return null;
  if (/\b(tambem|alem disso|e depois|e ainda)\b/.test(value) && matches.length > 1) return null;
  if (matches[1]?.score === best.score) return null;
  return best.procedure;
}

export function procedureRouteHint(text: string): {
  procedure_code: ProcedureCode;
  goal_code: ProcedureGoalCode;
  subject_kind: ProcedureSubjectKind;
  evidence: string;
  confidence: "HIGH";
} | null {
  const procedure = findProcedure(text);
  if (!procedure) return null;
  return { procedure_code: procedure.code, ...procedure.route, evidence: text, confidence: "HIGH" };
}

export function procedureRouteHintsForPrompt(): Array<{
  procedure: ProcedureCode;
  aliases: string[];
  goal_code: ProcedureGoalCode;
}> {
  return PROCEDURES.map(procedure => ({
    procedure: procedure.code,
    aliases: procedure.aliases.filter(alias =>
      !(procedure.code === "EXUMACAO_QUADRA_GERAL" && alias === "quadra geral") &&
      !(procedure.code === "TRANSLADO_PARA_SANTANA" && ["translado", "traslado"].includes(alias))
    ),
    goal_code: procedure.route.goal_code,
  }));
}

function askKind(text: string): "documents" | "steps" | "deadline" | "price" | "contact" | "address" | "general" | null {
  const value = P(text);
  if (/\b(preco|precos|valor|valores|custo|custos|custa|custam|tarifa)\b/.test(value)) return "price";
  if (/\b(prazo|prazos|quanto tempo|demora|quantos dias|horario|horarios)\b/.test(value)) return "deadline";
  if (/\b(telefone|whatsapp|e mail|email|contato|canal)\b/.test(value)) return "contact";
  if (/\b(endereco|onde fica|como chegar)\b/.test(value)) return "address";
  if (/\b(documento|documentos|documentacao|papeis)\b/.test(value)) return "documents";
  if (/\b(como funciona|como fazer|como faco|quais as etapas|qual o procedimento|fluxo)\b/.test(value)) return "steps";
  if (/\b(o que e|o que eh|me explique|explica|explique)\b/.test(value)) return "general";
  return null;
}

function hasQuestion(text: string): boolean {
  const value = P(text);
  return /\?|\b(qual|quais|quanto|como|quando|onde|quem|por que|o que|me explique|explique|quero saber|gostaria de saber)\b/.test(text) ||
    /^(?:documentos|documentacao)(?: necessarios| necessaria)?(?: para .+)?$/.test(value);
}

function pendingFollowup(question: string | null | undefined): string {
  return question?.trim() ? `\n\nPara continuarmos o seu atendimento atual: ${question.trim()}` : "";
}

/** Explanatory scope only. No tariffs, deadlines, contacts, document checklist,
 * permissions or confirmed status can be produced from historical references.
 * The official information resolver remains the authority for those answers. */
export function proceduralDirectReply(input: {
  text: string;
  activeGoalCode?: string | null;
  pendingQuestion?: string | null;
}): string | null {
  const value = P(input.text);
  // Defense in depth: semantic controls, contradictions, media and corrections
  // must keep their existing response even when accompanied by a question.
  if (/\b(cancel\w*|desist\w*|corrig\w*|correcao|na verdade|mudei|nao quero|nao e|atendente|humano|finalizar|encerrar|outro atendimento|novo atendimento|outra pessoa|outro falecido)\b/.test(value)) return null;
  const kind = askKind(input.text);
  if (["price", "deadline", "contact", "address"].includes(kind ?? "")) return null;

  if (/\b(paguei|pagamento|pagar)\b.*\b(taxa|concessao)\b/.test(value) &&
    /\b(aprovad\w*|aberto|abriu|processo)\b/.test(value) && hasQuestion(input.text)) {
    return "O pagamento da taxa de concessão não significa, por si só, que o processo de concessão foi aberto ou aprovado. São etapas diferentes; a situação do processo precisa ser verificada separadamente." +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(?:ja comprei|ja contratei|comprei)\b.*\b(lapide|placa)\b/.test(value) &&
    /\b(chegou|instalacao|instalaram|andamento|status)\b/.test(value) && hasQuestion(input.text)) {
    return "Como a lápide já foi comprada, sua dúvida é de acompanhamento de serviço, não um novo orçamento. A data da compra e o local onde ela foi realizada ajudam a equipe a localizar o pedido. A instalação ainda precisa ser conferida; não tenho confirmação de conclusão." +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(faleceu agora|faleceu hoje|acabou de falecer|obito recente)\b/.test(value) && /\b(jazigo|concessao)\b/.test(value)) {
    return "Sinto muito pela sua perda. Como há um jazigo da família, o encaminhamento envolve identificar o nome do falecido e o jazigo e conferir a documentação e a concessão. Essa situação pede máxima prioridade à equipe, mas não significa horário automaticamente confirmado." +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(remarcar|reagendar|remarcacao)\b.*\bexumacao\b|\bexumacao\b.*\b(remarcar|reagendar|nova data)\b/.test(value)) {
    return "Para remarcar a exumação, a equipe precisa identificar o agendamento anterior e verificar a disponibilidade; somente então se confirma uma nova data. A data de preferência não deve ser informada como agendada antes da confirmação efetiva." +
      pendingFollowup(input.pendingQuestion);
  }
  if (!kind || !hasQuestion(input.text)) return null;
  const explicit = findProcedure(input.text);
  // Goal-only context cannot distinguish fee/process/provisional administration,
  // renewal/acquisition, grave location or transport direction.
  const procedure = explicit ?? (input.activeGoalCode === "GOAL_RECADASTRO"
    ? PROCEDURES.find(item => item.code === "RECADASTRO") ?? null : null);
  if (kind === "documents") {
    if (procedure || input.activeGoalCode === "GOAL_EXUMACAO" || /\bexumacao\b/.test(value)) {
      const scope = procedure?.label ?? "exumação";
      const context = scope.toLowerCase().includes("exumação")
        ? "Quadra Geral e Jazigo de Família têm conferências diferentes; no jazigo familiar também é preciso verificar a situação da concessão."
        : procedure?.summary ?? "É necessário identificar primeiro o procedimento e a situação do local.";
      return `A documentação para ${scope} depende da situação específica. ${context} A lista aplicável e eventuais autorizações precisam ser confirmadas pela Administração antes de serem tratadas como obrigatórias.` +
        pendingFollowup(input.pendingQuestion);
    }
    return null;
  }
  if (!procedure) {
    if (/\bexumacao\b/.test(value) || input.activeGoalCode === "GOAL_EXUMACAO") {
      return "A exumação é a retirada dos restos mortais. O procedimento envolve solicitação, conferência documental e análise, termo quando aplicável, agendamento e definição da destinação dos restos. Quadra Geral e Jazigo de Família seguem conferências diferentes. Os requisitos do seu caso e o agendamento ainda precisam ser confirmados pela equipe." +
        pendingFollowup(input.pendingQuestion);
    }
    if (/\b(traslado|translado|transporte)\b/.test(value)) {
      return "O translado envolve transferir os restos mortais de um local para outro. É preciso distinguir a origem e o destino antes de aplicar o fluxo e a documentação; não devo presumir que os restos virão para Santana." + pendingFollowup(input.pendingQuestion);
    }
    if (/\bconcessao\b/.test(value) || input.activeGoalCode === "GOAL_CONCESSAO") {
      return "Processo de concessão, geração da taxa e administração provisória são procedimentos diferentes. O pagamento da taxa não abre nem aprova automaticamente o processo. Qual deles corresponde à sua dúvida?";
    }
    if (/\bossuario\b/.test(value) || input.activeGoalCode === "GOAL_INFO_OSSUARIO") {
      return "O ossuário é destinado à guarda dos restos mortais. É preciso distinguir renovação de um espaço já contratado, aquisição e recebimento de restos de outro local. Sobre qual dessas situações é a sua dúvida?";
    }
    return null;
  }
  return `${procedure.label}: ${procedure.summary} As etapas gerais são: ${procedure.steps.join(" → ")}. Os requisitos aplicáveis ao caso e qualquer confirmação de execução dependem da equipe.` +
    pendingFollowup(input.pendingQuestion);
}
'''
p.write_text(s)

p = root / 'santana-conversation-domain/runtime/reply.ts'
s = p.read_text()
start = s.index('  // Business procedure knowledge')
end = s.index('  if (isBereavementStatement', start)
s = s[:start] + s[end:]
anchor = '  if (transition) return transition;\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + '''  // Explanatory context never supersedes a control, complaint, correction,
  // case change, attachment boundary or an actual human handoff.
  if (
    !input.next_state.handoff && input.outcome === "PROPOSED" &&
    !["HUMAN_REQUEST", "SOCIAL", "COMPLAINT", "CORRECTION", "CHANGE_OF_MIND", "RECLASSIFICATION"].includes(eventKind ?? "") &&
    !input.interpretation?.ambiguities.some(item => item.blocking)
  ) {
    const procedural = proceduralDirectReply({
      text: input.interpretation?.text_normalized ?? "",
      activeGoalCode: contextGoal(input.next_state)?.goal_code ?? null,
      pendingQuestion: questionDraft,
    });
    if (procedural) return procedural;
  }
''')
p.write_text(s)

p = root / 'santana-conversation-domain/runtime/interpreter/deterministic.ts'
s = p.read_text()
s = s.replace('  if (goal === null) {\n    const procedural = procedureRouteHint(input.text);', '  if (goal === null && (!input.context.has_open_goal || newSubjectMarker)) {\n    const procedural = procedureRouteHint(input.text);')
anchor = '  for (const pattern of lexicon.fact_patterns) {\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + r'''    // Owning a family grave during bereavement is not a stated transport
    // destination. Keep that distinction without manufacturing a new fact.
    if (
      pattern.fact_code === "transport_destination" &&
      /\b(temos|tenho|possuo|possuimos)\b.*\bjazigo\b/.test(text) &&
      !/\b(levar|transportar|transferir|transladar|colocar|destino)\b/.test(text) &&
      input.context.open_goal_code !== "GOAL_TRANSPORTE"
    ) continue;
''')
p.write_text(s)

p = root / 'santana-conversation-domain/runtime/official_information.ts'
s = p.read_text()
s = s.replace('import { authorityDomainSources, authoritySource } from "./generated_authority_assets.ts";', '''import { authorityDomainSources, authoritySource } from "./generated_authority_assets.ts";
import { proceduralDirectReply, PROCEDURAL_SOURCE } from "./procedure_knowledge.ts";''')
s = s.replace('  administration_required: boolean;', '  administration_required: boolean;\n  contextual_source?: typeof PROCEDURAL_SOURCE;')
s = s.replace('procedimento|procedimentos|regras|como funciona|como fazer|como faco|preciso saber', 'procedimento|procedimentos|regras|como funciona|como fazer|como faco|preciso saber|o que e|me explique|explique')
anchor = '  const base = { topic, information_type: type, preserves_goal: true as const };\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + r'''  // A summary enriches NOT_AVAILABLE explanations only. It never turns an
  // unreviewed document into an approved answer or overrides NEEDS_CONTEXT,
  // CONFLICT, a signed rule, a price, a timetable or a contact.
  const contextual = ["DOCUMENTOS", "PROCEDIMENTO_ADMINISTRATIVO", "TRANSPORTE", "OSSUARIO", "JAZIGO_DESTINO"].includes(type)
    ? proceduralDirectReply({ text: input.text, activeGoalCode: goal?.goal_code }) : null;
  const unavailableContext = () => ({
    ...base,
    text: contextual ? `${unavailable(type)}\n\n${contextual}` : unavailable(type),
    status: "NOT_AVAILABLE" as const,
    authority: null,
    administration_required: true,
    ...(contextual ? { contextual_source: PROCEDURAL_SOURCE } : {}),
  });
''')
old = '''    return {
      ...base,
      text: unavailable(type),
      status: "NOT_AVAILABLE",
      authority: null,
      administration_required: true,
    };'''
assert old in s
s = s.replace(old, '    return unavailableContext();', 1)
anchor = '''  return {
    ...base,
    text: unavailable(type),
    status: authority.status === "CONFLICT" ? "CONFLICT" : "NOT_AVAILABLE",'''
assert s.count(anchor) == 1
s = s.replace(anchor, '''  if (authority.status === "NOT_AVAILABLE" && contextual) {
    return { ...unavailableContext(), authority };
  }
  return {
    ...base,
    text: unavailable(type),
    status: authority.status === "CONFLICT" ? "CONFLICT" : "NOT_AVAILABLE",''')
p.write_text(s)

p = root / 'santana-conversation-domain/runtime/tests/procedure_knowledge_test.ts'
s = p.read_text().replace('Como funciona o translado?", "TRANSLADO_PARA_SANTANA"', 'Como funciona o translado para Santana?", "TRANSLADO_PARA_SANTANA"')
start = s.index('Deno.test("volatile values')
end = s.index('Deno.test("concession payment', start)
s = s[:start] + '''Deno.test("historical values never bypass official authority with a disclaimer", () => {
  for (const text of [
    "Quanto custa a exumação em quadra geral?",
    "Qual o prazo do processo de concessão?",
    "Qual o horário do recadastro?",
    "Qual o telefone da ouvidoria?",
    "Qual o endereço da agência?",
  ]) assertEquals(proceduralDirectReply({ text }), null);
});

''' + s[end:]
s = s.replace('      "translado",', '      "translado para Santana",').replace('      "óbito recente",', '      "óbito recente com jazigo",')
p.write_text(s)
print('Applied five source-pinned changes; no production API called.')
