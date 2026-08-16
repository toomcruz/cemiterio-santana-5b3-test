"""Base de conhecimento autoritativa da POC (fechada, curada, sem LLM).

Qualquer pergunta sobre preco, documento exigido, prazo ou procedimento
administrativo passa por aqui. O que nao esta publicado nesta base responde
`NAO_DISPONIVEL` — e nunca e completado pelo modelo.

A fronteira segue `facts.v1.json > ai_boundary`: o LLM nao pode
DEFINE_PRICES, DEFINE_REQUIRED_DOCUMENTS, DEFINE_OFFICIAL_RULE,
DEFINE_PERMISSIONS nem EXECUTE_PROTECTED_TRANSITION.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

AVAILABLE = "DISPONIVEL"
NOT_AVAILABLE = "NAO_DISPONIVEL"

# Categorias que o LLM esta proibido de responder por conta propria.
RESTRICTED_TOPICS = ("PRECO", "DOCUMENTOS", "PRAZO", "PROCEDIMENTO_ADMINISTRATIVO")


@dataclass(frozen=True)
class KnowledgeAnswer:
    topic: str
    status: str
    text: str
    source: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "topic": self.topic,
            "status": self.status,
            "answer": self.text,
            "source": self.source,
        }


_UNPUBLISHED = {
    "PRECO": (
        "Nao ha valor de exumacao publicado nesta base. Nenhum preco pode ser informado "
        "pelo atendimento: a Administracao do Cemiterio Santana informa valores."
    ),
    "DOCUMENTOS": (
        "A lista oficial de documentos exigidos nao esta publicada nesta base. "
        "A Administracao do Cemiterio Santana confirma os documentos do caso."
    ),
    "PRAZO": (
        "Nao ha prazo publicado nesta base. A Administracao do Cemiterio Santana "
        "informa prazos apos a analise do pedido."
    ),
    "PROCEDIMENTO_ADMINISTRATIVO": (
        "A definicao do procedimento administrativo e da Administracao do Cemiterio Santana. "
        "O atendimento nao decide procedimento."
    ),
}

# Conteudo autoritativo publicado: deriva de decisoes humanas ja fechadas em
# `santana-conversation-domain` (5B.4-A.1).
_PUBLISHED: Mapping[str, tuple[str, str]] = {
    "ASSINATURA_EXUMACAO": (
        "Com esposo ou companheiro do falecido vivo, ele autoriza e assina junto com o "
        "responsavel pelo jazigo (concessionario ou Administrador Provisorio). Sem conjuge "
        "sobrevivente, assina o responsavel pelo jazigo.",
        "santana-conversation-domain/relations.v1.json (decisao humana 6)",
    ),
    "JAZIGO_DESTINO": (
        "Quando o destino e jazigo da familia, a situacao do jazigo precisa ser verificada pela "
        "Administracao e a colocacao dos restos exige autorizacao do concessionario ou do "
        "Administrador Provisorio. A declaracao do municipe nao confirma esses pontos.",
        "santana-conversation-domain/facts.v1.json (decisoes humanas 1 e 2)",
    ),
    "RESTOS_JA_EXUMADOS": (
        "Se os restos ja foram exumados neste atendimento, a exumacao deixa de ser exigida "
        "para este caso. Isso vale apenas para este caso, nao e proibicao permanente.",
        "santana-conversation-domain/relations.v1.json (decisao humana 5)",
    ),
    "OSSUARIO": (
        "O ossuario e um destino possivel para os restos apos a exumacao. Condicoes, "
        "disponibilidade e custos sao informados pela Administracao.",
        "santana-conversation-domain/topics.v1.json (capacidade DESTINO_OSSUARIO)",
    ),
}

_ALIASES: Mapping[str, str] = {
    "PRECO": "PRECO",
    "PRECOS": "PRECO",
    "VALOR": "PRECO",
    "VALORES": "PRECO",
    "CUSTO": "PRECO",
    "TAXA": "PRECO",
    "DOCUMENTO": "DOCUMENTOS",
    "DOCUMENTOS": "DOCUMENTOS",
    "DOCUMENTACAO": "DOCUMENTOS",
    "PRAZO": "PRAZO",
    "PRAZOS": "PRAZO",
    "TEMPO": "PRAZO",
    "DATA": "PRAZO",
    "PROCEDIMENTO": "PROCEDIMENTO_ADMINISTRATIVO",
    "PROCEDIMENTO_ADMINISTRATIVO": "PROCEDIMENTO_ADMINISTRATIVO",
    "REGRA": "PROCEDIMENTO_ADMINISTRATIVO",
    "ASSINATURA": "ASSINATURA_EXUMACAO",
    "ASSINATURA_EXUMACAO": "ASSINATURA_EXUMACAO",
    "AUTORIZACAO": "ASSINATURA_EXUMACAO",
    "QUEM_ASSINA": "ASSINATURA_EXUMACAO",
    "JAZIGO": "JAZIGO_DESTINO",
    "JAZIGO_DESTINO": "JAZIGO_DESTINO",
    "OSSUARIO": "OSSUARIO",
    "RESTOS_JA_EXUMADOS": "RESTOS_JA_EXUMADOS",
}


def normalize_topic(topic: str) -> str:
    key = (topic or "").strip().upper().replace(" ", "_").replace("-", "_")
    return _ALIASES.get(key, key)


def lookup(topic: str) -> KnowledgeAnswer:
    """Consulta a base fechada. Nunca retorna conteudo gerado pelo modelo."""
    key = normalize_topic(topic)

    if key in _UNPUBLISHED:
        return KnowledgeAnswer(
            topic=key,
            status=NOT_AVAILABLE,
            text=_UNPUBLISHED[key],
            source="base-autoritativa-poc (sem valor publicado)",
        )

    if key in _PUBLISHED:
        text, source = _PUBLISHED[key]
        return KnowledgeAnswer(topic=key, status=AVAILABLE, text=text, source=source)

    return KnowledgeAnswer(
        topic=key or "DESCONHECIDO",
        status=NOT_AVAILABLE,
        text=(
            "Este ponto nao esta publicado na base do atendimento. Quem responde e a "
            "Administracao do Cemiterio Santana."
        ),
        source="base-autoritativa-poc (assunto nao publicado)",
    )


def published_topics() -> tuple[str, ...]:
    return tuple(sorted(_PUBLISHED))


def restricted_topics() -> tuple[str, ...]:
    return RESTRICTED_TOPICS
