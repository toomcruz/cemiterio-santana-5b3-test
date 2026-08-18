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

# Motivos de indisponibilidade. Sao codigos, nao frases: o texto ao municipe vem
# de canned response, nao daqui.
SEM_FONTE_OFICIAL = "SEM_FONTE_OFICIAL_CARREGADA"
APLICABILIDADE_INDETERMINADA = "APLICABILIDADE_INDETERMINADA"
TIPO_DESCONHECIDO = "TIPO_DE_INFORMACAO_DESCONHECIDO"
FORA_DE_VIGENCIA = "SEM_ENTRADA_VIGENTE"
FONTES_EM_CONFLITO = "FONTES_OFICIAIS_EM_CONFLITO"


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

    @property
    def encaminhar_administracao(self) -> bool:
        """Falha segura: o que nao esta disponivel ou esta em conflito vai para a
        Administracao. Nao existe terceiro caminho."""
        return self.status != DISPONIVEL

    def as_dict(self) -> dict[str, Any]:
        dados: dict[str, Any] = {
            "release_id": self.release_id,
            "tipo_informacao": self.tipo_informacao,
            "status": self.status,
            "aplicabilidade": dict(self.aplicabilidade),
            "encaminhar_administracao": self.encaminhar_administracao,
        }
        for chave in ("valor", "source_id", "entry_id", "vigencia_inicio", "vigencia_fim", "motivo"):
            valor = getattr(self, chave)
            if valor is not None:
                dados[chave] = dict(valor) if chave == "valor" else valor
        if self.entradas_em_conflito:
            dados["entradas_em_conflito"] = list(self.entradas_em_conflito)
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
