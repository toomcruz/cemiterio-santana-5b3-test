import { normalizeText, riskRank, unique } from "./normalization.ts";
import type {
  Complexity,
  MotorV2Message,
  RiskLevel,
  UnderstandingProviderMetadata,
  UnderstandingResult,
} from "./types.ts";

export interface UnderstandingProvider {
  readonly metadata: UnderstandingProviderMetadata;
  understand(messages: readonly MotorV2Message[]): Promise<unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Strict trust boundary for any future AI adapter. Extra or malformed output is rejected. */
export function guardUnderstanding(value: unknown): UnderstandingResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("understanding must be an object");
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "schema_version",
    "journeys",
    "subintents",
    "transverse_states",
    "intent_changed",
    "complexity",
    "risk",
    "confidence",
    "evidence_turns",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error("understanding contains unknown fields");
  if (record.schema_version !== "motor-v2-understanding/1.0.0") throw new Error("invalid understanding version");
  if (
    !isStringArray(record.journeys) || !isStringArray(record.subintents) || !isStringArray(record.transverse_states)
  ) {
    throw new Error("understanding labels must be string arrays");
  }
  if (
    typeof record.intent_changed !== "boolean" ||
    !["low", "medium", "high", "critical"].includes(String(record.complexity))
  ) {
    throw new Error("invalid understanding state");
  }
  const risk = record.risk as Record<string, unknown> | null;
  if (!risk || !["none", "P3", "P2", "P1", "P0"].includes(String(risk.level)) || !isStringArray(risk.signals)) {
    throw new Error("invalid risk result");
  }
  if (!["high", "medium", "low"].includes(String(record.confidence)) || !isStringArray(record.evidence_turns)) {
    throw new Error("invalid understanding confidence");
  }
  const cleanLabels = [
    record.journeys,
    record.subintents,
    record.transverse_states,
    risk.signals,
    record.evidence_turns,
  ];
  if (cleanLabels.some((items) => (items as string[]).some((item) => item.length === 0 || item.length > 120))) {
    throw new Error("understanding label outside safe bounds");
  }
  return structuredClone(value) as UnderstandingResult;
}

export class GuardedUnderstandingProvider implements UnderstandingProvider {
  readonly metadata: UnderstandingProviderMetadata;

  constructor(private readonly delegate: UnderstandingProvider) {
    this.metadata = { ...delegate.metadata, schema_guarded: true };
  }

  async understand(messages: readonly MotorV2Message[]): Promise<UnderstandingResult> {
    const result = guardUnderstanding(await this.delegate.understand(messages));
    validateProviderLabelsAndEvidence(result, messages);
    return result;
  }
}

export class LabSemanticUnderstandingProvider implements UnderstandingProvider {
  readonly metadata: UnderstandingProviderMetadata = {
    id: "lab-semantic-v1",
    kind: "deterministic_lab",
    uses_ai: false,
    model: "none",
    schema_guarded: false,
  };

  understand(messages: readonly MotorV2Message[]): Promise<UnderstandingResult> {
    return Promise.resolve(understandMessages(messages));
  }
}

interface IntentRule {
  code: string;
  patterns: RegExp[];
}

