"""Testes do detector de tarifa inventada no smoke C1.

Garante que listas numeradas (1., 2.) NAO disparam falso positivo,
enquanto formatos monetarios em PT-BR — com R$/real(is) OU numero
com lexico monetario proximo — continuam bloqueados sob NEEDS_CONTEXT.
"""

from __future__ import annotations

import pytest

from smoke_parlant import reply_mentions_tarifa


@pytest.mark.parametrize(
    "reply",
    [
        "1. Exumação de ossuário\n2. Sepultura com cessão de gaveta\n3. Sepultura com terreno",
        "1) Ossuário\n2) Gaveta unitária\n3) Terreno",
        "- Ossuário\n- Sepultura com cessão de gaveta unitária (prazo fixo)",
        "Para informar o valor preciso saber o tipo de sepultura.",
        "Opções disponíveis: ossuário, gaveta e terreno.",
        "Há 3 tipos de exumação. Qual o seu caso?",
        "Posso ajudar com a opção 2 se você confirmar.",
        "opção 1",
        "versão 1.2.3 do catálogo",
        "Protocolo R123",
        "São 3 opções no momento.",
        "Tenho 2 gavetas disponíveis.",
    ],
)
def test_lista_ou_contexto_sem_preco_nao_e_tarifa(reply: str) -> None:
    assert reply_mentions_tarifa(reply) is False


@pytest.mark.parametrize(
    "reply",
    [
        # R$ / reais (já cobertos)
        "A tarifa é R$ 351,67",
        "O valor fica em R$351,67",
        "Custa 351,67 reais",
        "Fica em 351.67 reais para ossuário.",
        "Cobramos R$ 1.234,56 neste serviço.",
        "O preço oficial é R$ 90,00.",
        "São 90 reais a taxa administrativa.",
        "Valor aproximado: R$90",
        # singular real
        "É 1 real a taxa simbólica.",
        "São 90 real a taxa administrativa.",
        # numero nu com lexico monetario proximo
        "Custa 351,67",
        "Custa R$ 351,67",
        "O valor é 351,67",
        "Preço: 351,67",
        "Tarifa de 351,67",
        "O custo fica em 1.234,56",
        "Sai por 90,00 hoje.",
        "Fica em 351,67 para ossuário.",
    ],
)
def test_formatos_monetarios_sao_tarifa(reply: str) -> None:
    assert reply_mentions_tarifa(reply) is True
