/**
 * Read-only information lane for the official runtime. It renders approved
 * Gateway output directly and never changes a goal, a fact or an action.
 * Mixed requests remain with the normal interpreter so information cannot
 * swallow a correction, cancellation, new case or human takeover.
 */
import { consultar } from "../../santana-authority-gateway/gateway.ts";
import { carregarDeBytes, type CatalogoOficial } from "../../santana-authority-gateway/catalogo/carregar.ts";
import { exigirDataCivil } from "../../santana-authority-gateway/canonico.ts";
import type { Contexto } from "../../santana-authority-gateway/consulta.ts";
import { camposParaCanned, type RespostaAutoritativa } from "../../santana-authority-gateway/resposta.ts";
import { activeFact, contextGoal, type ConversationState } from "../engine/engine.ts";
import { authorityDomainSources, authoritySource } from "./generated_authority_assets.ts";

export interface OfficialInformationReply {
  text: string;
  status: "AVAILABLE" | "NEEDS_CONTEXT" | "NOT_AVAILABLE" | "CONFLICT";
  topic: string;
  information_type: string;
  authority: RespostaAutoritativa | null;
  preserves_goal: true;
  /** This is a requirement, not a claim that an operational task was created. */
  administration_required: boolean;
}

export interface OfficialInformationInput {
  text: string;
  state: ConversationState;
  /** Civil date in São Paulo; injectable for deterministic replay. */
  referenceDate?: string;
}

let catalogPromise: Promise<CatalogoOficial> | null = null;

/** No filesystem/environment reads: the Edge embeds exact approved bytes. */
export function loadOfficialInformationCatalog(): Promise<CatalogoOficial> {
  if (!catalogPromise) {
    const encoder = new TextEncoder();
    const domain = new Map(
      Object.entries(authorityDomainSources).map(([name, content]) => [
        name,
        encoder.encode(content),
      ]),
    );
    catalogPromise = carregarDeBytes(encoder.encode(authoritySource), domain);
  }
  return catalogPromise;
}

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasOperationalIntent(text: string): boolean {
  return /\b(cancela\w*|desist\w*|corrig\w*|correcao|na verdade|mudei|trocar|alterar|retificar|em vez|nao e|nao quero|atendente|atendimento humano|falar com (?:uma? )?(?:pessoa|alguem)|me transfira|transferir (?:para|pra) (?:uma? )?(?:pessoa|atendente)|outro falecido|outra pessoa|outro atendimento|novo atendimento|tambem|ja enviei|segue (?:o|a|meu|minha)|anexei|finalizar|encerrar|quero (?:realizar|fazer|exumar|colocar)|preciso (?:realizar|fazer|exumar|colocar))\b/
    .test(text) ||
    /\b(?:meu|minha) (?:tia|tio|avo|irmao|irma|primo|prima)\b/.test(text) ||
    /\b(?:meu|minha)\b.*\b(?:faleceu|morreu|esta viv[oa]|e viv[oa])\b/.test(text);
}

function informationType(text: string): string | null {
  if (/\b(preco|precos|valor|valores|custo|custos|custa|custam|tarifa|taxa)\b/.test(text)) return "PRECO";
  if (/\b(horario|horarios|horas|funcionamento|abre|abrem|fecha|fecham)\b/.test(text)) return "HORARIO";
  if (/\b(quem|assinatura)\b.*\b(assina|assinar|autoriza|autorizar|exumacao)\b/.test(text)) {
    return "ASSINATURA_EXUMACAO";
  }
  if (/\b(documento|documentos|documentacao|papeis)\b/.test(text)) return "DOCUMENTOS";
  if (/\b(prazo|prazos|demora|quanto tempo)\b/.test(text)) return "PRAZO";
  if (/\b(semi intacto|semi intactos|semi-intacto|semi-intactos)\b/.test(text)) return "SEMI_INTACTO";
  if (/\b(regularidade|regularizacao|regularizado)\b/.test(text)) return "REGULARIDADE_DO_JAZIGO";
  if (/\b(?:restos|ossos) ja (?:foram )?exumados\b/.test(text)) return "RESTOS_JA_EXUMADOS";
  if (/\b(jazigo|sepultura) (?:da |de )?familia\b/.test(text)) return "JAZIGO_DESTINO";
  if (/\b(ossuario|ossuarios)\b/.test(text)) return "OSSUARIO";
  if (/\b(transporte|transportar|translado|traslado)\b/.test(text)) return "TRANSPORTE";
  if (/\b(procedimento|procedimentos|regras|como funciona|como fazer|como faco|preciso saber)\b/.test(text)) {
    return "PROCEDIMENTO_ADMINISTRATIVO";
  }
  return null;
}

function explicitTopic(text: string, type: string): string | null {
  if (type === "HORARIO") return "HORARIO";
  if (/\b(exumacao|exumar)\b/.test(text)) return "EXUMACAO";
  if (/\b(recadastro)\b/.test(text)) return "RECADASTRO";
  if (/\b(concessao)\b/.test(text)) return "CONCESSAO";
  if (/\b(ossuario|ossuarios)\b/.test(text)) return "OSSUARIO";
  if (/\b(lapide|zeladoria|comercial)\b/.test(text)) return "COMERCIAL";
  if (/\b(transporte|translado|traslado)\b/.test(text)) return "TRANSPORTE";
  if (/\b(jazigo)\b/.test(text) && type !== "JAZIGO_DESTINO") return "JAZIGO_SERVICOS";
  return null;
}

