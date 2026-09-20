export const PROCEDURAL_CONTEXT_VERSION = "santana-procedures/1.0.0";

export type ProcedureGoalCode =
  | "GOAL_TRANSPORTE" | "GOAL_EXUMACAO" | "GOAL_RECADASTRO" | "GOAL_CONCESSAO"
  | "GOAL_COMERCIAL" | "GOAL_JAZIGO_SERVICOS" | "GOAL_RECLAMACAO"
  | "GOAL_INFO_OSSUARIO" | "GOAL_INFO_HORARIO" | "GOAL_OUTROS_ASSUNTOS";
export type ProcedureSubjectKind = "DECEASED" | "CONCESSION" | "GRAVE" | "ORDER" | "GENERIC";
export type ProcedureCode =
  | "RECADASTRO" | "EXUMACAO_QUADRA_GERAL" | "EXUMACAO_JAZIGO_FAMILIA"
  | "OSSUARIO_RENOVACAO" | "OSSUARIO_AQUISICAO" | "CONCESSAO_PROCESSO"
  | "CONCESSAO_TAXA" | "ADMINISTRACAO_PROVISORIA" | "CINZAS_EM_JAZIGO"
  | "TRANSLADO_PARA_SANTANA" | "OBITO_RECENTE_COM_JAZIGO"
  | "JAZIGO_LAPIDE_MANUTENCAO" | "SERVICO_FUNERARIO" | "REMARCACAO_EXUMACAO"
  | "VIOLACAO_FURTO_DANO" | "OUVIDORIA";

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

const VERIFY_NOTICE =
  "Esse dado vem do material operacional anterior e precisa ser confirmado na fonte oficial vigente antes de ser tratado como atual.";

export function normalizeProcedureText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const P = (value: string): string => normalizeProcedureText(value);