const INTENTS: IntentRule[] = [
  {
    code: "CORRECAO_DE_AGENDAMENTO",
    patterns: [/corrig.*agendamento/, /compromisso.*invalid/, /agendamento.*invalid/],
  },
  {
    code: "DIVERGENCIA_FISICO_CADASTRAL",
    patterns: [/nao correspond.*cadastro/, /divergencia.*cadastro/, /fisic.*cadastro/],
  },
  { code: "RESTOS_NAO_ESPERADOS", patterns: [/encontrad.*restos/, /restos.*nao correspond/] },
  {
    code: "CONFLITO_CADASTRAL_DOCUMENTO_LEGADO",
    patterns: [/documento legado.*cadastro atual/, /fontes?.*incompativ/],
  },
  { code: "CONTRADICAO_ENTRE_CANAIS", patterns: [/orientacoes? incompativeis?.*canais?/, /contradicao.*canais?/] },
  { code: "RECUPERACAO_APOS_FALHA_DE_PAGAMENTO", patterns: [/pagamento.*falh/, /falh.*pagamento/] },
  { code: "RENOVACAO_OSSUARIO", patterns: [/renovacao.*ossuario/, /ossuario.*renovacao/] },
  {
    code: "CORRECAO_DE_DADO_EM_LAPIDE_PLACA",
    patterns: [/rascunho.*(?:lapide|placa|titulo|linha|nota)/, /altere somente.*campo/],
  },
  { code: "ASSINATURA_DIGITAL_DOCUMENTO", patterns: [/assinatura digital/, /concluir a assinatura/] },
  { code: "SUPORTE_DOCUMENTAL", patterns: [/assinatura.*erro/, /evidencias?.*document/, /suporte.*document/] },
  {
    code: "CONTINGENCIA_FUNERARIA_POR_RAMIFICACAO",
    patterns: [/contingencia.*verificad/, /alternativa.*bloquead.*contingencia/],
  },
  {
    code: "ALTERNATIVA_TEMPORARIA_DE_SEPULTAMENTO",
    patterns: [/alternativa.*sepultamento/, /contingencia.*sepultamento/, /seguir com a contingencia/],
  },
  { code: "NAO_ASSUNCAO_RESPONSABILIDADE", patterns: [/nao assumir.*responsabilidade/] },
  { code: "DESISTENCIA_DIREITO_USO", patterns: [/formalizar desist/, /desistencia.*direito/] },
  { code: "DESVIO_COMERCIAL", patterns: [/oferta nao relacionada/, /apresentar uma oferta/, /oferta comercial/] },
  {
    code: "RECLAMACAO_SEM_RETORNO",
    patterns: [
      /reclamacao.*sem (?:retorno|resposta)/,
      /sem retorno/,
      /aguard.*retorno/,
      /ninguem responde/,
      /nao respondeu/,
      /falta de retorno/,
      /contato anterior.*sem solucao/,
    ],
  },
  {
    code: "RECLAMACAO_OPERACIONAL",
    patterns: [/reclamacao/, /reclamar/, /sem encaminhamento aceito/, /absurdo/, /insatisfeit/, /problema/, /demora/],
  },
  { code: "REGULARIZACAO_ESTRUTURAL", patterns: [/revisao estrutural/, /regularizacao estrutural/] },
  { code: "ADMINISTRACAO_PROVISORIA", patterns: [/administracao provisoria/] },
  {
    code: "SUCESSAO",
    patterns: [/sucessao/, /todos os herdeiros/, /herdeiros?.{0,45}autoriza/, /autoriza.{0,45}herdeiros?/],
  },
  { code: "TITULARIDADE", patterns: [/titularidade/, /titular/, /cessionario/] },
  { code: "RECADASTRO", patterns: [/recadastro/, /recadastramento/, /atualiz.*cadastro/] },
  { code: "CONCESSAO", patterns: [/concessao/, /perpetuidade/, /carta de concessao/] },
  { code: "TRANSFERENCIA", patterns: [/transferi(?:r| la)|transferencia/] },
  { code: "CREMACAO_IMEDIATA", patterns: [/cremacao/, /cremar/] },
  { code: "CREMACAO", patterns: [/cremacao/, /cremar/] },
  { code: "EXUMACAO", patterns: [/exumacao/, /exumar/] },
  {
    code: "RETIRAR_RESTOS",
    patterns: [/retir\w*(?: (?:os|de|dos))? restos/, /remocao.*restos/, /tirar (?:os )?ossos/],
  },
  {
    code: "DESTINO_OSSUARIO",
    patterns: [
      /ossuario/,
      /ossario/,
      /guardar (?:os )?ossos/,
      /caixa de ossos/,
      /destino d(?:os|e) restos/,
      /destino em gaveta/,
    ],
  },
  { code: "REINUMACAO", patterns: [/reinumacao/, /reinumar/, /sepultar novamente/] },
  { code: "CORPO_SEMI_INTACTO", patterns: [/semi intacto/, /corpo intacto/, /nao decomposto/] },
  { code: "TRASLADO", patterns: [/traslado/, /transladar/, /outro cemiterio/] },
  {
    code: "DESTINO_RESTOS",
    patterns: [
      /destino.{0,55}(?:restos|ossos)/,
      /(?:restos|ossos).{0,55}destino/,
      /(?:localizar|localizacao|onde estao|encontrar).{0,100}(?:restos|ossos)/,
      /(?:restos|ossos).{0,100}(?:localizar|localizacao|onde estao|encontrar)/,
    ],
  },
  { code: "VELORIO", patterns: [/velorio/, /velar/] },
  { code: "SEPULTAMENTO", patterns: [/sepultamento/, /sepultar/, /enterro/, /enterrar/, /demanda funeraria/] },
  { code: "CAPELA_SALA", patterns: [/capela/, /sala de velorio/] },
  { code: "LIMPEZA_ZELADORIA", patterns: [/limpeza/, /zeladoria/] },
  { code: "MANUTENCAO_JAZIGO", patterns: [/manutencao/, /conservacao/, /conserto/] },
  { code: "OBRA_REFORMA", patterns: [/obra/, /reforma/, /construcao/] },
  { code: "LAPIDE_PLACA", patterns: [/lapide/, /placa/, /letreiro/] },
  { code: "VISITA_JAZIGO", patterns: [/visita/, /visitar/, /horario de visita/] },
  { code: "JAZIGO_GERAL", patterns: [/jazigo/, /tumulo/, /sepultura/] },
  {
    code: "IDENTIFICAR_REFERENCIA",
    patterns: [
      /referencia (?:segura )?(?:ja )?(?:foi )?informad/,
      /localizar a referencia/,
      /(?:localizar|localizacao|onde fica|achar).{0,50}(?:jazigo|tumulo|sepultura|quadra|terreno)/,
      /\b(?:quadra|terreno|gaveta|rua)\b/,
    ],
  },
  { code: "RELACAO_FAMILIAR_DECLARADA", patterns: [/relacao familiar/, /minha relacao/, /jazigo da familia/] },
  {
    code: "PEDIDO_HUMANO",
    patterns: [/falar com (?:um |uma )?atendente/, /atendimento humano/, /alguem pode responder/],
  },
  {
    code: "EMISSAO_SEGUNDA_VIA_DOCUMENTO",
    patterns: [
      /(?:segunda via|copia).{0,40}(?:declaracao|certidao|documento)/,
      /(?:emitir|emissao|solicitar).{0,40}(?:declaracao|certidao)/,
    ],
  },
  { code: "PLANO_ZELADORIA", patterns: [/plano de zeladoria/, /pacote de zeladoria/] },
];

