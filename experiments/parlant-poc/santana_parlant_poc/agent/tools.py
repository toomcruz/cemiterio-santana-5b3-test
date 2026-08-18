"""Tools do Parlant: a unica ponte entre o LLM e a autoridade deterministica.

Contrato desta versao — o LLM nao escolhe assunto, nao escolhe nome de fato e
nao decide nada que ja esteja determinado:

* **Consulta.** Uma tool por ponto do atendimento, sem argumento nenhum. Quando
  a Guideline `G_PRECO` casa, o assunto ja e PRECO — pedir ao modelo que repita
  isso num argumento `assunto` era exigir uma decisao que a Guideline ja tinha
  tomado, e era ai que ele respondia `<<__missing__>>`. O binding do tipo de
  informacao e codigo, nao prompt.

* **Registro de fato.** Uma tool por fato, **gerada a partir do catalogo**
  (`facts.v1.json`): o nome do fato vira o nome da tool, e o unico argumento e o
  valor — enum fechado quando o catalogo define dominio, texto livre quando o
  proprio municipe e a fonte. O modelo nunca nomeia o fato.

* **Correcao.** Nao existe tool separada: se o fato ja tem valor confirmado
  diferente, a origem vira `USER_CORRECTION` deterministicamente. Decidir isso
  no codigo tira mais uma escolha do modelo.

Nenhuma tool fala com o dominio direto: tudo passa pelo Santana Authority
Gateway, que valida de novo e carimba `release_id` e `source_id`.
"""

# Sem `from __future__ import annotations`: o `@p.tool` monta o schema com
# `inspect.signature`, que nao resolve anotacao adiada. Com o import, o
# `context: ToolContext` chegaria como a string "ToolContext" e o decorador
# recusaria a tool.
import enum
import inspect
from typing import Annotated, Any, Callable

import parlant.sdk as p
from parlant.core.tools import ToolParameterOptions

from ..domain import authority, catalog, knowledge
from ..gateway import GATEWAY
from ..store import STORE
from . import canned


def _emit(context: p.ToolContext, tool: str, args: dict[str, Any], result: dict[str, Any]) -> None:
    STORE.record_tool_call(context.session_id, tool, args, result)


def _bruto(valor: Any) -> str:
    """Aceita o membro do enum ou a string equivalente."""
    return str(getattr(valor, "value", valor))


def _montar(
    nome: str,
    doc: str,
    implementacao: Callable[..., Any],
    parametro: tuple[str, Any] | None = None,
) -> Any:
    """Aplica o decorador REAL do Parlant sobre uma funcao construida.

    O `@p.tool` monta o schema com `inspect.signature`, entao basta declarar a
    assinatura de verdade: nada aqui reimplementa introspeccao do Parlant.
    """
    parametros = [
        inspect.Parameter("context", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=p.ToolContext)
    ]
    if parametro is not None:
        nome_param, anotacao = parametro
        parametros.append(
            inspect.Parameter(nome_param, inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=anotacao)
        )
    implementacao.__name__ = nome
    implementacao.__qualname__ = nome
    implementacao.__doc__ = doc
    implementacao.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        parametros, return_annotation=p.ToolResult
    )
    return p.tool(implementacao)


# ============================================================ consulta (0 args)
# O tipo de informacao e ligado por codigo. O modelo nao escolhe.

CONSULTAS: tuple[tuple[str, str, str], ...] = (
    (
        "consultar_preco_exumacao",
        "PRECO",
        "Consulta o valor aplicavel da exumacao na base oficial do Cemiterio Santana.\n\n"
        "Use sempre que o municipe perguntar preco, valor, taxa, custo ou quiser uma "
        "estimativa. Nunca cite um valor por conta propria, nem aproximado, nem de "
        "exemplo: responda apenas o que esta tool devolver.",
    ),
    (
        "consultar_documentos_exumacao",
        "DOCUMENTOS",
        "Consulta os documentos exigidos para a exumacao na base oficial.\n\n"
        "Use quando o municipe perguntar quais documentos, papeis ou certidoes precisa. "
        "Nunca liste documentos por conta propria.",
    ),
    (
        "consultar_prazo_exumacao",
        "PRAZO",
        "Consulta o prazo aplicavel da exumacao na base oficial.\n\n"
        "Use quando o municipe perguntar prazo, data, demora ou tempo de execucao. "
        "Nunca estime tempo.",
    ),
    (
        "consultar_procedimento_exumacao",
        "PROCEDIMENTO_ADMINISTRATIVO",
        "Consulta o procedimento administrativo da exumacao na base oficial.\n\n"
        "Use quando o municipe perguntar como e o processo ou o que a regra exige. "
        "Nunca descreva procedimento por conta propria.",
    ),
    (
        "consultar_quem_assina_exumacao",
        "ASSINATURA_EXUMACAO",
        "Consulta quem assina a autorizacao de exumacao neste caso.\n\n"
        "A resposta depende da situacao do conjuge sobrevivente ja registrada no caso: "
        "essa selecao e feita pela base, nao por voce.",
    ),
    (
        "consultar_jazigo_de_destino",
        "JAZIGO_DESTINO",
        "Consulta as regras do jazigo de destino (verificacao da situacao e autorizacao "
        "para colocacao dos restos).\n\nUse quando o destino for jazigo da familia.",
    ),
    (
        "consultar_ossuario",
        "OSSUARIO",
        "Consulta o que a base oficial diz sobre o ossuario como destino dos restos.",
    ),
    (
        "consultar_restos_ja_exumados",
        "RESTOS_JA_EXUMADOS",
        "Consulta o efeito de os restos ja terem sido exumados sobre este atendimento.",
    ),
    (
        "consultar_transporte_exumacao",
        "TRANSPORTE",
        "Consulta as regras de transporte dos restos apos a exumacao.",
    ),
    (
        "consultar_regularidade_do_jazigo",
        "REGULARIDADE_DO_JAZIGO",
        "Consulta o que a base oficial diz sobre regularidade e recadastro do jazigo.",
    ),
)


