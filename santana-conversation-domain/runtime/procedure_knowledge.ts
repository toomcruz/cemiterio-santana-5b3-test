export const PROCEDURAL_CONTEXT_VERSION = "santana-procedures/1.0.1";

export type ProcedureGoalCode =
  | "GOAL_TRANSPORTE"
  | "GOAL_EXUMACAO"
  | "GOAL_RECADASTRO"
  | "GOAL_CONCESSAO"
  | "GOAL_COMERCIAL"
  | "GOAL_JAZIGO_SERVICOS"
  | "GOAL_RECLAMACAO"
  | "GOAL_INFO_OSSUARIO"
  | "GOAL_INFO_HORARIO"
  | "GOAL_OUTROS_ASSUNTOS";
export type ProcedureSubjectKind = "DECEASED" | "CONCESSION" | "GRAVE" | "ORDER" | "GENERIC";
export type ProcedureCode =
  | "RECADASTRO"
  | "EXUMACAO_QUADRA_GERAL"
  | "EXUMACAO_JAZIGO_FAMILIA"
  | "OSSUARIO_RENOVACAO"
  | "OSSUARIO_AQUISICAO"
  | "CONCESSAO_PROCESSO"
  | "CONCESSAO_TAXA"
  | "ADMINISTRACAO_PROVISORIA"
  | "CINZAS_EM_JAZIGO"
  | "TRANSLADO_PARA_SANTANA"
  | "OBITO_RECENTE_COM_JAZIGO"
  | "JAZIGO_LAPIDE_MANUTENCAO"
  | "SERVICO_FUNERARIO"
  | "REMARCACAO_EXUMACAO"
  | "VIOLACAO_FURTO_DANO"
  | "OUVIDORIA";

type RecordedInfo = { label: string; value: string; requiresCurrentVerification: true };
export type ProcedureDefinition = {
  code: ProcedureCode;
  label: string;
  aliases: string[];
  route: { goal_code: ProcedureGoalCode; subject_kind: ProcedureSubjectKind };
  summary: string;
  steps: string[];
  documents: string[];
  stableRules: string[];
  recorded: RecordedInfo[];
};

// Historical source values stay in the inventory for review. They are NOT a
// second authoritative price/document/calendar service.
export const PROCEDURAL_SOURCE = {
  id: "PROCEDIMENTOS_CEMITERIO_SANTANA_FLUXOGRAMA_E_RESUMOS.md",
  version: PROCEDURAL_CONTEXT_VERSION,
  authority: "CONTEXT_ONLY",
} as const;

export function normalizeProcedureText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const P = (value: string): string => normalizeProcedureText(value);

