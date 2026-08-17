"""Tools do Parlant: a unica ponte entre o LLM e a autoridade deterministica.

O modelo nao escreve fatos, nao decide procedimento e nao responde preco,
documento ou prazo por conta propria: ele so chama estas funcoes, que validam
tudo contra `santana-conversation-domain/`.
"""

import enum
from typing import Annotated, Any

import parlant.sdk as p
from parlant.core.tools import ToolParameterOptions

from ..domain import authority, knowledge
from ..store import STORE


def _emit(context: p.ToolContext, tool: str, args: dict[str, Any], result: dict[str, Any]) -> None:
    STORE.record_tool_call(context.session_id, tool, args, result)


def _valor_bruto(valor: Any) -> str:
    """Aceita o membro do enum ou a string equivalente."""
    return str(getattr(valor, "value", valor))


# --------------------------------------------------------------------- dominio
# Os parametros abaixo NAO criam dominio novo: sao os mesmos codigos que ja
# existem em `santana-conversation-domain/` e em `domain/knowledge.py`.
#
# Por que isso precisa estar no tipo, e nao so na docstring: o Parlant monta o
# schema da tool a partir da anotacao (`plugins._describe_parameters`). Um
# parametro anotado como `str` chega ao modelo como `{"type": "string"}`, sem
# descricao e sem valores possiveis — e o ToolCaller instrui o modelo a
# responder `<<__missing__>>` quando nao consegue inferir o argumento. Foi
# exatamente isso que aconteceu: o modelo nao tinha como adivinhar que `assunto`
# queria dizer `PRECO` nem que `fato` queria dizer `exhumation_purpose`.


class AssuntoAutoritativo(str, enum.Enum):
    """Pontos que a base fechada do Cemiterio Santana reconhece.

    Os quatro primeiros sao os `restricted_topics` (nunca publicados: a resposta
    e sempre NAO_DISPONIVEL); os demais tem texto publicado na base.
    """

    PRECO = "PRECO"
    DOCUMENTOS = "DOCUMENTOS"
    PRAZO = "PRAZO"
    PROCEDIMENTO_ADMINISTRATIVO = "PROCEDIMENTO_ADMINISTRATIVO"
    ASSINATURA_EXUMACAO = "ASSINATURA_EXUMACAO"
    JAZIGO_DESTINO = "JAZIGO_DESTINO"
    OSSUARIO = "OSSUARIO"
    RESTOS_JA_EXUMADOS = "RESTOS_JA_EXUMADOS"


class FatoDoMunicipe(str, enum.Enum):
    """Fatos que o municipe pode declarar.

    Contem apenas `authority.user_writable_facts()`. Os tres fatos
    `authoritative_only` (`exhumation_authorization`,
    `destination_grave_situation`, `destination_grave_authorization`) ficam de
    fora de proposito: assim o modelo nao tem sequer como nomea-los numa chamada
    de registro. A validacao em `submit_fact` continua no lugar — isto e uma
    segunda barreira, nao a substituicao da primeira.
    """

    exhumation_purpose = "exhumation_purpose"
    remains_status = "remains_status"
    burial_reference = "burial_reference"
    surviving_spouse_status = "surviving_spouse_status"
    transport_destination = "transport_destination"
    destination_grave_reference = "destination_grave_reference"
    requester_document = "requester_document"


def _dominio_por_fato() -> str:
    """Valores aceitos por fato, lidos do catalogo (nao ha lista escrita a mao)."""
    dominio = authority.enum_domain()
    linhas = [
        f"{codigo}: {', '.join(dominio[codigo])}"
        for codigo in FatoDoMunicipe.__members__
        if codigo in dominio
    ]
    livres = [c for c in FatoDoMunicipe.__members__ if c not in dominio]
    if livres:
        linhas.append(f"texto livre (o que o municipe disse): {', '.join(livres)}")
    return "; ".join(linhas)


VALOR_DO_FATO = ToolParameterOptions(
    description=(
        "Valor do fato, exatamente como o catalogo do Cemiterio Santana define. "
        f"Valores aceitos por fato — {_dominio_por_fato()}. "
        "Use somente o que o municipe declarou de forma inequivoca; se ele nao "
        "disse, NAO chame esta tool: pergunte antes."
    ),
    significance=(
        "E o dado que entra no caso. Um valor fora do catalogo e recusado pela "
        "regra deterministica, e um valor adivinhado corromperia o atendimento."
    ),
    examples=["TRANSPORTE", "SEPULTADO", "OUTRO_CEMITERIO", "VIVO"],
    source="customer",
)