export const PROCEDURES: readonly ProcedureDefinition[] = [
  {
    code: "RECADASTRO", label: "Recadastro",
    aliases: ["recadastro", "recadastramento", "atualizar cadastro", "cadastro da concessao"],
    route: { goal_code: "GOAL_RECADASTRO", subject_kind: "CONCESSION" },
    summary: "Atualização cadastral do jazigo/concessão e dos dados do responsável ou concessionário, presencialmente na Administração ou pelo serviço online.",
    steps: ["apresentar dados e documentos", "conferência cadastral", "complementação documental quando necessária", "atualização do cadastro", "conclusão"],
    documents: ["documento de identificação", "comprovante de endereço", "carta de concessão ou documentação relacionada à sucessão", "certidões de óbito, quando aplicável"],
    stableRules: ["Para localizar ossuário, a referência registrada usa bloco A a I e/ou número do ossuário; isso não deve ser confundido com quadra, terreno ou lote."],
    recorded: [
      { label: "horário presencial", value: "08h00 às 16h00", requiresCurrentVerification: true },
      { label: "prazo online", value: "15 a 30 dias", requiresCurrentVerification: true },
      { label: "canal online", value: "https://www.consolare.online/recadastramento", requiresCurrentVerification: true },
    ],
  },
  {
    code: "EXUMACAO_QUADRA_GERAL", label: "Exumação em Quadra Geral",
    aliases: ["exumacao quadra geral", "quadra geral", "exumar quadra", "exumacao em quadra"],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary: "Retirada dos restos mortais em sepultamento de Quadra Geral após o período mínimo aplicável, seguida da destinação definida para os restos.",
    steps: ["solicitação", "conferência da documentação", "análise do pedido", "termo/assinatura quando aplicável", "agendamento", "exumação", "destinação dos restos mortais", "conclusão"],
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
    code: "EXUMACAO_JAZIGO_FAMILIA", label: "Exumação em Jazigo de Família",
    aliases: ["exumacao jazigo de familia", "exumacao jazigo familiar", "exumar jazigo de familia", "exumacao no jazigo"],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary: "Retirada de restos mortais de pessoa sepultada em jazigo de família, com conferência da concessão, documentação, análise e autorização quando aplicável.",
    steps: ["solicitação", "identificação do jazigo", "conferência da concessão", "conferência dos documentos", "análise", "termo/autorização quando aplicável", "agendamento", "exumação", "destinação", "conclusão"],
    documents: ["identificação do falecido", "identificação do interessado", "documentação da concessão", "carta de concessão ou administração temporária válida, quando aplicável"],
    stableRules: ["Parentesco, sucessão, legitimidade, autorização familiar e titularidade podem exigir análise específica."],
    recorded: [
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
      { label: "valor", value: "R$ 729,65", requiresCurrentVerification: true },
    ],
  },
  {
    code: "OSSUARIO_RENOVACAO", label: "Renovação de Ossuário",
    aliases: ["renovar ossuario", "renovacao ossuario", "renovacao de ossuario", "permanencia no ossuario"],
    route: { goal_code: "GOAL_INFO_OSSUARIO", subject_kind: "GENERIC" },
    summary: "Renovação da permanência dos restos mortais em ossuário pelo período contratado.",
    steps: ["identificação do ossuário", "solicitação da renovação", "conferência dos dados", "pagamento quando aplicável", "formalização da renovação", "conclusão"],
    documents: [],
    stableRules: ["A localização registrada do ossuário usa bloco A a I e número do ossuário."],
    recorded: [
      { label: "período registrado", value: "5 anos", requiresCurrentVerification: true },
      { label: "valor", value: "R$ 386,65", requiresCurrentVerification: true },
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
    ],
  },
  {
    code: "OSSUARIO_AQUISICAO", label: "Aquisição de Ossuário",
    aliases: ["comprar ossuario", "adquirir ossuario", "aquisicao ossuario", "aquisicao de ossuario", "ossuario indeterminado"],
    route: { goal_code: "GOAL_COMERCIAL", subject_kind: "ORDER" },
    summary: "Contratação de espaço para guarda de restos mortais, por período determinado ou por prazo indeterminado conforme a modalidade.",
    steps: ["solicitação", "identificação da origem dos restos", "definição da modalidade", "conferência documental", "pagamento", "documentação/memorandos", "recebimento e acomodação", "conclusão"],
    documents: ["quando os restos vêm de outro local, a documentação e os memorandos dependem da origem e da situação"],
    stableRules: [],
    recorded: [
      { label: "modalidade de 5 anos", value: "R$ 386,65", requiresCurrentVerification: true },
      { label: "modalidade por prazo indeterminado", value: "R$ 2.955,70", requiresCurrentVerification: true },
      { label: "referência de antecedência para origem externa", value: "14 dias em algumas situações", requiresCurrentVerification: true },
    ],
  },
  {
    code: "CONCESSAO_PROCESSO", label: "Processo de Concessão",
    aliases: ["processo de concessao", "sucessao do jazigo", "novo concessionario", "transferencia da concessao", "renuncia da concessao", "devolucao do jazigo", "titularidade da concessao"],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary: "Processo administrativo ligado à concessão/titularidade do jazigo, incluindo sucessão, novo concessionário, transferência, renúncia e devolução.",
    steps: ["identificar a situação do jazigo", "verificar o concessionário", "recadastro", "reunir documentos", "abrir o processo", "análise administrativa", "complementação se necessária", "decisão/conclusão"],
    documents: ["a documentação depende da situação de sucessão, transferência, renúncia, devolução ou definição do novo concessionário"],
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
    code: "CONCESSAO_TAXA", label: "Taxa de Concessão",
    aliases: ["taxa de concessao", "pagar taxa de concessao", "pagamento concessao", "pix concessao", "cartao concessao"],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary: "Etapa de pagamento relacionada à concessão, separada da abertura, análise e aprovação do processo administrativo.",
    steps: ["identificar a localização do jazigo", "identificar o concessionário", "definir forma de pagamento", "realizar o pagamento conforme orientação vigente"],
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
    code: "ADMINISTRACAO_PROVISORIA", label: "Administração Provisória",
    aliases: ["administracao provisoria", "administracao temporaria", "administrador provisorio", "administrador temporario"],
    route: { goal_code: "GOAL_CONCESSAO", subject_kind: "CONCESSION" },
    summary: "Administração temporária do jazigo enquanto a situação definitiva da concessão é resolvida.",
    steps: ["solicitação", "identificação da situação do jazigo", "documentação", "análise", "administração provisória", "conclusão"],
    documents: ["documentação conforme a situação do jazigo e da representação temporária"],
    stableRules: ["Não equivale a transferência definitiva, concessão, venda, renúncia ou devolução do jazigo."],
    recorded: [{ label: "prazo", value: "até 5 dias úteis", requiresCurrentVerification: true }],
  },
  {
    code: "CINZAS_EM_JAZIGO", label: "Cinzas em Jazigo",
    aliases: ["cinzas no jazigo", "cinzas em jazigo", "colocar cinzas", "guardar cinzas", "urna de cinzas"],
    route: { goal_code: "GOAL_COMERCIAL", subject_kind: "ORDER" },
    summary: "Procedimento para colocação ou guarda de cinzas em jazigo, sujeito a identificação do jazigo, documentação, análise e agendamento.",
    steps: ["solicitação", "identificação do jazigo", "conferência da documentação", "análise", "agendamento", "realização", "conclusão"],
    documents: ["a documentação varia conforme a situação; o material não define uma lista universal para todos os casos"],
    stableRules: ["O agendamento só deve ser considerado confirmado quando houver confirmação efetiva."],
    recorded: [{ label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true }],
  },
  {
    code: "TRANSLADO_PARA_SANTANA", label: "Translado para o Cemitério Santana",
    aliases: ["translado para santana", "traslado para santana", "trazer restos para santana", "trazer para o cemiterio santana", "transferir restos para santana"],
    route: { goal_code: "GOAL_TRANSPORTE", subject_kind: "DECEASED" },
    summary: "Transferência de restos mortais provenientes de outro local para o Cemitério Santana.",
    steps: ["solicitação", "identificação da origem", "identificação do destino", "documentação", "memorandos/autorizações", "análise", "agendamento", "translado", "recebimento em Santana", "destinação final"],
    documents: ["documentação e memorandos ligados ao translado; a lista exata depende da origem, destino e situação do falecido"],
    stableRules: ["O agendamento só deve ser tratado como confirmado quando houver confirmação efetiva."],
    recorded: [
      { label: "prazo de análise", value: "até 5 dias úteis", requiresCurrentVerification: true },
      { label: "referência de antecedência", value: "14 dias em algumas situações de translado", requiresCurrentVerification: true },
    ],
  },
  {
    code: "OBITO_RECENTE_COM_JAZIGO", label: "Óbito Recente com Jazigo",
    aliases: ["obito recente", "faleceu agora", "faleceu hoje", "acabou de falecer", "falecimento recente", "sepultar no jazigo da familia", "sepultamento no jazigo da familia"],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary: "Encaminhamento de sepultamento de pessoa falecida recentemente quando existe jazigo/concessão familiar.",
    steps: ["comunicação do óbito", "identificação do falecido", "identificação do jazigo", "conferência da documentação", "verificação da situação da concessão", "agendamento/encaminhamento", "sepultamento", "registro"],
    documents: ["documentos do falecido", "certidão/documentação do óbito", "informações do jazigo", "documentação do concessionário ou responsável conforme a situação"],
    stableRules: [
      "É uma situação de prioridade máxima no material operacional.",
      "Prioridade não significa confirmação automática de horário ou realização do sepultamento.",
    ],
    recorded: [],
  },
  {
    code: "JAZIGO_LAPIDE_MANUTENCAO", label: "Serviços em Jazigo, Lápide e Manutenção",
    aliases: ["lapide", "portao do jazigo", "limpeza do jazigo", "pintura do jazigo", "manutencao do jazigo", "reforma do jazigo", "consertar jazigo", "servico no jazigo"],
    route: { goal_code: "GOAL_JAZIGO_SERVICOS", subject_kind: "GRAVE" },
    summary: "Atendimentos físicos no jazigo, como lápide, portão, limpeza, pintura, manutenção e reforma.",
    steps: ["solicitação", "identificação do jazigo", "identificação do serviço", "verificação se há contratação/orçamento", "encaminhamento ao setor responsável", "orçamento/execução", "conclusão"],
    documents: [],
    stableRules: [
      "É comercial quando há intenção clara de contratar, comprar, pedir orçamento, executar, substituir, instalar ou reparar.",
      "Se a lápide já foi comprada/contratada, perguntas sobre chegada, instalação, andamento ou status são acompanhamento de serviço, não novo orçamento.",
      "No acompanhamento de lápide, devem ser identificados a data da compra e o local da compra quando aplicável.",
    ],
    recorded: [
      { label: "prazo de retorno comercial", value: "até 24 horas", requiresCurrentVerification: true },
      { label: "referência histórica para chegada/instalação de lápide já contratada", value: "aproximadamente 20 a 30 dias úteis", requiresCurrentVerification: true },
    ],
  },
  {
    code: "SERVICO_FUNERARIO", label: "Serviço Funerário, Velório e Sepultamento",
    aliases: ["servico funerario", "funeral", "velorio", "sepultamento", "agencia funeraria", "central funeraria"],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary: "Assuntos de funeral, velório e sepultamento podem depender da estrutura funerária e dos canais específicos registrados.",
    steps: ["identificar a necessidade", "direcionar ao canal funerário/administrativo adequado", "confirmar condições vigentes antes de prometer atendimento ou valor"],
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
    code: "REMARCACAO_EXUMACAO", label: "Remarcação de Exumação",
    aliases: ["remarcar exumacao", "remarcar a exumacao", "remarcacao de exumacao", "reagendar exumacao", "reagendar a exumacao", "nova data exumacao", "exumacao foi cancelada", "exumacao nao pode ser realizada"],
    route: { goal_code: "GOAL_EXUMACAO", subject_kind: "DECEASED" },
    summary: "Reagendamento quando uma exumação previamente prevista não pode ser realizada.",
    steps: ["identificar a exumação prevista", "registrar a impossibilidade", "comunicar o responsável", "verificar disponibilidade", "confirmar novo agendamento", "realizar a exumação"],
    documents: [],
    stableRules: [
      "Motivos operacionais podem incluir condições climáticas.",
      "A nova data só deve ser informada como agendada depois de confirmação efetiva.",
    ],
    recorded: [],
  },
  {
    code: "VIOLACAO_FURTO_DANO", label: "Violação, Furto ou Dano",
    aliases: ["jazigo violado", "violacao", "furto", "roubo", "arrombamento", "arrombado", "arrombaram", "sumiu do jazigo", "objeto desapareceu", "dano no jazigo", "vandalismo"],
    route: { goal_code: "GOAL_JAZIGO_SERVICOS", subject_kind: "GRAVE" },
    summary: "Ocorrência envolvendo possível violação, furto, dano, arrombamento ou desaparecimento de objeto no jazigo.",
    steps: ["registrar o relato como ocorrência", "identificar o jazigo/local", "preservar fotos e informações disponíveis", "encaminhar para análise humana/administrativa"],
    documents: [],
    stableRules: [
      "Não deve ser tratada como simples pedido comercial de manutenção.",
      "O relato do munícipe não confirma por si só a ocorrência; a situação precisa de análise humana/administrativa.",
    ],
    recorded: [],
  },
  {
    code: "OUVIDORIA", label: "Ouvidoria",
    aliases: ["ouvidoria", "reclamacao na ouvidoria", "falar com ouvidoria"],
    route: { goal_code: "GOAL_OUTROS_ASSUNTOS", subject_kind: "GENERIC" },
    summary: "Canal para manifestações dirigidas à Ouvidoria.",
    steps: ["identificar a manifestação", "orientar o canal de Ouvidoria", "preservar o atendimento corrente se houver outro assunto em andamento"],
    documents: [],
    stableRules: [],
    recorded: [{ label: "e-mail", value: "contato@consolare.com.br", requiresCurrentVerification: true }],
  },
];