def _consulta(nome_da_tool: str, tipo_informacao: str):
    async def implementacao(context: Any) -> Any:
        case = STORE.case(context.session_id)
        resposta = GATEWAY.consultar_para_o_caso(case, tipo_informacao)
        dados = resposta.as_dict()
        # O rastro usa o nome real da tool: e por ele que o runner sintetico
        # confere o conjunto de tools permitidas.
        _emit(context, nome_da_tool, {}, dados)
        return p.ToolResult(
            data=dados,
            # A resposta que menciona valor nasce aqui, junto com o campo, e so
            # quando o Gateway devolveu AVAILABLE. Guardada na base do agente,
            # ela seria pre-renderizada antes de qualquer tool rodar e falharia
            # por campo ausente.
            canned_responses=canned.respostas_transientes(resposta.status),
            canned_response_fields=resposta.campos_para_canned(),
            metadata={"release_id": resposta.release_id, "source_id": resposta.source_id},
        )

    return implementacao


TOOLS_DE_CONSULTA = tuple(
    _montar(nome, doc, _consulta(nome, tipo)) for nome, tipo, doc in CONSULTAS
)


# ====================================================== registro de fato (1 arg)
# Nome da tool e dominio do argumento saem do catalogo. Nada de lista escrita a
# mao: um fato novo em `facts.v1.json` vira tool sozinho.

NOMES_DE_FATO: dict[str, tuple[str, str]] = {
    "exhumation_purpose": ("finalidade_exumacao", "finalidade"),
    "remains_status": ("situacao_dos_restos", "situacao"),
    "burial_reference": ("identificacao_do_sepultamento", "identificacao"),
    "surviving_spouse_status": ("situacao_do_conjuge", "situacao"),
    "transport_destination": ("destino_do_transporte", "destino"),
    "destination_grave_reference": ("jazigo_de_destino", "jazigo"),
    "requester_document": ("documento_do_solicitante", "documento"),
}

EXEMPLOS_DE_TEXTO_LIVRE: dict[str, list[str]] = {
    "burial_reference": ["Maria Souza, quadra 4, jazigo 18"],
    "destination_grave_reference": ["jazigo 212 da familia Souza"],
    "requester_document": ["CPF 123.456.789-00"],
}


def _nome_e_parametro(code: str) -> tuple[str, str]:
    return NOMES_DE_FATO.get(code, (code, "valor"))


def _registro(code: str):
    async def implementacao(context: Any, **kwargs: Any) -> Any:
        slug, parametro = _nome_e_parametro(code)
        if parametro not in kwargs:
            # A assinatura declarada diz que o argumento e obrigatorio; o corpo
            # aceita `**kwargs` so porque e gerado. Falha fechada, com o mesmo
            # erro que uma funcao declarada daria.
            raise TypeError(f"{code}: argumento obrigatorio '{parametro}' ausente")
        valor = _bruto(kwargs[parametro])
        case = STORE.case(context.session_id)

        # Correcao e deterministica: se ja ha valor confirmado diferente, isto e
        # uma correcao. O modelo nao decide isso.
        anterior = case.confirmed_value(code)
        origem = "USER_CORRECTION" if anterior is not None and anterior != valor else "USER_EXPLICIT"

        resultado = GATEWAY.registrar_fato(case, code, valor, source=origem)
        dados = {**resultado, "case": GATEWAY.estado_do_caso(case)}
        _emit(context, f"registrar_{slug}", {parametro: valor, "origem": origem}, resultado)
        return p.ToolResult(data=dados, metadata={"release_id": GATEWAY.release_id})

    return implementacao


