"""Integracao: o contrato que o Parlant REAL entrega ao ToolCaller.

Nada aqui passa por helper da POC. Os descritores vem de
`plugins._describe_parameters` (o introspector do proprio Parlant, invocado pelo
decorador `@p.tool`); o texto vem de `SingleToolBatch._add_tool_definitions_section`
e do bloco `TOOL TO EVALUATE`; e a decisao de aceitar ou recusar uma chamada vem
de `SingleToolBatch._evaluate_non_consequential_tool_calls`.

A prova central do redesenho esta na secao 3: uma tool de consulta sem
argumento produz chamada valida com `args={}` pelo caminho real do Parlant.
Nao existe argumento para faltar, entao `<<__missing__>>` deixou de ser um
resultado possivel — nao por instrucao melhor no prompt, por contrato.
"""

import json
from typing import Annotated, Any

import pytest

from santana_parlant_poc.agent import tools as T
from santana_parlant_poc.domain import authority, catalog

CONSULTAS_SEM_ARGUMENTO = [nome for nome, _t, _d in T.CONSULTAS]
FATOS_ENUM = [c for c in authority.user_writable_facts() if catalog.fact_specs()[c].is_enum]
FATOS_TEXTO = [c for c in authority.user_writable_facts() if not catalog.fact_specs()[c].is_enum]


def _tool(nome: str) -> Any:
    return next(t.tool for t in T.ALL_TOOLS if t.tool.name == nome)


# ------------------------------- 1. introspector real (plugins._describe_parameters)
@pytest.mark.parametrize("code", FATOS_ENUM)
def test_introspector_do_parlant_produz_o_enum_do_catalogo(code):
    descritor, _opcoes = _tool(T.TOOL_POR_FATO[code]).parameters[T.PARAMETRO_POR_FATO[code]]
    assert descritor != {"type": "string"}, (
        f"{code} voltou a ser string opaca: o ToolCaller responderia <<__missing__>> "
        "por nao ter como inferir o argumento"
    )
    assert descritor["enum"] == list(catalog.fact_specs()[code].allowed_values)


@pytest.mark.parametrize("code", FATOS_TEXTO)
def test_introspector_do_parlant_produz_a_descricao(code):
    descritor, _opcoes = _tool(T.TOOL_POR_FATO[code]).parameters[T.PARAMETRO_POR_FATO[code]]
    assert descritor.get("description")


def test_o_introspector_e_o_do_parlant_e_nao_um_helper_da_poc():
    """As tools sao geradas; o descritor tem que sair do Parlant mesmo assim.

    `_describe_parameters` e funcao aninhada no decorador, entao a forma de
    exercita-la e aplicar o decorador real sobre uma sonda com a mesma anotacao
    que o gerador monta — e conferir que o resultado bate.
    """
    import parlant.sdk as p
    from parlant.core.services.tools.plugins import tool as decorador_do_parlant

    code = "exhumation_purpose"
    spec = catalog.fact_specs()[code]
    anotacao = T._anotacao_do_fato(code, spec, "finalidade")

    @decorador_do_parlant
    async def sonda(context: p.ToolContext, finalidade: anotacao) -> p.ToolResult:  # type: ignore[valid-type]
        """Sonda do teste: existe so para observar o introspector do Parlant."""
        return p.ToolResult(data={})

    descritor_da_sonda = dict(sonda.tool.parameters["finalidade"][0])
    descritor_gerado = dict(_tool(T.TOOL_POR_FATO[code]).parameters["finalidade"][0])
    assert descritor_da_sonda == descritor_gerado
    assert descritor_da_sonda["enum"] == list(spec.allowed_values)


def test_tool_gerada_e_um_tool_do_parlant_de_verdade():
    """A geracao nao pode produzir um objeto parecido: tem que ser o mesmo tipo."""
    from parlant.core.tools import Tool
    from parlant.core.services.tools.plugins import ToolEntry

    entrada = next(t for t in T.ALL_TOOLS if t.tool.name == "consultar_preco_exumacao")
    assert isinstance(entrada, ToolEntry)
    assert isinstance(entrada.tool, Tool)


# --------------------------- 2. renderizador real do prompt (SingleToolBatch)
def _render_consequencial(nome_tool: str) -> str:
    """Texto do bloco de definicao de tool no caminho consequencial do ToolCaller."""
    from parlant.core.engines.alpha.tool_calling.single_tool_batch import SingleToolBatch
    from parlant.core.tools import ToolId

    tool = _tool(nome_tool)
    tool_id = ToolId(service_name="built-in", tool_name=nome_tool)
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


