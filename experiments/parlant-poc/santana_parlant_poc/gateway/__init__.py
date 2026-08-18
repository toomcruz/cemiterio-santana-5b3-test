"""Santana Authority Gateway — a unica porta entre o Parlant e a autoridade.

O Parlant nao le PDF, nao le tabela solta, nao le Supabase e nao le arquivo
arbitrario. Ele pergunta aqui, e aqui responde com origem identificavel.
"""

from .resposta import (
    CONFLITO,
    DISPONIVEL,
    NAO_DISPONIVEL,
    RespostaAutoritativa,
)
from .gateway import GATEWAY, SantanaAuthorityGateway

__all__ = [
    "CONFLITO",
    "DISPONIVEL",
    "NAO_DISPONIVEL",
    "RespostaAutoritativa",
    "SantanaAuthorityGateway",
    "GATEWAY",
]