const JOURNEYS: Array<{ code: string; intents: string[] }> = [
  {
    code: "FUNERARIO_IMEDIATO",
    intents: [
      "VELORIO",
      "SEPULTAMENTO",
      "CAPELA_SALA",
      "CREMACAO_IMEDIATA",
      "CONTINGENCIA_FUNERARIA_POR_RAMIFICACAO",
      "ALTERNATIVA_TEMPORARIA_DE_SEPULTAMENTO",
    ],
  },
  {
    code: "RESTOS_MORTAIS",
    intents: [
      "RETIRAR_RESTOS",
      "DESTINO_OSSUARIO",
      "DESTINO_RESTOS",
      "EXUMACAO",
      "CREMACAO",
      "DIVERGENCIA_FISICO_CADASTRAL",
      "RESTOS_NAO_ESPERADOS",
      "RENOVACAO_OSSUARIO",
      "REINUMACAO",
      "CORPO_SEMI_INTACTO",
      "TRASLADO",
    ],
  },
  {
    code: "JAZIGO_ESPACO_FISICO",
    intents: [
      "LAPIDE_PLACA",
      "LIMPEZA_ZELADORIA",
      "MANUTENCAO_JAZIGO",
      "OBRA_REFORMA",
      "VISITA_JAZIGO",
      "JAZIGO_GERAL",
      "IDENTIFICAR_REFERENCIA",
      "PLANO_ZELADORIA",
    ],
  },
  {
    code: "DIREITOS_CADASTRO",
    intents: [
      "RECADASTRO",
      "CONCESSAO",
      "SUCESSAO",
      "ADMINISTRACAO_PROVISORIA",
      "TRANSFERENCIA",
      "NAO_ASSUNCAO_RESPONSABILIDADE",
      "DESISTENCIA_DIREITO_USO",
      "CONFLITO_CADASTRAL_DOCUMENTO_LEGADO",
      "REGULARIZACAO_ESTRUTURAL",
      "TITULARIDADE",
      "EMISSAO_SEGUNDA_VIA_DOCUMENTO",
    ],
  },
  {
    code: "SUPORTE_RECLAMACAO",
    intents: ["RECLAMACAO_SEM_RETORNO", "RECLAMACAO_OPERACIONAL", "SUPORTE_DOCUMENTAL", "PEDIDO_HUMANO"],
  },
  { code: "AGENDAMENTO", intents: ["CORRECAO_DE_AGENDAMENTO"] },
  { code: "PAGAMENTO", intents: ["RECUPERACAO_APOS_FALHA_DE_PAGAMENTO"] },
  { code: "DESCONHECIDA_AMBIGUA", intents: [] },
];