export const PROCEDURES: readonly ProcedureDefinition[] = [
  {
    code: "RECADASTRO",
    label: "Recadastro",
    aliases: ["recadastro", "recadastramento", "atualizar cadastro", "cadastro da concessao"],
    route: { goal_code: "GOAL_RECADASTRO", subject_kind: "CONCESSION" },
    summary:
      "Atualização cadastral do jazigo/concessão e dos dados do responsável ou concessionário, presencialmente na Administração ou pelo serviço online.",
    steps: [
      "apresentar dados e documentos",
      "conferência cadastral",
      "complementação documental quando necessária",
      "atualização do cadastro",
      "conclusão",
    ],
    documents: [
      "documento de identificação",
      "comprovante de endereço",
      "carta de concessão ou documentação relacionada à sucessão",
      "certidões de óbito, quando aplicável",
    ],
    stableRules: [
      "Para localizar ossuário, a referência registrada usa bloco A a I e/ou número do ossuário; isso não deve ser confundido com quadra, terreno ou lote.",
    ],
    recorded: [
      { label: "horário presencial", value: "08h00 às 16h00", requiresCurrentVerification: true },
      { label: "prazo online", value: "15 a 30 dias", requiresCurrentVerification: true },
      {
        label: "canal online",
        value: "https://www.consolare.online/recadastramento",
        requiresCurrentVerification: true,
      },
    ],
  },
  {
    code: "EXUMACAO_QUADRA_GERAL",
    label: "Exumação em Quadra Geral",
    aliases: ["exumacao quadra geral", "quadra geral", "exumar quadra", "exumacao em quadra"],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary:
      "Retirada dos restos mortais em sepultamento de Quadra Geral após o período mínimo aplicável, seguida da destinação definida para os restos.",
    steps: [
      "solicitação",
      "conferência da documentação",
      "análise do pedido",
      "termo/assinatura quando aplicável",
      "agendamento",
      "exumação",
      "destinação dos restos mortais",
      "conclusão",
    ],
    documents: ["certidão de óbito", "documento de identificação", "comprovante de endereço", "telefone para contato"],
    stableRules: [
      "Documentação complementar pode ser exigida conforme a situação, como Certidão de Objeto e Pé em morte não natural/suspeita, CadÚnico em situações relacionadas a baixa renda e documento hospitalar de doação de órgãos quando aplicável.",
      "A existência de horários disponíveis não significa confirmação automática de agendamento.",
    ],
    recorded: [
      { label: "prazo mínimo adulto", value: "3 anos após o sepultamento", requiresCurrentVerification: true },
      { label: "prazo mínimo criança de até 6 anos", value: "2 anos", requiresCurrentVerification: true },
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
      { label: "horários registrados", value: "08h30, 09h00 e 09h30", requiresCurrentVerification: true },
      { label: "valor de exumação", value: "R$ 351,67", requiresCurrentVerification: true },
    ],
  },
  {
    code: "EXUMACAO_JAZIGO_FAMILIA",
    label: "Exumação em Jazigo de Família",
    aliases: [
      "exumacao jazigo de familia",
      "exumacao jazigo familiar",
      "exumar jazigo de familia",
      "exumacao no jazigo",
    ],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary:
      "Retirada de restos mortais de pessoa sepultada em jazigo de família, com conferência da concessão, documentação, análise e autorização quando aplicável.",
    steps: [
      "solicitação",
      "identificação do jazigo",
      "conferência da concessão",
      "conferência dos documentos",
      "análise",
      "termo/autorização quando aplicável",
      "agendamento",
      "exumação",
      "destinação",
      "conclusão",
    ],
    documents: [
      "identificação do falecido",
      "identificação do interessado",
      "documentação da concessão",
      "carta de concessão ou administração temporária válida, quando aplicável",
    ],
    stableRules: [
      "Parentesco, sucessão, legitimidade, autorização familiar e titularidade podem exigir análise específica.",
    ],
    recorded: [
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
      { label: "valor", value: "R$ 729,65", requiresCurrentVerification: true },
    ],
  },
  {
    code: "OSSUARIO_RENOVACAO",
    label: "Renovação de Ossuário",
    aliases: ["renovar ossuario", "renovacao ossuario", "renovacao de ossuario", "permanencia no ossuario"],
    route: { goal_code: "GOAL_INFO_OSSUARIO", subject_kind: "GENERIC" },
    summary: "Renovação da permanência dos restos mortais em ossuário pelo período contratado.",
    steps: [
      "identificação do ossuário",
      "solicitação da renovação",
      "conferência dos dados",
      "pagamento quando aplicável",
      "formalização da renovação",
      "conclusão",
    ],
    documents: [],
    stableRules: ["A localização registrada do ossuário usa bloco A a I e número do ossuário."],
    recorded: [
      { label: "período registrado", value: "5 anos", requiresCurrentVerification: true },
      { label: "valor", value: "R$ 386,65", requiresCurrentVerification: true },
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
    ],
  },
  {
    code: "OSSUARIO_AQUISICAO",
    label: "Aquisição de Ossuário",
    aliases: [
      "comprar ossuario",
      "adquirir ossuario",
      "aquisicao ossuario",
      "aquisicao de ossuario",
      "ossuario indeterminado",
    ],
    route: { goal_code: "GOAL_COMERCIAL", subject_kind: "ORDER" },
    summary:
      "Contratação de espaço para guarda de restos mortais, por período determinado ou por prazo indeterminado conforme a modalidade.",
    steps: [
      "solicitação",
      "identificação da origem dos restos",
      "definição da modalidade",
      "conferência documental",
      "pagamento",
      "documentação/memorandos",
      "recebimento e acomodação",
      "conclusão",
    ],
    documents: ["quando os restos vêm de outro local, a documentação e os memorandos dependem da origem e da situação"],
    stableRules: [],
    recorded: [
      { label: "modalidade de 5 anos", value: "R$ 386,65", requiresCurrentVerification: true },
      { label: "modalidade por prazo indeterminado", value: "R$ 2.955,70", requiresCurrentVerification: true },
      {
        label: "referência de antecedência para origem externa",
        value: "14 dias em algumas situações",
        requiresCurrentVerification: true,
      },
    ],
  },
  {
    code: "CONCESSAO_PROCESSO",
    label: "Processo de Concessão",
    aliases: [
      "processo de concessao",
      "sucessao do jazigo",
      "novo concessionario",
      "transferencia da concessao",
      "renuncia da concessao",
      "devolucao do jazigo",
      "titularidade da concessao",
    ],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary:
      "Processo administrativo ligado à concessão/titularidade do jazigo, incluindo sucessão, novo concessionário, transferência, renúncia e devolução.",
    steps: [
      "identificar a situação do jazigo",
      "verificar o concessionário",
      "recadastro",
      "reunir documentos",
      "abrir o processo",
      "análise administrativa",
      "complementação se necessária",
      "decisão/conclusão",
    ],
    documents: [
      "a documentação depende da situação de sucessão, transferência, renúncia, devolução ou definição do novo concessionário",
    ],
    stableRules: [
      "O material registra recadastro atualizado como requisito relacionado ao processo.",
      "O prazo do processo administrativo não deve ser interpretado automaticamente como prazo de cada etapa individual.",
    ],
    recorded: [
      { label: "prazo do processo", value: "até 180 dias", requiresCurrentVerification: true },
      { label: "WhatsApp", value: "(11) 91615-8664", requiresCurrentVerification: true },
      { label: "e-mail", value: "concessao@consolare.com.br", requiresCurrentVerification: true },
    ],
  },
  {
    code: "CONCESSAO_TAXA",
    label: "Taxa de Concessão",
    aliases: [
      "taxa de concessao",
      "pagar taxa de concessao",
      "pagamento concessao",
      "pix concessao",
      "cartao concessao",
    ],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary:
      "Etapa de pagamento relacionada à concessão, separada da abertura, análise e aprovação do processo administrativo.",
    steps: [
      "identificar a localização do jazigo",
      "identificar o concessionário",
      "definir forma de pagamento",
      "realizar o pagamento conforme orientação vigente",
    ],
    documents: [],
    stableRules: [
      "O pagamento da taxa, por si só, não significa que o processo de concessão foi aberto ou aprovado.",
      "Pagamento e processo administrativo são etapas diferentes.",
    ],
    recorded: [
      { label: "prazo", value: "até 5 dias úteis", requiresCurrentVerification: true },
      { label: "valor", value: "R$ 94,00", requiresCurrentVerification: true },
      { label: "formas registradas", value: "PIX e cartão", requiresCurrentVerification: true },
    ],
  },
  {
    code: "ADMINISTRACAO_PROVISORIA",
    label: "Administração Provisória",
    aliases: [
      "administracao provisoria",
      "administracao temporaria",
      "administrador provisorio",
      "administrador temporario",
    ],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary: "Administração temporária do jazigo enquanto a situação definitiva da concessão é resolvida.",
    steps: [
      "solicitação",
      "identificação da situação do jazigo",
      "documentação",
      "análise",
      "administração provisória",
      "conclusão",
    ],
    documents: ["documentação conforme a situação do jazigo e da representação temporária"],
    stableRules: ["Não equivale a transferência definitiva, concessão, venda, renúncia ou devolução do jazigo."],
    recorded: [{ label: "prazo", value: "até 5 dias úteis", requiresCurrentVerification: true }],
  },
  {
    code: "CINZAS_EM_JAZIGO",
    label: "Cinzas em Jazigo",
    aliases: ["cinzas no jazigo", "cinzas em jazigo", "colocar cinzas", "guardar cinzas", "urna de cinzas"],
    route: { goal_code: "GOAL_COMERCIAL", subject_kind: "ORDER" },
    summary:
      "Procedimento para colocação ou guarda de cinzas em jazigo, sujeito a identificação do jazigo, documentação, análise e agendamento.",
    steps: [
      "solicitação",
      "identificação do jazigo",
      "conferência da documentação",
      "análise",
      "agendamento",
      "realização",
      "conclusão",
    ],
    documents: [
      "a documentação varia conforme a situação; o material não define uma lista universal para todos os casos",
    ],
    stableRules: ["O agendamento só deve ser considerado confirmado quando houver confirmação efetiva."],
    recorded: [{ label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true }],
  },
  {
    code: "TRANSLADO_PARA_SANTANA",
    label: "Translado para o Cemitério Santana",
    aliases: [
      "translado",
      "traslado",
      "translado para santana",
      "traslado para santana",
      "trazer restos para santana",
      "trazer para o cemiterio santana",
      "transferir restos para santana",
    ],
    route: { goal_code: "GOAL_TRANSPORTE", subject_kind: "DECEASED" },
    summary: "Transferência de restos mortais provenientes de outro local para o Cemitério Santana.",
    steps: [
      "solicitação",
      "identificação da origem",
      "identificação do destino",
      "documentação",
      "memorandos/autorizações",
      "análise",
      "agendamento",
      "translado",
      "recebimento em Santana",
      "destinação final",
    ],
    documents: [
      "documentação e memorandos ligados ao translado; a lista exata depende da origem, destino e situação do falecido",
    ],
    stableRules: ["O agendamento só deve ser tratado como confirmado quando houver confirmação efetiva."],
    recorded: [
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
      {
        label: "referência de antecedência",
        value: "14 dias em algumas situações de translado",
        requiresCurrentVerification: true,
      },
    ],
  },
  {
    code: "OBITO_RECENTE_COM_JAZIGO",
    label: "Óbito Recente com Jazigo",
    aliases: [
      "obito recente",
      "faleceu agora",
      "faleceu hoje",
      "acabou de falecer",
      "falecimento recente",
      "sepultar no jazigo da familia",
      "sepultamento no jazigo da familia",
    ],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary: "Encaminhamento de sepultamento de pessoa falecida recentemente quando existe jazigo/concessão familiar.",
    steps: [
      "comunicação do óbito",
      "identificação do falecido",
      "identificação do jazigo",
      "conferência da documentação",
      "verificação da situação da concessão",
      "agendamento/encaminhamento",
      "sepultamento",
      "registro",
    ],
    documents: [
      "documentos do falecido",
      "certidão/documentação do óbito",
      "informações do jazigo",
      "documentação do concessionário ou responsável conforme a situação",
    ],
    stableRules: [
      "É uma situação de prioridade máxima no material operacional.",
      "Prioridade não significa confirmação automática de horário ou realização do sepultamento.",
    ],
    recorded: [],
  },
  {
    code: "JAZIGO_LAPIDE_MANUTENCAO",
    label: "Serviços em Jazigo, Lápide e Manutenção",
    aliases: [
      "lapide",
      "portao do jazigo",
      "limpeza do jazigo",
      "pintura do jazigo",
      "manutencao do jazigo",
      "reforma do jazigo",
      "consertar jazigo",
      "servico no jazigo",
    ],
    route: { goal_code: "GOAL_JAZIGO_SERVICOS", subject_kind: "GRAVE" },
    summary: "Atendimentos físicos no jazigo, como lápide, portão, limpeza, pintura, manutenção e reforma.",
    steps: [
      "solicitação",
      "identificação do jazigo",
      "identificação do serviço",
      "verificação se há contratação/orçamento",
      "encaminhamento ao setor responsável",
      "orçamento/execução",
      "conclusão",
    ],
    documents: [],
    stableRules: [
      "É comercial quando há intenção clara de contratar, comprar, pedir orçamento, executar, substituir, instalar ou reparar.",
      "Se a lápide já foi comprada/contratada, perguntas sobre chegada, instalação, andamento ou status são acompanhamento de serviço, não novo orçamento.",
      "No acompanhamento de lápide, devem ser identificados a data da compra e o local da compra quando aplicável.",
    ],
    recorded: [
      { label: "prazo de retorno comercial", value: "até 24 horas", requiresCurrentVerification: true },
      {
        label: "referência histórica para chegada/instalação de lápide já contratada",
        value: "aproximadamente 20 a 30 dias úteis",
        requiresCurrentVerification: true,
      },
    ],
  },
  {
    code: "SERVICO_FUNERARIO",
    label: "Serviço Funerário, Velório e Sepultamento",
    aliases: ["servico funerario", "funeral", "velorio", "sepultamento", "agencia funeraria", "central funeraria"],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary:
      "Assuntos de funeral, velório e sepultamento podem depender da estrutura funerária e dos canais específicos registrados.",
    steps: [
      "identificar a necessidade",
      "direcionar ao canal funerário/administrativo adequado",
      "confirmar condições vigentes antes de prometer atendimento ou valor",
    ],
    documents: [],
    stableRules: [],
    recorded: [
      { label: "central", value: "0800 0800 190", requiresCurrentVerification: true },
      { label: "agência", value: "Rua Nova dos Portugueses, 146", requiresCurrentVerification: true },
      { label: "atendimento da agência", value: "24 horas", requiresCurrentVerification: true },
      { label: "pacote de ossuário", value: "R$ 5.199,00", requiresCurrentVerification: true },
    ],
  },
  {
    code: "REMARCACAO_EXUMACAO",
    label: "Remarcação de Exumação",
    aliases: [
      "remarcar exumacao",
      "remarcar a exumacao",
      "remarcacao de exumacao",
      "reagendar exumacao",
      "reagendar a exumacao",
      "nova data exumacao",
      "exumacao foi cancelada",
      "exumacao nao pode ser realizada",
    ],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary: "Reagendamento quando uma exumação previamente prevista não pode ser realizada.",
    steps: [
      "identificar a exumação prevista",
      "registrar a impossibilidade",
      "comunicar o responsável",
      "verificar disponibilidade",
      "confirmar novo agendamento",
      "realizar a exumação",
    ],
    documents: [],
    stableRules: [
      "Motivos operacionais podem incluir condições climáticas.",
      "A nova data só deve ser informada como agendada depois de confirmação efetiva.",
    ],
    recorded: [],
  },
  {
    code: "VIOLACAO_FURTO_DANO",
    label: "Violação, Furto ou Dano",
    aliases: [
      "jazigo violado",
      "violacao",
      "furto",
      "roubo",
      "arrombamento",
      "arrombado",
      "arrombaram",
      "sumiu do jazigo",
      "objeto desapareceu",
      "dano no jazigo",
      "vandalismo",
    ],
    route: { goal_code: "GOAL_JAZIGO_SERVICOS", subject_kind: "GRAVE" },
    summary:
      "Ocorrência envolvendo possível violação, furto, dano, arrombamento ou desaparecimento de objeto no jazigo.",
    steps: [
      "registrar o relato como ocorrência",
      "identificar o jazigo/local",
      "preservar fotos e informações disponíveis",
      "encaminhar para análise humana/administrativa",
    ],
    documents: [],
    stableRules: [
      "Não deve ser tratada como simples pedido comercial de manutenção.",
      "O relato do munícipe não confirma por si só a ocorrência; a situação precisa de análise humana/administrativa.",
    ],
    recorded: [],
  },
  {
    code: "OUVIDORIA",
    label: "Ouvidoria",
    aliases: ["ouvidoria", "reclamacao na ouvidoria", "falar com ouvidoria"],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary: "Canal para manifestações dirigidas à Ouvidoria.",
    steps: [
      "identificar a manifestação",
      "orientar o canal de Ouvidoria",
      "preservar o atendimento corrente se houver outro assunto em andamento",
    ],
    documents: [],
    stableRules: [],
    recorded: [{ label: "e-mail", value: "contato@consolare.com.br", requiresCurrentVerification: true }],
  },
];

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
  if (
    /\b(roub\w*|furt\w*|arromb\w*|viol\w*|danific\w*|vandal\w*)\b/.test(value) &&
    /\b(portao|porta|grade|lapide|placa)\b/.test(value)
  ) return null;
  const matches: Array<{ procedure: ProcedureDefinition; score: number }> = [];
  for (const procedure of PROCEDURES) {
    if (procedure.code === "EXUMACAO_QUADRA_GERAL" && !/\b(exumacao|exumar)\b/.test(value)) continue;
    if (procedure.code === "OBITO_RECENTE_COM_JAZIGO" && !/\b(jazigo|concessao)\b/.test(value)) continue;
    // The source describes incoming transport. Generic/outgoing transport
    // cannot silently borrow that workflow.
    if (
      procedure.code === "TRANSLADO_PARA_SANTANA" &&
      (!/\b(?:para|pra|p|no) (?:o cemiterio )?santana\b/.test(value) ||
        /\b(?:sair|saindo|retirar|retirada|de santana para)\b/.test(value))
    ) continue;
    const score = Math.max(
      0,
      ...procedure.aliases.filter((alias) => containsPhrase(value, alias))
        .map((alias) => P(alias).length),
    );
    if (score) matches.push({ procedure, score });
  }
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best) return null;
  // Avoid a broad service-name hit obscuring an incident or a second request.
  if (
    matches.some((item) => item.procedure.code === "VIOLACAO_FURTO_DANO") &&
    matches.some((item) => item.procedure.code === "JAZIGO_LAPIDE_MANUTENCAO")
  ) return null;
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
  return PROCEDURES.map((procedure) => ({
    procedure: procedure.code,
    aliases: procedure.aliases.filter((alias) =>
      !(procedure.code === "EXUMACAO_QUADRA_GERAL" && alias === "quadra geral") &&
      !(procedure.code === "TRANSLADO_PARA_SANTANA" && ["translado", "traslado"].includes(alias))
    ),
    goal_code: procedure.route.goal_code,
  }));
}

