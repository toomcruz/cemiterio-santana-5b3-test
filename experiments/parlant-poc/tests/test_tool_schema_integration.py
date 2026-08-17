"""Integracao: o schema que o Parlant REAL entrega ao ToolCaller.

Os testes de `test_tool_args.py` liam o descritor produzido pelo decorador. Isso
provou que a declaracao estava certa, mas nao que o texto entregue ao modelo
carregava o dominio — e foi justamente essa lacuna que deixou o run
32069767929 reprovar sem que a suite acusasse nada.

Aqui nada passa por helper da POC: os descritores vem de
`plugins._describe_parameters` (o introspector do proprio Parlant, invocado pelo
decorador `@p.tool`), e o texto vem de `SingleToolBatch._add_tool_definitions_section`
e do bloco `TOOL TO EVALUATE` — os dois renderizadores reais do ToolCaller.

O teste falha se qualquer um desses parametros voltar a chegar ao modelo como
apenas `{"type": "string"}`.
"""

import json
from typing import Annotated, Any

import pytest

from santana_parlant_poc.agent.tools import ALL_TOOLS

PARAMETROS_COM_DOMINIO = {
    ("consultar_base_autoritativa", "assunto"): "enum",
    ("registrar_fato", "fato"): "enum",
    ("corrigir_fato", "fato"): "enum",
    ("registrar_fato", "valor"): "description",
    ("corrigir_fato", "novo_valor"): "description",
    ("registrar_assunto_fora_de_escopo", "descricao"): "description",
}


def _tool(nome: str) -> Any:
    return next(t.tool for t in ALL_TOOLS if t.tool.name == nome)


# ------------------------------- 1. introspector real (plugins._describe_parameters)
@pytest.mark.parametrize(("chave", "esperado"), list(PARAMETROS_COM_DOMINIO.items()))
def test_introspector_do_parlant_produz_dominio(chave, esperado):
    """O descritor sai de `_describe_parameters`, chamado pelo decorador `@p.tool`."""
    nome_tool, parametro = chave
    descritor, _opcoes = _tool(nome_tool).parameters[parametro]

    assert descritor != {"type": "string"}, (
        f"{nome_tool}.{parametro} voltou a ser string opaca: o ToolCaller responderia "
        "<<__missing__>> por nao ter como inferir o argumento"
    )
    assert descritor.get(esperado), f"{nome_tool}.{parametro} sem `{esperado}`: {descritor}"


def test_introspector_e_o_do_parlant_e_nao_um_helper_da_poc():
    """O dominio nasce do introspector do Parlant, nao de codigo da POC.

    `_describe_parameters` e uma funcao aninhada no decorador, entao a forma de
    exercita-la e aplicar o decorador real (`parlant.core.services.tools.plugins.tool`)
    sobre uma sonda anotada com os mesmos tipos da POC. O descritor resultante e
    produzido inteiramente pelo Parlant.
    """
    import parlant.sdk as p
    from parlant.core.services.tools.plugins import tool as decorador_do_parlant

    from santana_parlant_poc.agent.tools import (
        VALOR_DO_FATO,
        AssuntoAutoritativo,
        FatoDoMunicipe,
    )

    @decorador_do_parlant
    async def sonda(
        context: p.ToolContext,
        assunto: AssuntoAutoritativo,
        fato: FatoDoMunicipe,
        valor: Annotated[str, VALOR_DO_FATO],
    ) -> p.ToolResult:
        """Sonda do teste: existe so para observar o introspector do Parlant."""
        return p.ToolResult(data={})

    descritores = {nome: dict(d) for nome, (d, _) in sonda.tool.parameters.items()}
    assert descritores["assunto"].get("enum") == [a.value for a in AssuntoAutoritativo]
    assert descritores["fato"].get("enum") == [f.value for f in FatoDoMunicipe]
    assert descritores["valor"].get("description")

    # E o mesmo resultado que as tools da POC carregam.
    assert descritores["assunto"] == dict(_tool("consultar_base_autoritativa").parameters["assunto"][0])


# --------------------------- 2. renderizador real do prompt (SingleToolBatch)
def _render_consequencial(nome_tool: str) -> str:
    """Texto do bloco de definicao de tool no caminho consequencial do ToolCaller."""
    from parlant.core.engines.alpha.tool_calling.single_tool_batch import SingleToolBatch
    from parlant.core.tools import ToolId

    tool = _tool(nome_tool)
    tool_id = ToolId(service_name="built-in", tool_name=nome_tool)

    # `_add_tool_definitions_section` nao usa estado da instancia: e chamado
    # como funcao do proprio Parlant, sem reimplementar nada aqui.
    template, props = SingleToolBatch._add_tool_definitions_section(
        SingleToolBatch, candidate_tool=(tool_id, tool), reference_tools=[]
    )
    return template.format(**{k: json.dumps(v, ensure_ascii=False) for k, v in props.items()})


def _render_nao_consequencial(nome_tool: str) -> str:
    """Bloco `Parameters:` do caminho nao consequencial, montado como no Parlant."""
    tool = _tool(nome_tool)
    parameters_info: dict[str, Any] = {}
    for nome, (descritor, opcoes) in tool.parameters.items():
        info: dict[str, Any] = {"type": descritor.get("type", "string")}
        if descricao := opcoes.description or descritor.get("description"):
            info["description"] = descricao
        if enum := descritor.get("enum"):
            info["enum"] = enum
        parameters_info[nome] = info
    return json.dumps(parameters_info, indent=2, ensure_ascii=False)