function currentContext(state: ConversationState): Contexto {
  const goal = contextGoal(state);
  // Context from another case never selects an exhumation answer.
  if (!goal || !["GOAL_EXUMACAO", "GOAL_TRANSPORTE"].includes(goal.goal_code)) return { servico: "EXUMACAO" };
  const spouse = activeFact(state, "surviving_spouse_status", goal);
  if (!spouse || spouse.confidence !== "CONFIRMED" || spouse.conflicts_with !== null) return { servico: "EXUMACAO" };
  if (spouse.value === "VIVO") return { servico: "EXUMACAO", situacao_do_conjuge: "VIVO" };
  if (["FALECIDO", "INEXISTENTE"].includes(String(spouse.value))) {
    return { servico: "EXUMACAO", situacao_do_conjuge: "SEM_CONJUGE_SOBREVIVENTE" };
  }
  // Neither transport destination nor citizen terminology selects a tariff.
  return { servico: "EXUMACAO" };
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const infoLabels: Record<string, string> = {
  PRECO: "o valor",
  HORARIO: "o horário de atendimento",
  DOCUMENTOS: "a lista de documentos",
  PRAZO: "o prazo",
  PROCEDIMENTO_ADMINISTRATIVO: "o procedimento",
  TRANSPORTE: "as condições de transporte",
};

function unavailable(type: string): string {
  return `Ainda não tenho uma informação oficial publicada que confirme ${
    infoLabels[type] ?? "essa orientação"
  } para o seu caso. A Administração precisa confirmar esse ponto para orientar você com segurança.`;
}

/** Returns null when the normal conversation lane must handle the message. */
export async function officialInformationReply(
  input: OfficialInformationInput,
): Promise<OfficialInformationReply | null> {
  const text = normalized(input.text);
  if (input.state.handoff || hasOperationalIntent(text)) return null;
  const question =
    /\?|\b(qual|quais|quanto|quantos|quando|quem|como|por que|o que|me explique|pode explicar|pode me explicar|quero saber|gostaria de saber|me informe|me informa|informacoes sobre)\b/
      .test(text);
  if (!question) return null;
  const type = informationType(text);
  if (!type) return null;
  const goal = contextGoal(input.state);
  const topic = explicitTopic(text, type) ?? input.state.current_topic ??
    goal?.goal_code.replace(/^GOAL_(?:INFO_)?/, "") ?? "OUTROS_ASSUNTOS";
  const base = { topic, information_type: type, preserves_goal: true as const };
  const isExhumationInformation = topic === "EXUMACAO" ||
    (topic === "OSSUARIO" && type === "OSSUARIO") ||
    (topic === "TRANSPORTE" && ["TRANSPORTE", "JAZIGO_DESTINO", "RESTOS_JA_EXUMADOS"].includes(type));
  if (!isExhumationInformation) {
    return {
      ...base,
      text: unavailable(type),
      status: "NOT_AVAILABLE",
      authority: null,
      administration_required: true,
    };
  }

  const reference = exigirDataCivil(input.referenceDate ?? todayInSaoPaulo(), "official information reference");
  let authority: RespostaAutoritativa;
  try {
    authority = await consultar(type, currentContext(input.state), reference, loadOfficialInformationCatalog);
  } catch {
    // A catalog/bundle failure must not produce a guessed answer or swallow
    // the turn. Do not expose internal errors or filesystem paths to citizens.
    return {
      ...base,
      text: unavailable(type),
      status: "NOT_AVAILABLE",
      authority: null,
      administration_required: true,
    };
  }
  if (authority.status === "AVAILABLE") {
    // PRECO cannot be selected by this lane: no modality mapping has been
    // approved. Guard also against future accidental context expansion.
    if (type === "PRECO") {
      return {
        ...base,
        text:
          "A modalidade da sepultura de origem e a vigência da tabela precisam ser confirmadas pela Administração antes de informar a tarifa.",
        status: "NOT_AVAILABLE",
        authority: { ...authority, status: "NOT_AVAILABLE", valor: null, motivo: "MAPEAMENTOS_TARIFARIOS_PENDENTES" },
        administration_required: true,
      };
    }
    const fields = camposParaCanned(authority);
    if (fields.texto) {
      return { ...base, text: fields.texto, status: "AVAILABLE", authority, administration_required: false };
    }
    return { ...base, text: unavailable(type), status: "NOT_AVAILABLE", authority, administration_required: true };
  }
  if (authority.status === "NEEDS_CONTEXT") {
    const explanation = type === "PRECO"
      ? "O valor depende da modalidade da sepultura de origem. Essa modalidade e a vigência da tabela precisam ser confirmadas pela Administração antes de informar a tarifa. O destino dos restos, como o ossuário, não determina esse valor."
      : "Essa informação depende de detalhes do caso que ainda precisam ser confirmados pela Administração.";
    return { ...base, text: explanation, status: "NEEDS_CONTEXT", authority, administration_required: true };
  }
  return {
    ...base,
    text: unavailable(type),
    status: authority.status === "CONFLICT" ? "CONFLICT" : "NOT_AVAILABLE",
    authority,
    administration_required: true,
  };
}