@p.tool
async def registrar_fato(
    context: p.ToolContext,
    fato: FatoDoMunicipe,
    valor: Annotated[str, VALOR_DO_FATO],
) -> p.ToolResult:
    """Registra um fato declarado pelo municipe sobre o pedido de exumacao.

    Use sempre que a pessoa informar algo concreto (finalidade, situacao dos restos,
    identificacao do sepultamento, situacao do conjuge, destino, documento).
    O valor e validado contra o catalogo oficial: se estiver fora do dominio, a
    chamada e recusada e voce deve perguntar de novo.
    """
    codigo = _valor_bruto(fato)
    case = STORE.case(context.session_id)
    submission = case.submit_fact(codigo, valor, source="USER_EXPLICIT")
    data = {**submission.as_dict(), "case": case.snapshot()}
    _emit(context, "registrar_fato", {"fato": codigo, "valor": valor}, submission.as_dict())
    return p.ToolResult(data=data)


@p.tool
async def corrigir_fato(
    context: p.ToolContext,
    fato: FatoDoMunicipe,
    novo_valor: Annotated[str, VALOR_DO_FATO],
) -> p.ToolResult:
    """Corrige um fato ja informado, quando o municipe se corrige.

    O valor anterior e superseded e as regras derivadas sao recalculadas.
    """
    codigo = _valor_bruto(fato)
    case = STORE.case(context.session_id)
    submission = case.submit_fact(codigo, novo_valor, source="USER_CORRECTION")
    data = {**submission.as_dict(), "case": case.snapshot()}
    _emit(
        context,
        "corrigir_fato",
        {"fato": codigo, "novo_valor": novo_valor},
        submission.as_dict(),
    )
    return p.ToolResult(data=data)


@p.tool
async def consultar_estado_do_caso(context: p.ToolContext) -> p.ToolResult:
    """Le o estado deterministico do caso: fatos confirmados, o que falta,
    pendencias com a Administracao e a proxima melhor pergunta.

    Use antes de decidir o que perguntar. A proxima pergunta vem daqui, nao da sua
    escolha livre.
    """
    case = STORE.case(context.session_id)
    snapshot = case.snapshot()
    _emit(context, "consultar_estado_do_caso", {}, snapshot)
    return p.ToolResult(data=snapshot)


@p.tool
async def consultar_base_autoritativa(
    context: p.ToolContext,
    assunto: AssuntoAutoritativo,
) -> p.ToolResult:
    """Consulta a base fechada do Cemiterio Santana sobre um ponto do atendimento.

    Obrigatoria para qualquer pergunta sobre preco, documentos, prazo, procedimento,
    quem assina a autorizacao, jazigo de destino ou ossuario. Se a resposta vier como
    NAO_DISPONIVEL, diga exatamente isso: nao complete a informacao.
    """
    topico = _valor_bruto(assunto)
    answer = knowledge.lookup(topico).as_dict()
    _emit(context, "consultar_base_autoritativa", {"assunto": topico}, answer)
    return p.ToolResult(data=answer)


@p.tool
async def registrar_assunto_fora_de_escopo(
    context: p.ToolContext,
    descricao: Annotated[
        str,
        ToolParameterOptions(
            description=(
                "O outro assunto, nas palavras do proprio municipe (por exemplo: "
                "'recadastrar o jazigo', 'comprar lapide', 'horario de atendimento'). "
                "Nao resuma em categoria: registre o que ele pediu."
            ),
            significance="E o que a Administracao vai ler para tratar o assunto fora de escopo.",
            examples=["recadastrar o jazigo", "comprar uma lapide"],
            source="customer",
        ),
    ],
) -> p.ToolResult:
    """Registra que o municipe trouxe um assunto fora de Exumacao (esta POC so
    atende Exumacao). Nao tente resolver o outro assunto."""
    case = STORE.case(context.session_id)
    case.note_off_topic(descricao)
    data = {
        "registrado": True,
        "assunto": descricao,
        "orientacao": (
            "Esta POC atende apenas Exumacao. Informe que o outro assunto sera tratado pela "
            "Administracao e retome o pedido de exumacao."
        ),
    }
    _emit(context, "registrar_assunto_fora_de_escopo", {"descricao": descricao}, data)
    return p.ToolResult(data=data)


ALL_TOOLS = (
    registrar_fato,
    corrigir_fato,
    consultar_estado_do_caso,
    consultar_base_autoritativa,
    registrar_assunto_fora_de_escopo,
)

TOOL_NAMES = tuple(t.tool.name for t in ALL_TOOLS)


def domain_reference() -> dict[str, Any]:
    """Resumo do dominio exposto ao agente (glossario/descricao), sem regras novas."""
    return {
        "facts": authority.describe_facts(),
        "enums": {k: list(v) for k, v in authority.enum_domain().items()},
        "authoritative_facts": list(authority.authoritative_facts()),
        "restricted_topics": list(knowledge.restricted_topics()),
    }