function journeysForIntents(intents: readonly string[]): string[] {
  return JOURNEYS.filter((journey) => journey.intents.some((intent) => intents.includes(intent))).map((journey) =>
    journey.code
  );
}

const KNOWN_TRANSVERSE_STATES = new Set([
  "MULTI_INTENT",
  "INTENT_CHANGED",
  "URGENT_FUNERAL_NEED",
  "DEFERRED_NON_URGENT_TRACKS",
  "LONGITUDINAL_CONTINUITY",
  "WAITING_ADMIN",
  "NOT_ABANDONED",
  "OPEN_COMPLAINT",
  "NO_RETRIAGE",
  "PARTIAL_MULTI_TRACK_CLOSURE",
  "CONFLICTING_EVIDENCE",
  "BRANCH_AWARE_CONTINGENCY",
  "ACCEPTED_PLAN_NOT_COMPLETED",
  "PAYMENT_FAILURE_RECOVERY",
  "RECEIPT_AWARE_CLOSURE",
  "CONVERSATION_CLOSING",
  "MEDIA_NOT_ANALYZED",
]);

const KNOWN_RISK_SIGNALS = new Set([
  "unverified_rights_claim_across_channels",
  "non_natural_death",
  "semi_intact_body",
  "family_conflict",
  "administrative_decision_required",
  "document_analysis_required",
  "missing_or_conflicting_current_rule",
  "urgent_funeral_need",
  "sensitive_death_context",
  "physical_register_divergence",
  "conflicting_evidence",
  "payment_failure",
  "open_complaint",
  "document_support",
  "low_confidence_sensitive_context",
]);

export function validateProviderLabelsAndEvidence(
  result: UnderstandingResult,
  messages: readonly MotorV2Message[],
): void {
  const knownIntents = new Set(INTENTS.map((rule) => rule.code));
  const knownJourneys = new Set(JOURNEYS.map((journey) => journey.code));
  const evidenceTurns = new Set(messages.map((message) => message.turn_id));
  if (result.subintents.some((label) => !knownIntents.has(label))) throw new Error("unknown subintent label");
  if (result.journeys.some((label) => !knownJourneys.has(label))) throw new Error("unknown journey label");
  if (result.transverse_states.some((label) => !KNOWN_TRANSVERSE_STATES.has(label))) {
    throw new Error("unknown transverse-state label");
  }
  if (result.risk.signals.some((label) => !KNOWN_RISK_SIGNALS.has(label))) throw new Error("unknown risk signal");
  if (result.evidence_turns.some((turnId) => !evidenceTurns.has(turnId))) {
    throw new Error("understanding evidence references an unknown turn");
  }
}