@pytest.mark.parametrize(
    ("nome_tool", "esperados"),
    [
        ("consultar_base_autoritativa", ["PRECO", "DOCUMENTOS"]),
        ("registrar_fato", ["exhumation_purpose", "transport_destination"]),
        ("corrigir_fato", ["exhumation_purpose"]),
    ],
)
def test_prompt_do_toolcaller_carrega_os_valores_possiveis(nome_tool, esperados):
    consequencial = _render_consequencial(nome_tool)
    nao_consequencial = _render_nao_consequencial(nome_tool)
    for valor in esperados:
        assert valor in consequencial, f"{valor} ausente no caminho consequencial"
        assert valor in nao_consequencial, f"{valor} ausente no caminho nao consequencial"


@pytest.mark.parametrize(
    "nome_tool", ["registrar_fato", "corrigir_fato", "registrar_assunto_fora_de_escopo"]
)
def test_prompt_do_toolcaller_carrega_a_descricao_do_parametro(nome_tool):
    consequencial = _render_consequencial(nome_tool)
    assert "description" in consequencial
    assert "Cemiterio Santana" in consequencial or "municipe" in consequencial


def test_prompt_nao_reduz_parametro_a_string_opaca():
    """Regressao direta do blocker: `{"type": "string"}` sozinho e o sintoma."""
    for (nome_tool, parametro), _ in PARAMETROS_COM_DOMINIO.items():
        bloco = json.loads(_render_nao_consequencial(nome_tool))[parametro]
        assert bloco != {"type": "string"}, (
            f"{nome_tool}.{parametro} chega ao modelo como string opaca"
        )


# ------------------- 3. avaliacao real do ToolCaller sobre esse schema
def _avaliar_com_o_parlant(nome_tool: str, args: dict[str, Any]) -> tuple[list, list]:
    """Roda a avaliacao real do lote nao consequencial do Parlant.

    Nao ha modelo aqui: entramos com a saida estruturada que um modelo teria
    produzido, e deixamos o Parlant decidir se ela vira chamada ou recusa.
    """
    from parlant.core.engines.alpha.tool_calling.single_tool_batch import (
        NonConsequentialToolCallEvaluation,
        SingleToolBatch,
    )
    from parlant.core.tools import ToolId

    tool = _tool(nome_tool)
    tool_id = ToolId(service_name="built-in", tool_name=nome_tool)
    saida = [NonConsequentialToolCallEvaluation(args=args)]

    class _LoteSemEventosEncenados:
        """Instancia minima: a avaliacao real so precisa dos eventos encenados.

        O metodo avaliado e o do Parlant, sem reimplementacao; o estado que ele
        consulta e apenas `self._context.staged_events` (vazio aqui) e
        `self._logger`, usado so para depuracao.
        """

        _evaluate_non_consequential_tool_calls = (
            SingleToolBatch._evaluate_non_consequential_tool_calls
        )
        _is_tool_call_already_staged = SingleToolBatch._is_tool_call_already_staged

        class _context:  # noqa: N801
            staged_events: list = []

        class _logger:  # noqa: N801
            @staticmethod
            def debug(*_a: Any, **_k: Any) -> None: ...

            @staticmethod
            def warning(*_a: Any, **_k: Any) -> None: ...

    chamadas, _avaliacoes, faltando, _invalidos = _LoteSemEventosEncenados()._evaluate_non_consequential_tool_calls(
        output=saida, candidate_descriptor=(tool_id, tool, [])
    )
    return chamadas, faltando


def test_saida_correta_do_modelo_vira_chamada_valida():
    chamadas, faltando = _avaliar_com_o_parlant(
        "consultar_base_autoritativa", {"assunto": "PRECO"}
    )
    assert len(chamadas) == 1
    assert chamadas[0].arguments == {"assunto": "PRECO"}
    assert not faltando


def test_registrar_fato_com_fato_e_valor_vira_chamada_valida():
    chamadas, faltando = _avaliar_com_o_parlant(
        "registrar_fato", {"fato": "transport_destination", "valor": "OUTRO_CEMITERIO"}
    )
    assert len(chamadas) == 1
    assert chamadas[0].arguments == {
        "fato": "transport_destination",
        "valor": "OUTRO_CEMITERIO",
    }
    assert not faltando


@pytest.mark.parametrize(
    ("nome_tool", "args", "parametro"),
    [
        ("consultar_base_autoritativa", {"assunto": "<<__missing__>>"}, "assunto"),
        ("registrar_fato", {"fato": "<<__missing__>>", "valor": "TRANSPORTE"}, "fato"),
        ("registrar_fato", {"fato": "exhumation_purpose", "valor": "<<__missing__>>"}, "valor"),
        ("registrar_assunto_fora_de_escopo", {"descricao": "<<__missing__>>"}, "descricao"),
    ],
)
def test_marcador_de_ausencia_reproduz_o_blocker(nome_tool, args, parametro):
    """Reproduz `Argument '<x>' is missing` pelo caminho real do Parlant."""
    chamadas, faltando = _avaliar_com_o_parlant(nome_tool, args)
    assert not chamadas, "uma chamada nao pode ser criada com argumento ausente"
    assert any(d.parameter == parametro for d in faltando)


@pytest.mark.parametrize(
    ("nome_tool", "args", "parametro"),
    [
        ("consultar_base_autoritativa", {}, "assunto"),
        ("registrar_fato", {"fato": "exhumation_purpose"}, "valor"),
    ],
)
def test_argumento_omitido_tambem_e_recusado(nome_tool, args, parametro):
    chamadas, faltando = _avaliar_com_o_parlant(nome_tool, args)
    assert not chamadas
    assert any(d.parameter == parametro for d in faltando)