function aliasScore(text: string, alias: string): number {
  const normalizedAlias = P(alias);
  if (!normalizedAlias || !text.includes(normalizedAlias)) return 0;
  return normalizedAlias.split(" ").length * 10 + normalizedAlias.length;
}

export function findProcedure(text: string): ProcedureDefinition | null {
  const normalized = P(text);
  let best: ProcedureDefinition | null = null;
  let bestScore = 0;
  for (const procedure of PROCEDURES) {
    for (const alias of procedure.aliases) {
      const score = aliasScore(normalized, alias);
      if (score > bestScore) {
        bestScore = score;
        best = procedure;
      }
    }
  }
  return best;
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
    aliases: [...procedure.aliases],
    goal_code: procedure.route.goal_code,
  }));
}

function askKind(text: string): "documents" | "steps" | "deadline" | "price" | "contact" | "address" | "general" | null {
  const value = P(text);
  if (/\b(quais|que) documentos?\b|\bdocumentacao necessaria\b|\bdocumentos necessarios\b/.test(value)) return "documents";
  if (/\bcomo funciona\b|\bcomo fazer\b|\bcomo faco\b|\bquais as etapas\b|\bqual o procedimento\b|\bfluxo\b/.test(value)) return "steps";
  if (/\bqual (?:e )?o prazo\b|\bquanto tempo\b|\bdemora\b|\bem quantos dias\b/.test(value)) return "deadline";
  if (/\bquanto custa\b|\bqual (?:e )?o valor\b|\bpreco\b|\bvalor da\b|\bvalor do\b/.test(value)) return "price";
  if (/\btelefone\b|\bwhatsapp\b|\be ?mail\b|\bcontato\b|\bcanal\b/.test(value)) return "contact";
  if (/\bendereco\b|\bonde fica\b|\bcomo chegar\b/.test(value)) return "address";
  if (/\bo que (?:e|eh)\b|\bme explique\b|\bexplica\b/.test(value)) return "general";
  return null;
}

