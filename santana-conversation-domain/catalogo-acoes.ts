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

// Validação: ciclos próprios para não-colapso
export function verificaNaoColapso(_acao: Acao, acompanhamento: Acompanhamento): boolean {
  return acompanhamento.ciclo_proprio >= 0;
}