def _anotacao_do_fato(code: str, spec: catalog.FactSpec, parametro: str) -> Any:
    pergunta = catalog.questions_by_fact().get(code, "")
    if spec.is_enum:
        tipo_enum = enum.Enum(  # type: ignore[misc]
            f"Valor_{code}", {valor: valor for valor in spec.allowed_values}, type=str
        )
        opcoes = ToolParameterOptions(
            description=(
                f"{spec.display_name}, exatamente como o catalogo do Cemiterio Santana define. "
                + (f"Pergunta correspondente: '{pergunta}'. " if pergunta else "")
                + "Use somente o que o municipe declarou de forma inequivoca; se ele nao disse, "
                "NAO chame esta tool: pergunte antes."
            ),
            significance=(
                "E o dado que entra no caso. Um valor fora do catalogo e recusado pela regra "
                "deterministica, e um valor adivinhado corromperia o atendimento."
            ),
            examples=list(spec.allowed_values[:3]),
            source="customer",
        )
        return Annotated[tipo_enum, opcoes]

    opcoes = ToolParameterOptions(
        description=(
            f"{spec.display_name}, nas palavras do proprio municipe. "
            + (f"Pergunta correspondente: '{pergunta}'. " if pergunta else "")
            + "Nao resuma em categoria e nao complete o que ele nao disse."
        ),
        significance="E o dado que entra no caso e que a Administracao vai ler.",
        examples=EXEMPLOS_DE_TEXTO_LIVRE.get(code, []),
        source="customer",
    )
    return Annotated[str, opcoes]


def _tool_de_fato(code: str) -> Any:
    spec = catalog.fact_specs()[code]
    slug, parametro = _nome_e_parametro(code)
    pergunta = catalog.questions_by_fact().get(code, "")
    doc = (
        f"Registra no caso: {spec.display_name}.\n\n"
        "Use assim que o municipe informar este dado de forma clara. O valor e validado "
        "contra o catalogo oficial; fora do dominio, a chamada e recusada e voce deve "
        "perguntar de novo."
        + (f"\n\nPergunta correspondente: {pergunta}" if pergunta else "")
    )
    return _montar(
        f"registrar_{slug}",
        doc,
        _registro(code),
        parametro=(parametro, _anotacao_do_fato(code, spec, parametro)),
    )


# Os tres fatos `authoritative_only` ficam FORA: nao existe tool que os nomeie.
FATOS_GRAVAVEIS = authority.user_writable_facts()
TOOLS_DE_FATO = tuple(_tool_de_fato(code) for code in FATOS_GRAVAVEIS)


# ================================================================ estado e escopo
@p.tool
async def consultar_estado_do_caso(context: p.ToolContext) -> p.ToolResult:
    """Le o estado deterministico do caso: fatos confirmados, o que falta,
    pendencias com a Administracao e a proxima melhor pergunta.

    Use antes de decidir o que perguntar. A proxima pergunta vem daqui, nao da sua
    escolha livre.
    """
    case = STORE.case(context.session_id)
    snapshot = GATEWAY.estado_do_caso(case)
    _emit(context, "consultar_estado_do_caso", {}, snapshot)
    return p.ToolResult(data=snapshot, metadata={"release_id": GATEWAY.release_id})


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
        "release_id": GATEWAY.release_id,
        "orientacao": (
            "Esta POC atende apenas Exumacao. Informe que o outro assunto sera tratado pela "
            "Administracao e retome o pedido de exumacao."
        ),
    }
    _emit(context, "registrar_assunto_fora_de_escopo", {"descricao": descricao}, data)
    return p.ToolResult(data=data)


ALL_TOOLS = (
    *TOOLS_DE_CONSULTA,
    *TOOLS_DE_FATO,
    consultar_estado_do_caso,
    registrar_assunto_fora_de_escopo,
)

TOOL_NAMES = tuple(t.tool.name for t in ALL_TOOLS)

# Mapas usados por spec.py e pelos testes (nada de nome escrito duas vezes).
TOOL_POR_TIPO_DE_INFORMACAO = {tipo: nome for nome, tipo, _ in CONSULTAS}
TOOL_POR_FATO = {code: f"registrar_{_nome_e_parametro(code)[0]}" for code in FATOS_GRAVAVEIS}
PARAMETRO_POR_FATO = {code: _nome_e_parametro(code)[1] for code in FATOS_GRAVAVEIS}


def domain_reference() -> dict[str, Any]:
    """Resumo do dominio exposto ao agente (glossario/descricao), sem regras novas."""
    return {
        "facts": authority.describe_facts(),
        "enums": {k: list(v) for k, v in authority.enum_domain().items()},
        "authoritative_facts": list(authority.authoritative_facts()),
        "restricted_topics": list(knowledge.restricted_topics()),
        "release_id": GATEWAY.release_id,
    }
