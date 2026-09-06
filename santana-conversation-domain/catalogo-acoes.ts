// Catálogo de Ações e Autoridade (FASE 4F — G10, G13)
// Fora da fronteira de release_id; aditivo

export type AcaoExecutor = "SISTEMA" | "HUMANO";
export type AcaoEstado = "AGENDADA" | "EXECUTADA" | "FALHADA" | "CANCELADA";
export type AcompanhamentoEstado = "ABERTO" | "FECHADO" | "PAUSADO";

export const ACOES_CATALOGADAS = {
  ENVIO_EMAIL: { desc: "Enviar email ao cliente", executor: "SISTEMA", categoria: "comunicacao" },
  ENVIO_WHATSAPP: { desc: "Enviar WhatsApp", executor: "SISTEMA", categoria: "comunicacao" },
  CHAMADA_HUMANO: { desc: "Transferir para operador", executor: "HUMANO", categoria: "escalacao" },
  AGENDAR_VISITA: { desc: "Agendar visita", executor: "HUMANO", categoria: "agenda" },
  COBRAR_TAXA: { desc: "Processar cobrança", executor: "SISTEMA", categoria: "financeiro" },
  REGISTRAR_VENDA: { desc: "Registrar venda", executor: "HUMANO", categoria: "vendas" },
  ATUALIZAR_CASO: { desc: "Atualizar dados do caso", executor: "HUMANO", categoria: "admin" },
  FECHAR_CASO: { desc: "Fechar caso", executor: "HUMANO", categoria: "admin" },
} as const;

export interface Acao {
  id: string;
  tipo: keyof typeof ACOES_CATALOGADAS;
  estado: AcaoEstado;
  executor: AcaoExecutor;
  agendado_em?: string; // ISO timestamp
  executado_em?: string;
  acompanhamento_id?: string;
}

export interface Acompanhamento {
  id: string;
  acao_id: string;
  estado: AcompanhamentoEstado;
  criado_em: string;
  ultima_atualizacao: string;
  ciclo_proprio: number; // contador próprio
}

const TRANSICOES_ACAO: Record<AcaoEstado, readonly AcaoEstado[]> = {
  AGENDADA: ["EXECUTADA", "FALHADA", "CANCELADA"],
  EXECUTADA: [],
  FALHADA: ["AGENDADA", "CANCELADA"],
  CANCELADA: [],
};

const TRANSICOES_ACOMPANHAMENTO: Record<AcompanhamentoEstado, readonly AcompanhamentoEstado[]> = {
  ABERTO: ["PAUSADO", "FECHADO"],
  PAUSADO: ["ABERTO", "FECHADO"],
  FECHADO: [],
};

function assertId(value: string, name: string): void {
  if (!value || value.trim().length === 0) throw new Error(`${name} obrigatorio`);
}

function assertTimestamp(value: string, name: string): void {
  assertId(value, name);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} invalido`);
}

export function createAcao(input: {
  id: string;
  tipo: keyof typeof ACOES_CATALOGADAS;
  executor: AcaoExecutor;
  agendado_em: string;
}): Acao {
  assertId(input.id, "acao.id");
  assertTimestamp(input.agendado_em, "agendado_em");
  const expected = ACOES_CATALOGADAS[input.tipo].executor;
  if (input.executor !== expected) {
    throw new Error(`${input.tipo} exige executor ${expected}`);
  }
  return { ...input, estado: "AGENDADA" };
}

export function transitionAcao(
  acao: Acao,
  next: AcaoEstado,
  ocorrido_em: string,
): Acao {
  assertTimestamp(ocorrido_em, "ocorrido_em");
  if (!TRANSICOES_ACAO[acao.estado].includes(next)) {
    throw new Error(`transicao de acao invalida: ${acao.estado} → ${next}`);
  }
  return next === "EXECUTADA" ? { ...acao, estado: next, executado_em: ocorrido_em } : { ...acao, estado: next };
}

export function createAcompanhamento(input: {
  id: string;
  acao_id: string;
  criado_em: string;
}): Acompanhamento {
  assertId(input.id, "acompanhamento.id");
  assertId(input.acao_id, "acompanhamento.acao_id");
  assertTimestamp(input.criado_em, "criado_em");
  return {
    ...input,
    estado: "ABERTO",
    ultima_atualizacao: input.criado_em,
    ciclo_proprio: 0,
  };
}

export function transitionAcompanhamento(
  acompanhamento: Acompanhamento,
  next: AcompanhamentoEstado,
  ocorrido_em: string,
): Acompanhamento {
  assertTimestamp(ocorrido_em, "ocorrido_em");
  if (!TRANSICOES_ACOMPANHAMENTO[acompanhamento.estado].includes(next)) {
    throw new Error(`transicao de acompanhamento invalida: ${acompanhamento.estado} → ${next}`);
  }
  return {
    ...acompanhamento,
    estado: next,
    ultima_atualizacao: ocorrido_em,
    ciclo_proprio: acompanhamento.ciclo_proprio + 1,
  };
}

// A ação e o acompanhamento coexistem, mas devem manter vínculo explícito.
export function verificaNaoColapso(acao: Acao, acompanhamento: Acompanhamento): boolean {
  return acao.id.length > 0 &&
    acompanhamento.id.length > 0 &&
    acompanhamento.acao_id === acao.id &&
    Number.isInteger(acompanhamento.ciclo_proprio) &&
    acompanhamento.ciclo_proprio >= 0;
}