/** Closed vocabulary shared by controlled structured-output providers. */
export function understandingVocabulary(): {
  journeys: string[];
  subintents: string[];
  transverse_states: string[];
  risk_signals: string[];
} {
  return {
    journeys: JOURNEYS.map((journey) => journey.code),
    subintents: INTENTS.map((intent) => intent.code),
    transverse_states: [...KNOWN_TRANSVERSE_STATES],
    risk_signals: [...KNOWN_RISK_SIGNALS],
  };
}

function intentsFor(text: string): string[] {
  let intents = INTENTS.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map((rule) => rule.code);
  if (intents.includes("CREMACAO") && intents.includes("CREMACAO_IMEDIATA")) {
    const remainsContext = /restos|ossos|ossuario|ossario|exumacao|exumar|reinumacao|reinumar/.test(text);
    intents = intents.filter((intent) => intent !== (remainsContext ? "CREMACAO_IMEDIATA" : "CREMACAO"));
  }
  if (
    intents.includes("TRANSFERENCIA") &&
    /(?:restos|ossos|corpo).{0,55}(?:transferencia|transferir)|(?:transferencia|transferir).{0,55}(?:restos|ossos|corpo)/
      .test(text) &&
    !/responsabilidade|concessao|titularidade|administracao provisoria|direito de uso/.test(text)
  ) {
    intents = intents.filter((intent) => intent !== "TRANSFERENCIA");
  }
  return intents;
}

function riskFor(text: string, intents: string[]): { level: RiskLevel; signals: string[] } {
  const candidates: Array<{ level: RiskLevel; signal: string; matches: boolean }> = [
    {
      level: "P0",
      signal: "unverified_rights_claim_across_channels",
      matches: /(?:perder|perda).*direito|perder.*prazo/.test(text) && intents.includes("CONTRADICAO_ENTRE_CANAIS"),
    },
    { level: "P0", signal: "non_natural_death", matches: /morte.*nao natural|obito.*nao natural/.test(text) },
    { level: "P0", signal: "semi_intact_body", matches: /corpo.*semi intact/.test(text) },
    { level: "P0", signal: "family_conflict", matches: /conflito familiar|familiares? em conflito/.test(text) },
    { level: "P0", signal: "administrative_decision_required", matches: /decisao administrativa/.test(text) },
    {
      level: "P0",
      signal: "document_analysis_required",
      matches: /analise documental|analisar documento|validacao documental/.test(text),
    },
    {
      level: "P0",
      signal: "missing_or_conflicting_current_rule",
      matches: /regra (?:atual )?(?:(?:esta|e) )?(?:ausente|conflitante)|fontes? atuais? conflitantes?/.test(text),
    },
    {
      level: "P1",
      signal: "urgent_funeral_need",
      matches: /urgente|demanda funeraria|sepultamento.*(?:hoje|agora)/.test(text),
    },
    {
      level: "P1",
      signal: "sensitive_death_context",
      matches: /situacao sensivel.*falecimento|circunstancias do falecimento/.test(text),
    },
    { level: "P1", signal: "physical_register_divergence", matches: intents.includes("DIVERGENCIA_FISICO_CADASTRAL") },
    { level: "P1", signal: "conflicting_evidence", matches: intents.includes("CONFLITO_CADASTRAL_DOCUMENTO_LEGADO") },
    { level: "P1", signal: "payment_failure", matches: intents.includes("RECUPERACAO_APOS_FALHA_DE_PAGAMENTO") },
    { level: "P2", signal: "open_complaint", matches: intents.some((intent) => intent.startsWith("RECLAMACAO_")) },
    { level: "P2", signal: "document_support", matches: intents.includes("SUPORTE_DOCUMENTAL") },
  ];
  const matched = candidates.filter((candidate) => candidate.matches);
  const level = matched.reduce<RiskLevel>(
    (highest, candidate) => riskRank(candidate.level) > riskRank(highest) ? candidate.level : highest,
    "none",
  );
  return { level, signals: unique(matched.map((candidate) => candidate.signal)) };
}