@pytest.mark.parametrize("code", FATOS_ENUM)
def test_prompt_do_toolcaller_carrega_os_valores_possiveis(code):
    nome_tool = T.TOOL_POR_FATO[code]
    consequencial = _render_consequencial(nome_tool)
    nao_consequencial = _render_nao_consequencial(nome_tool)
    for valor in catalog.fact_specs()[code].allowed_values:
        assert valor in consequencial, f"{valor} ausente no caminho consequencial"
        assert valor in nao_consequencial, f"{valor} ausente no caminho nao consequencial"


@pytest.mark.parametrize("nome_tool", CONSULTAS_SEM_ARGUMENTO)
def test_prompt_de_consulta_nao_apresenta_parametro_ao_modelo(nome_tool):
    """Sem parametro no prompt, nao ha o que o modelo deixar de preencher."""
    assert _render_nao_consequencial(nome_tool) == "{}"
    consequencial = _render_consequencial(nome_tool)
    # Chaves do renderizador consequencial real do Parlant 3.3.2.
    assert '"required_parameters": {}' in consequencial
    assert '"optional_arguments": {}' in consequencial


def test_prompt_nao_reduz_parametro_a_string_opaca():
    """Regressao direta do blocker: `{"type": "string"}` sozinho e o sintoma."""
    for entrada in T.ALL_TOOLS:
        bloco = json.loads(_render_nao_consequencial(entrada.tool.name))
        for parametro, descritor in bloco.items():
            assert descritor != {"type": "string"}, f"{entrada.tool.name}.{parametro}"


# ------------------- 3. avaliacao real do ToolCaller sobre esse contrato
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
        """Instancia minima: a avaliacao real so precisa dos eventos encenados."""

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


@pytest.mark.parametrize("nome_tool", CONSULTAS_SEM_ARGUMENTO)
def test_consulta_sem_argumento_vira_chamada_valida(nome_tool):
    """A prova do redesenho, pelo avaliador real do Parlant.

    Antes, `consultar_base_autoritativa` com `{}` era recusada por
    `Argument 'assunto' is missing`. Sem argumento declarado, `{}` e a chamada
    completa.
    """
    chamadas, faltando = _avaliar_com_o_parlant(nome_tool, {})
    assert len(chamadas) == 1, f"{nome_tool} nao produziu chamada"
    assert chamadas[0].arguments == {}
    assert not faltando


@pytest.mark.parametrize("code", FATOS_ENUM)
def test_registro_com_valor_do_catalogo_vira_chamada_valida(code):
    nome_tool = T.TOOL_POR_FATO[code]
    parametro = T.PARAMETRO_POR_FATO[code]
    valor = catalog.fact_specs()[code].allowed_values[0]
    chamadas, faltando = _avaliar_com_o_parlant(nome_tool, {parametro: valor})
    assert len(chamadas) == 1
    assert chamadas[0].arguments == {parametro: valor}
    assert not faltando


@pytest.mark.parametrize("code", authority.user_writable_facts())
def test_marcador_de_ausencia_continua_recusado_no_registro(code):
    """Onde ainda ha argumento, a regra do Parlant continua valendo integralmente."""
    nome_tool = T.TOOL_POR_FATO[code]
    parametro = T.PARAMETRO_POR_FATO[code]
    chamadas, faltando = _avaliar_com_o_parlant(nome_tool, {parametro: "<<__missing__>>"})
    assert not chamadas, "uma chamada nao pode ser criada com argumento ausente"
    assert any(d.parameter == parametro for d in faltando)


@pytest.mark.parametrize("code", authority.user_writable_facts())
def test_argumento_omitido_tambem_e_recusado(code):
    chamadas, faltando = _avaliar_com_o_parlant(T.TOOL_POR_FATO[code], {})
    assert not chamadas
    assert any(d.parameter == T.PARAMETRO_POR_FATO[code] for d in faltando)


# ----------------------------------- 4. o que o contrato nao pode expor
def test_nenhuma_tool_exposta_permite_escrever_fato_autoritativo():
    """`authoritative_only` nao aparece em nome de tool nem em dominio de enum."""
    autoritativos = set(authority.authoritative_facts())
    for entrada in T.ALL_TOOLS:
        for descritor, _ in entrada.tool.parameters.values():
            assert not (autoritativos & set(descritor.get("enum") or ())), entrada.tool.name
    assert not (autoritativos & set(T.TOOL_POR_FATO))
