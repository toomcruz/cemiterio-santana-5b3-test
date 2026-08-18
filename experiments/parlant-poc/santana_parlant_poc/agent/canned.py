"""Respostas aprovadas de preco, uma por estado do Authority Gateway.

Por que este modulo existe separado da `spec.py`: a resposta que carrega o valor
**nao pode** ser uma canned response armazenada e pendurada em `G_PRECO`. O
compositor do Parlant pre-renderiza as candidatas da guideline que casou, e isso
acontece antes de qualquer tool rodar. Com `{{valor}}` no template e nenhum
valor em contexto, a extracao de campo falha, gasta uma chamada ao modelo e
enche o log de erro — foi o que o run 32146735829 mostrou.

A forma segura e a inversa: a resposta com valor nasce **da tool**, junto com o
campo, e so quando o Gateway devolveu AVAILABLE. O Parlant trata resposta vinda
de tool como transiente e a aceita sem depender do filtro de campos.

Os outros tres estados nao dependem de campo nenhum, entao podem ser respostas
armazenadas normais.
"""

from __future__ import annotations

from ..gateway.resposta import (
    CONFLITO,
    DISPONIVEL,
    NAO_DISPONIVEL,
    PRECISA_DE_CONTEXTO,
)

# Unica resposta que menciona valor. Entregue por `ToolResult.canned_responses`,
# nunca armazenada: se ela existisse na base de respostas do agente, o
# compositor tentaria renderiza-la sem o campo.
PRECO_DISPONIVEL = "O valor aplicavel neste caso e {{valor}}, referente a {{modalidade}}."

# Armazenadas em `spec.CANNED_RESPONSES`, nenhuma com campo de tool.
PRECO_PRECISA_CONTEXTO = (
    "O valor muda conforme o tipo de sepultamento. Para eu te informar o valor certo, "
    "me diga onde a pessoa esta sepultada: em ossuario, em sepultura de terreno ou em "
    "gaveta?"
)
PRECO_EM_CONFLITO = (
    "Encontrei mais de um valor oficial para esse caso e nao posso escolher entre eles. "
    "A Administracao do Cemiterio Santana confirma qual se aplica."
)
SEM_PRECO = (
    "Sobre valores eu nao tenho informacao para passar, e nao posso estimar. "
    "Quem informa isso e a Administracao do Cemiterio Santana."
)

# Chaves das respostas armazenadas, por estado.
CHAVE_POR_ESTADO = {
    PRECISA_DE_CONTEXTO: "PRECO_PRECISA_CONTEXTO",
    CONFLITO: "PRECO_EM_CONFLITO",
    NAO_DISPONIVEL: "SEM_PRECO",
}


def respostas_transientes(status: str) -> list[str]:
    """Templates que a tool de preco anexa ao resultado.

    So o estado AVAILABLE produz template, e so ele menciona valor. Nos demais a
    lista e vazia: a resposta certa ja esta armazenada e nao precisa de campo.
    """
    return [PRECO_DISPONIVEL] if status == DISPONIVEL else []