/** A controlled provider may add semantics, but cannot lower formal deterministic safety signals. */
export function enforceDeterministicRisk(
  messages: readonly MotorV2Message[],
  understanding: UnderstandingResult,
): UnderstandingResult {
  // Safety evidence must come from the citizen's turns. Replaying prior
  // assistant guidance as if the citizen asserted it creates false P0 signals.
  const text = normalizeText(
    messages.filter((message) => message.role === "user").map((message) => message.content).join("\n"),
  );
  const deterministicIntents = intentsFor(text);
  let deterministic = riskFor(text, unique([...understanding.subintents, ...deterministicIntents]));
  if (deterministicIntents.length === 0 && /sensivel|falecimento|sepultamento/.test(text)) {
    deterministic = {
      level: "P0",
      signals: unique([...deterministic.signals, "low_confidence_sensitive_context"]),
    };
  }
  const level = riskRank(deterministic.level) > riskRank(understanding.risk.level)
    ? deterministic.level
    : understanding.risk.level;
  const signals = unique([...understanding.risk.signals, ...deterministic.signals]);
  if (
    level === understanding.risk.level &&
    signals.length === understanding.risk.signals.length &&
    signals.every((signal, index) => signal === understanding.risk.signals[index]) &&
    (level !== "P0" || understanding.complexity === "critical")
  ) {
    return understanding;
  }
  return {
    ...understanding,
    complexity: level === "P0" ? "critical" : understanding.complexity,
    risk: {
      level,
      signals,
    },
  };
}

function transverseStates(text: string, intents: string[], journeys: string[], intentChanged: boolean): string[] {
  const states: string[] = [];
  if (journeys.length > 1 || intents.length > 2) states.push("MULTI_INTENT");
  if (intentChanged) states.push("INTENT_CHANGED");
  if (/urgente|demanda funeraria/.test(text)) states.push("URGENT_FUNERAL_NEED");
  if (/podem esperar/.test(text)) states.push("DEFERRED_NON_URGENT_TRACKS");
  if (/continua de outro dia|contato anterior/.test(text)) states.push("LONGITUDINAL_CONTINUITY");
  if (/aguardando a administracao/.test(text)) states.push("WAITING_ADMIN", "NOT_ABANDONED");
  if (/reclamacao.*(?:aberta|sem retorno|sem resposta)/.test(text)) states.push("OPEN_COMPLAINT");
  if (/nao quero (?:reiniciar|recomecar)|escolha novamente/.test(text)) states.push("NO_RETRIAGE");
  if (/ja esta agendad/.test(text)) states.push("PARTIAL_MULTI_TRACK_CLOSURE");
  if (/fontes?.*incompativ|orientacoes? incompativeis/.test(text)) states.push("CONFLICTING_EVIDENCE");
  if (/alternativa.*bloquead/.test(text)) states.push("BRANCH_AWARE_CONTINGENCY");
  if (/aceito explicitamente.*contingencia/.test(text)) states.push("ACCEPTED_PLAN_NOT_COMPLETED");
  if (/pagamento.*falh/.test(text)) states.push("PAYMENT_FAILURE_RECOVERY");
  if (/receipt/.test(text)) states.push("RECEIPT_AWARE_CLOSURE");
  if (/\b(?:ok|obrigad[oa]|perfeito|certo|entendi)\b/.test(text)) states.push("CONVERSATION_CLOSING");
  if (/\[midia_nao_analisada\]|midia nao analisada/.test(text)) states.push("MEDIA_NOT_ANALYZED");
  return unique(states);
}