function relatedProcedureFromGoal(goalCode: string | null | undefined): ProcedureDefinition | null {
  const code = goalCode === "GOAL_RECADASTRO" ? "RECADASTRO"
    : goalCode === "GOAL_CONCESSAO" ? "CONCESSAO_PROCESSO"
    : goalCode === "GOAL_TRANSPORTE" ? "TRANSLADO_PARA_SANTANA"
    : goalCode === "GOAL_JAZIGO_SERVICOS" ? "JAZIGO_LAPIDE_MANUTENCAO"
    : goalCode === "GOAL_INFO_OSSUARIO" ? "OSSUARIO_RENOVACAO"
    : null;
  return code ? PROCEDURES.find((procedure) => procedure.code === code) ?? null : null;
}

function verifiedRecorded(procedure: ProcedureDefinition, predicate: (item: RecordedInfo) => boolean): string | null {
  const items = procedure.recorded.filter(predicate);
  if (!items.length) return null;
  return `${items.map((item) => `${item.label}: ${item.value}`).join("; ")}. ${VERIFY_NOTICE}`;
}

function pendingFollowup(pendingQuestion: string | null | undefined): string {
  const question = pendingQuestion?.trim();
  return question ? `\n\nPara continuarmos o seu atendimento atual: ${question}` : "";
}

