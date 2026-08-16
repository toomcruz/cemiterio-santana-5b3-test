"""Tools do Parlant: a unica ponte entre o LLM e a autoridade deterministica.

O modelo nao escreve fatos, nao decide procedimento e nao responde preco,
documento ou prazo por conta propria: ele so chama estas funcoes, que validam
tudo contra `santana-conversation-domain/`.
"""

from typing import Any

import parlant.sdk as p

from ..domain import authority, knowledge
from ..store import STORE


def _emit(context: p.ToolContext, tool: str, args: dict[str, Any], result: dict[str, Any]) -> None:
    STORE.record_tool_call(context.session_id, tool, args, result)


@p.tool
async def registrar_fato(context: p.ToolContext, fato: str, valor: str) -> p.ToolResult:
    """Registra um fato declarado pelo municipe sobre o pedido de exumacao.

    Use sempre que a pessoa informar algo concreto (finalidade, situacao dos restos,
    identificacao do sepultamento, situacao do conjuge, destino, documento).
    O valor e validado contra o catalogo oficial: se estiver fora do dominio, a
    chamada e recusada e voce deve perguntar de novo.
    """
    case = STORE.case(context.session_id)
    submission = case.submit_fact(fato, valor, source="USER_EXPLICIT")
    data = {**submission.as_dict(), "case": case.snapshot()}
    _emit(context, "registrar_fato", {"fato": fato, "valor": valor}, submission.as_dict())
    return p.ToolResult(data=data)


@p.tool
async def corrigir_fato(context: p.ToolContext, fato: str, novo_valor: str) -> p.ToolResult:
    """Corrige um fato ja informado, quando o municipe se corrige.

    O valor anterior e superseded e as regras derivadas sao recalculadas.
    """
    case = STORE.case(context.session_id)
    submission = case.submit_fact(fato, novo_valor, source="USER_CORRECTION")
    data = {**submission.as_dict(), "case": case.snapshot()}
    _emit(context, "corrigir_fato", {"fato": fato, "novo_valor": novo_valor}, submission.as_dict())
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
async def consultar_base_autoritativa(context: p.ToolContext, assunto: str) -> p.ToolResult:
    """Consulta a base fechada do Cemiterio Santana sobre um ponto do atendimento.

    Obrigatoria para qualquer pergunta sobre preco, documentos, prazo, procedimento,
    quem assina a autorizacao, jazigo de destino ou ossuario. Se a resposta vier como
    NAO_DISPONIVEL, diga exatamente isso: nao complete a informacao.
    """
    answer = knowledge.lookup(assunto).as_dict()
    _emit(context, "consultar_base_autoritativa", {"assunto": assunto}, answer)
    return p.ToolResult(data=answer)


@p.tool
async def registrar_assunto_fora_de_escopo(context: p.ToolContext, descricao: str) -> p.ToolResult:
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