export function understandMessages(messages: readonly MotorV2Message[]): UnderstandingResult {
  const userMessages = messages.filter((message) => message.role === "user");
  const allText = normalizeText(userMessages.map((message) => message.content).join("\n"));
  const perTurn = userMessages.map((message) => intentsFor(normalizeText(message.content)));
  let subintents = unique(perTurn.flat());
  const hasRemainsContext = subintents.some((intent) =>
    [
      "EXUMACAO",
      "RETIRAR_RESTOS",
      "DESTINO_OSSUARIO",
      "DESTINO_RESTOS",
      "REINUMACAO",
      "CORPO_SEMI_INTACTO",
      "TRASLADO",
    ].includes(intent)
  );
  if (hasRemainsContext && subintents.includes("CREMACAO_IMEDIATA")) {
    subintents = unique([...subintents.filter((intent) => intent !== "CREMACAO_IMEDIATA"), "CREMACAO"]);
  }
  if (
    hasRemainsContext && subintents.includes("TRANSFERENCIA") &&
    !/responsabilidade|concessao|titularidade|administracao provisoria|direito de uso/.test(allText)
  ) {
    subintents = subintents.filter((intent) => intent !== "TRANSFERENCIA");
  }
  if (
    subintents.includes("CORPO_SEMI_INTACTO") && subintents.includes("JAZIGO_GERAL") &&
    !subintents.some((intent) =>
      ["LAPIDE_PLACA", "LIMPEZA_ZELADORIA", "MANUTENCAO_JAZIGO", "OBRA_REFORMA", "VISITA_JAZIGO"].includes(intent)
    )
  ) {
    subintents = subintents.filter((intent) => intent !== "JAZIGO_GERAL");
  }
  const initial = new Set(journeysForIntents(unique(perTurn.slice(0, 3).flat())));
  const final = new Set(journeysForIntents(unique(perTurn.slice(-3).flat())));
  const intentChanged = initial.size > 0 && final.size > 0 &&
    (initial.size !== final.size || [...initial].some((journey) => !final.has(journey)));
  let journeys = journeysForIntents(subintents);
  if (/\b(?:restos mortais|ossos)\b/.test(allText) && !journeys.includes("RESTOS_MORTAIS")) {
    journeys = [...journeys, "RESTOS_MORTAIS"];
  }
  if (journeys.length === 0) journeys = ["DESCONHECIDA_AMBIGUA"];
  let risk = riskFor(allText, subintents);
  if (subintents.length === 0 && /sensivel|falecimento|sepultamento/.test(allText)) {
    risk = { level: "P0", signals: unique([...risk.signals, "low_confidence_sensitive_context"]) };
  }
  const transverse_states = transverseStates(allText, subintents, journeys, intentChanged);
  const complexity: Complexity = risk.level === "P0" || journeys.length >= 4 || subintents.length >= 6
    ? "critical"
    : journeys.length >= 3 || subintents.length >= 4
    ? "high"
    : journeys.length >= 2 || subintents.length >= 2
    ? "medium"
    : "low";
  const confidence = subintents.length === 0 ? "low" : subintents.length === 1 ? "medium" : "high";
  return {
    schema_version: "motor-v2-understanding/1.0.0",
    journeys,
    subintents,
    transverse_states,
    intent_changed: intentChanged,
    complexity,
    risk,
    confidence,
    evidence_turns: userMessages.filter((_, index) => (perTurn[index]?.length ?? 0) > 0).map((message) =>
      message.turn_id
    ),
  };
}

const CONTEXT_INTENTS: IntentRule[] = [
  { code: "CONCESSAO", patterns: [/concession|concessao/] },
  { code: "DESVIO_COMERCIAL", patterns: [/commercial offer|oferta nao relacionada/] },
  { code: "RENOVACAO_OSSUARIO", patterns: [/renewal|renovacao/] },
  { code: "RECUPERACAO_APOS_FALHA_DE_PAGAMENTO", patterns: [/payment attempt failed|pagamento.*falh/] },
];

/** Seeded state is context, not an answer key; only general lexical hints are admitted. */
export function enrichUnderstandingWithContext(
  understanding: UnderstandingResult,
  contextTokens: readonly string[],
): UnderstandingResult {
  const text = normalizeText(contextTokens.join(" "));
  const contextual = CONTEXT_INTENTS.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map((rule) =>
    rule.code
  );
  const subintents = unique([...understanding.subintents, ...contextual]);
  const journeys = unique([
    ...understanding.journeys,
    ...JOURNEYS.filter((journey) => journey.intents.some((intent) => contextual.includes(intent))).map((journey) =>
      journey.code
    ),
  ]);
  return { ...understanding, subintents, journeys };
}