function exhumationDocumentsWithoutLocation(): string {
  return "Os documentos mudam conforme o tipo de sepultamento. Em Quadra Geral, o material registra certidão de óbito, documento de identificação, comprovante de endereço e telefone; em Jazigo de Família, entram também documentos ligados à concessão e, quando aplicável, carta de concessão ou administração temporária válida. Antes de fechar a lista, preciso saber: o sepultamento é em Quadra Geral ou Jazigo de Família?";
}

function addressReply(): string {
  return `O material operacional registra o Cemitério Santana na Rua Nova dos Portugueses, 141, Chora Menino, São Paulo/SP, CEP 02462-080. ${VERIFY_NOTICE}`;
}

export function proceduralDirectReply(input: {
  text: string;
  activeGoalCode?: string | null;
  pendingQuestion?: string | null;
}): string | null {
  const normalized = P(input.text);
  const kind = askKind(input.text);

  if (/\b(paguei|pagamento|pagar)\b.*\b(taxa|concessao)\b/.test(normalized) &&
    /\b(aprovad|aberto|abriu|processo)\b/.test(normalized)) {
    return "O pagamento da taxa de concessão não significa, por si só, que o processo de concessão foi aberto ou aprovado. São etapas diferentes; a situação do processo precisa ser verificada separadamente." +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(ja comprei|ja contratei|comprei)\b.*\b(lapide|placa)\b|\b(lapide|placa)\b.*\b(instalacao|instalaram|chegou|andamento|status)\b/.test(normalized)) {
    return `Se a lápide já foi comprada ou contratada, isso é acompanhamento de serviço, não um novo orçamento. Para localizar o pedido, registre a data da compra e o local onde ela foi realizada, quando aplicável. ${VERIFY_NOTICE}` +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(violacao|violado|furto|roubo|arromb|vandal|sumiu|desapareceu|dano)\b/.test(normalized) &&
    /\b(jazigo|tumulo|sepultura|lapide|objeto)\b/.test(normalized)) {
    return "Isso deve ser tratado como uma ocorrência específica, com registro do relato e encaminhamento para análise humana/administrativa; não como um simples pedido comercial de manutenção. Se puder, informe a referência do jazigo e preserve fotos ou outras informações disponíveis." +
      pendingFollowup(input.pendingQuestion);
  }
  if (/\b(faleceu agora|faleceu hoje|acabou de falecer|obito recente)\b/.test(normalized) &&
    /\b(jazigo|concessao|familia)\b/.test(normalized)) {
    return "Óbito recente com jazigo é tratado como situação de máxima prioridade no material operacional. O fluxo é identificar o falecido e o jazigo, conferir a documentação e a situação da concessão e então encaminhar o agendamento/sepultamento. Prioridade não significa horário automaticamente confirmado. Informe o nome do falecido e a referência do jazigo que você possui.";
  }
  if (/\b(remarcar|reagendar|remarcacao)\b.*\bexumacao\b|\bexumacao\b.*\b(remarcar|reagendar|nova data)\b/.test(normalized)) {
    return "Na remarcação, primeiro é registrada a impossibilidade da exumação prevista, depois se verifica a disponibilidade e somente então se confirma uma nova data. A nova data não deve ser informada como agendada antes da confirmação efetiva." +
      pendingFollowup(input.pendingQuestion);
  }

  if (kind === "address") return addressReply() + pendingFollowup(input.pendingQuestion);
  if (!kind) return null;

  const explicitProcedure = findProcedure(input.text);
  if (kind === "documents" && input.activeGoalCode === "GOAL_EXUMACAO" && !explicitProcedure) {
    return exhumationDocumentsWithoutLocation() + pendingFollowup(input.pendingQuestion);
  }
  const procedure = explicitProcedure ?? relatedProcedureFromGoal(input.activeGoalCode);
  if (!procedure) return null;

  if (kind === "documents") {
    if (!procedure.documents.length) {
      return `Para ${procedure.label}, o material não traz uma lista única de documentos para todos os casos. ${procedure.summary} A documentação deve ser definida conforme a situação concreta.` +
        pendingFollowup(input.pendingQuestion);
    }
    return `Para ${procedure.label}, o material registra: ${procedure.documents.join("; ")}. A lista pode variar conforme a situação específica e a análise administrativa.` +
      pendingFollowup(input.pendingQuestion);
  }
  if (kind === "steps") {
    return `${procedure.label}: ${procedure.summary} O fluxo é: ${procedure.steps.join(" → ")}.` +
      pendingFollowup(input.pendingQuestion);
  }
  if (kind === "deadline") {
    return (verifiedRecorded(procedure, (item) => /prazo|periodo|antecedencia|retorno|horario/i.test(item.label)) ??
      `O material não registra um prazo único para ${procedure.label}; o tempo depende das etapas e da análise aplicável. ${VERIFY_NOTICE}`) +
      pendingFollowup(input.pendingQuestion);
  }
  if (kind === "price") {
    return (verifiedRecorded(procedure, (item) => /valor|modalidade|pacote/i.test(item.label)) ??
      `O material não registra um valor único para ${procedure.label}. ${VERIFY_NOTICE}`) +
      pendingFollowup(input.pendingQuestion);
  }
  if (kind === "contact") {
    return (verifiedRecorded(procedure, (item) => /whatsapp|e-mail|central|canal|agencia/i.test(item.label)) ??
      `O material não registra um canal exclusivo para ${procedure.label}. ${VERIFY_NOTICE}`) +
      pendingFollowup(input.pendingQuestion);
  }
  return `${procedure.label}: ${procedure.summary}${procedure.stableRules.length ? ` ${procedure.stableRules.join(" ")}` : ""}` +
    pendingFollowup(input.pendingQuestion);
}