function askKind(
  text: string,
): "documents" | "steps" | "deadline" | "price" | "contact" | "address" | "general" | null {
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
  return /\?|\b(qual|quais|quanto|como|quando|onde|quem|por que|o que|me explique|explique|quero saber|gostaria de saber)\b/
    .test(text) ||
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
  if (
    /\b(cancel\w*|desist\w*|corrig\w*|correcao|na verdade|mudei|nao quero|nao e|atendente|humano|finalizar|encerrar|outro atendimento|novo atendimento|outra pessoa|outro falecido)\b/
      .test(value)
  ) return null;
  const kind = askKind(input.text);
  if (["price", "deadline", "contact", "address"].includes(kind ?? "")) return null;

  if (
    /\b(paguei|pagamento|pagar)\b.*\b(taxa|concessao)\b/.test(value) &&
    /\b(aprovad\w*|aberto|abriu|processo)\b/.test(value) && hasQuestion(input.text)
  ) {
    return "O pagamento da taxa de concessão não significa, por si só, que o processo de concessão foi aberto ou aprovado. São etapas diferentes; a situação do processo precisa ser verificada separadamente." +
      pendingFollowup(input.pendingQuestion);
  }
  if (
    /\b(?:ja comprei|ja contratei|comprei)\b.*\b(lapide|placa)\b/.test(value) &&
    /\b(chegou|instalacao|instalaram|andamento|status)\b/.test(value) && hasQuestion(input.text)
  ) {
    return "Como a lápide já foi comprada, sua dúvida é de acompanhamento de serviço, não um novo orçamento. A data da compra e o local onde ela foi realizada ajudam a equipe a localizar o pedido. A instalação ainda precisa ser conferida; não tenho confirmação de conclusão." +
      pendingFollowup(input.pendingQuestion);
  }
  if (
    /\b(faleceu agora|faleceu hoje|acabou de falecer|obito recente)\b/.test(value) &&
    /\b(jazigo|concessao)\b/.test(value)
  ) {
    return "Sinto muito pela sua perda. Como há um jazigo da família, o encaminhamento envolve identificar o nome do falecido e o jazigo e conferir a documentação e a concessão. Essa situação pede máxima prioridade à equipe, mas não significa horário automaticamente confirmado." +
      pendingFollowup(input.pendingQuestion);
  }
  if (
    /\b(remarcar|reagendar|remarcacao)\b.*\bexumacao\b|\bexumacao\b.*\b(remarcar|reagendar|nova data)\b/.test(value)
  ) {
    return "Para remarcar a exumação, a equipe precisa identificar o agendamento anterior e verificar a disponibilidade; somente então se confirma uma nova data. A data de preferência não deve ser informada como agendada antes da confirmação efetiva." +
      pendingFollowup(input.pendingQuestion);
  }
  if (!kind || !hasQuestion(input.text)) return null;
  const explicit = findProcedure(input.text);
  // Goal-only context cannot distinguish fee/process/provisional administration,
  // renewal/acquisition, grave location or transport direction.
  const procedure = explicit ??
    (input.activeGoalCode === "GOAL_RECADASTRO" ? PROCEDURES.find((item) => item.code === "RECADASTRO") ?? null : null);
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
      return "O translado envolve transferir os restos mortais de um local para outro. É preciso distinguir a origem e o destino antes de aplicar o fluxo e a documentação; não devo presumir que os restos virão para Santana." +
        pendingFollowup(input.pendingQuestion);
    }
    if (/\bconcessao\b/.test(value) || input.activeGoalCode === "GOAL_CONCESSAO") {
      return "Processo de concessão, geração da taxa e administração provisória são procedimentos diferentes. O pagamento da taxa não abre nem aprova automaticamente o processo. Qual deles corresponde à sua dúvida?";
    }
    if (/\bossuario\b/.test(value) || input.activeGoalCode === "GOAL_INFO_OSSUARIO") {
      return "O ossuário é destinado à guarda dos restos mortais. É preciso distinguir renovação de um espaço já contratado, aquisição e recebimento de restos de outro local. Sobre qual dessas situações é a sua dúvida?";
    }
    return null;
  }
  return `${procedure.label}: ${procedure.summary} As etapas gerais são: ${
    procedure.steps.join(" → ")
  }. Os requisitos aplicáveis ao caso e qualquer confirmação de execução dependem da equipe.` +
    pendingFollowup(input.pendingQuestion);
}
