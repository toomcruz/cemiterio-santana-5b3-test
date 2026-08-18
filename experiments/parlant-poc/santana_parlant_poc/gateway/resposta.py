"""Formato unico de resposta autoritativa.

Toda resposta carrega de onde veio e a que caso se aplica. Isso e o que permite
auditar depois — e o que impede o LLM de substituir o valor: o texto entregue ao
municipe sai de `campos_para_canned()`, nao da geracao livre.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

DISPONIVEL = "AVAILABLE"
NAO_DISPONIVEL = "NOT_AVAILABLE"
CONFLITO = "CONFLICT"
# Ha conhecimento oficial, e ha mais de uma entrada possivel para este caso. Nao
# e indisponibilidade e nao e conflito entre fontes: e falta de contexto. A saida
# certa e perguntar, nunca escolher — nem pelo Gateway, nem pelo modelo.
PRECISA_DE_CONTEXTO = "NEEDS_CONTEXT"

# Motivos de indisponibilidade. Sao codigos, nao frases: o texto ao municipe vem
# de canned response, nao daqui.
SEM_FONTE_OFICIAL = "SEM_FONTE_OFICIAL_CARREGADA"
APLICABILIDADE_INDETERMINADA = "APLICABILIDADE_INDETERMINADA"
TIPO_DESCONHECIDO = "TIPO_DE_INFORMACAO_DESCONHECIDO"
FORA_DE_VIGENCIA = "SEM_ENTRADA_VIGENTE"
FONTES_EM_CONFLITO = "FONTES_OFICIAIS_EM_CONFLITO"
CONTEXTO_INCOMPATIVEL = "CONTEXTO_INCOMPATIVEL_COM_AS_ENTRADAS"
CONTEXTO_INSUFICIENTE = "CONTEXTO_INSUFICIENTE_PARA_DETERMINAR"


@dataclass(frozen=True)
class RespostaAutoritativa:
    """O que o Gateway devolve. Nunca e texto livre de modelo."""

    release_id: str
    tipo_informacao: str
    status: str
    aplicabilidade: Mapping[str, str] = field(default_factory=dict)
    valor: Mapping[str, Any] | None = None
    source_id: str | None = None
    entry_id: str | None = None
    vigencia_inicio: str | None = None
    vigencia_fim: str | None = None
    motivo: str | None = None
    entradas_em_conflito: tuple[str, ...] = ()
    # Quais informacoes faltam para determinar a entrada. So faz sentido em
    # NEEDS_CONTEXT, e e o que a pergunta de esclarecimento precisa cobrir.
    contexto_faltante: tuple[str, ...] = ()
    opcoes_possiveis: tuple[str, ...] = ()

    @property
    def encaminhar_administracao(self) -> bool:
        """Falha segura: o que nao esta disponivel ou esta em conflito vai para a
        Administracao.

        `NEEDS_CONTEXT` NAO encaminha: a informacao existe, falta saber de qual
        caso se trata. O caminho ali e perguntar.
        """
        return self.status in (NAO_DISPONIVEL, CONFLITO)

    @property
    def precisa_de_contexto(self) -> bool:
        return self.status == PRECISA_DE_CONTEXTO

    def as_dict(self) -> dict[str, Any]:
        dados: dict[str, Any] = {
            "release_id": self.release_id,
            "tipo_informacao": self.tipo_informacao,
            "status": self.status,
            "aplicabilidade": dict(self.aplicabilidade),
            "encaminhar_administracao": self.encaminhar_administracao,
            "precisa_de_contexto": self.precisa_de_contexto,
        }
        for chave in ("valor", "source_id", "entry_id", "vigencia_inicio", "vigencia_fim", "motivo"):
            valor = getattr(self, chave)
            if valor is not None:
                dados[chave] = dict(valor) if chave == "valor" else valor
        if self.entradas_em_conflito:
            dados["entradas_em_conflito"] = list(self.entradas_em_conflito)
        if self.contexto_faltante:
            dados["contexto_faltante"] = list(self.contexto_faltante)
        if self.opcoes_possiveis:
            dados["opcoes_possiveis"] = list(self.opcoes_possiveis)
        return dados

    def campos_para_canned(self) -> dict[str, str]:
        """Campos que uma canned response pode interpolar.

        So sai campo quando o status e DISPONIVEL. Em STRICT, uma resposta que
        depende de um campo ausente nao pode ser enviada — que e exatamente o
        comportamento desejado quando nao ha valor oficial.
        """
        if self.status != DISPONIVEL or not self.valor:
            return {}
        return {chave: str(valor) for chave, valor in self.valor.items()}
