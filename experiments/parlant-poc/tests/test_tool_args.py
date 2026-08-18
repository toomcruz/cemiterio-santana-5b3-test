"""Contrato das Tools apos o redesenho (offline, sem Gemini).

O blocker do run 32069767929 foi `<<__missing__>>` em quatro argumentos
obrigatorios. A investigacao provou que o schema chegava intacto ao ToolCaller —
enum, descricao e tudo. O que sobrou foi a pergunta certa: por que pedir ao
modelo um argumento que a Guideline ja determinou?

O contrato desta versao remove a pergunta. `G_PRECO` casou, entao o assunto e
PRECO: `consultar_preco_exumacao()` nao tem argumento nenhum. E o nome do fato
deixou de ser argumento — virou o nome da tool.

Estes testes travam esse contrato e provam que a autoridade nao afrouxou junto.
"""

import asyncio
import json
from typing import Any

import pytest

from santana_parlant_poc.agent import tools as T
from santana_parlant_poc.domain import authority, catalog
from santana_parlant_poc.gateway import DISPONIVEL, NAO_DISPONIVEL

VALOR_AUSENTE = "<<__missing__>>"


def _tool(nome: str) -> Any:
    return next(t for t in T.ALL_TOOLS if t.tool.name == nome)


class _Contexto:
    """ToolContext minimo: as tools so usam `session_id`."""

    def __init__(self, sessao: str) -> None:
        self.session_id = sessao
        self.agent_id = "agente-de-teste"
        self.customer_id = "municipe-de-teste"


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


# ============================ 1. consulta nao pede argumento nenhum ao modelo
@pytest.mark.parametrize("nome", [n for n, _t, _d in T.CONSULTAS])
def test_tool_de_consulta_nao_tem_argumento(nome):
    """Se nao ha argumento, nao ha como o modelo responder `<<__missing__>>`."""
    tool = _tool(nome).tool
    assert tool.parameters == {}, f"{nome} voltou a pedir argumento: {tool.parameters}"
    assert list(tool.required) == []


def test_existe_uma_consulta_por_tipo_de_informacao_restrito():
    """Preco, documentos, prazo e procedimento tem tool propria e dedicada."""
    for tipo in ("PRECO", "DOCUMENTOS", "PRAZO", "PROCEDIMENTO_ADMINISTRATIVO"):
        assert tipo in T.TOOL_POR_TIPO_DE_INFORMACAO
        assert _tool(T.TOOL_POR_TIPO_DE_INFORMACAO[tipo])


def test_o_tipo_de_informacao_e_ligado_por_codigo_e_nao_pelo_modelo():
    """A prova pratica: a tool devolve o tipo certo sem ninguem informar nada."""
    resposta = _run(_tool("consultar_preco_exumacao").function(_Contexto("s-bind")))
    assert resposta.data["tipo_informacao"] == "PRECO"
    resposta = _run(_tool("consultar_documentos_exumacao").function(_Contexto("s-bind")))
    assert resposta.data["tipo_informacao"] == "DOCUMENTOS"


# ================================ 2. registro: uma tool por fato, gerada do catalogo
def test_todo_fato_gravavel_tem_tool_propria():
    """Fato novo em `facts.v1.json` precisa aparecer como tool, sem edicao manual."""
    esperadas = {f"registrar_{T._nome_e_parametro(c)[0]}" for c in authority.user_writable_facts()}
    assert esperadas <= set(T.TOOL_NAMES), esperadas - set(T.TOOL_NAMES)


def test_nenhuma_tool_pede_o_nome_do_fato():
    """`fato=<qualquer fato>` era uma decisao do modelo. Deixou de existir."""
    for entrada in T.ALL_TOOLS:
        assert "fato" not in entrada.tool.parameters, entrada.tool.name


@pytest.mark.parametrize("code", authority.user_writable_facts())
def test_tool_de_fato_tem_exatamente_um_argumento_obrigatorio(code):
    tool = _tool(T.TOOL_POR_FATO[code]).tool
    assert len(tool.parameters) == 1, tool.parameters
    assert list(tool.required) == [T.PARAMETRO_POR_FATO[code]]


@pytest.mark.parametrize(
    "code", [c for c in authority.user_writable_facts() if catalog.fact_specs()[c].is_enum]
)
def test_argumento_de_fato_com_dominio_fechado_carrega_o_enum(code):
    tool = _tool(T.TOOL_POR_FATO[code]).tool
    descritor, _ = tool.parameters[T.PARAMETRO_POR_FATO[code]]
    assert descritor.get("enum") == list(catalog.fact_specs()[code].allowed_values)
    assert descritor != {"type": "string"}


@pytest.mark.parametrize(
    "code", [c for c in authority.user_writable_facts() if not catalog.fact_specs()[c].is_enum]
)
def test_argumento_de_texto_livre_carrega_descricao(code):
    """Sem dominio fechado, o parametro precisa ao menos dizer o que e."""
    tool = _tool(T.TOOL_POR_FATO[code]).tool
    descritor, _ = tool.parameters[T.PARAMETRO_POR_FATO[code]]
    assert descritor.get("description")
    assert descritor != {"type": "string"}


# ======================================== 3. authoritative_only nunca e exposto
def test_nenhuma_tool_permite_nomear_fato_autoritativo():
    """Os tres `authoritative_only` nao podem sequer ser nomeados numa chamada."""
    autoritativos = set(authority.authoritative_facts())
    assert autoritativos
    for entrada in T.ALL_TOOLS:
        nome = entrada.tool.name
        assert not any(nome.endswith(codigo) for codigo in autoritativos), nome
        for descritor, _ in entrada.tool.parameters.values():
            assert not (autoritativos & set(descritor.get("enum") or ())), nome


def test_o_gateway_recusa_fato_autoritativo_mesmo_por_caminho_novo():
    """Segunda barreira: chamada fora do schema tambem falha fechada."""
    from santana_parlant_poc.gateway import GATEWAY

    case = authority.ExhumationCase(case_id="c-autoritativo")
    resultado = GATEWAY.registrar_fato(case, "exhumation_authorization", "AUTORIZADO")
    assert resultado["outcome"] == authority.REJECTED
    assert resultado["reason"] == "FATO_AUTORITATIVO_SO_PELA_ADMINISTRACAO"
    assert case.confirmed_value("exhumation_authorization") is None


# ============================================ 4. validacao de valor, falha fechada
def test_valor_fora_do_dominio_e_recusado():
    resposta = _run(
        _tool("registrar_finalidade_exumacao").function(_Contexto("s-dominio"), finalidade="PIX")
    )
    assert resposta.data["outcome"] == authority.REJECTED
    assert resposta.data["reason"] == "VALOR_FORA_DO_DOMINIO"
    assert "TRANSPORTE" in resposta.data["allowed_values"]


def test_marcador_de_ausencia_nao_vira_fato():
    """Se o modelo mandar `<<__missing__>>`, isso e valor invalido, nao dado."""
    resposta = _run(
        _tool("registrar_finalidade_exumacao").function(
            _Contexto("s-missing"), finalidade=VALOR_AUSENTE
        )
    )
    assert resposta.data["outcome"] == authority.REJECTED


def test_valor_valido_entra_no_caso_com_release_id():
    resposta = _run(
        _tool("registrar_destino_do_transporte").function(
            _Contexto("s-ok"), destino="OUTRO_CEMITERIO"
        )
    )
    assert resposta.data["outcome"] == authority.ACCEPTED
    assert resposta.data["value"] == "OUTRO_CEMITERIO"
    assert resposta.data["release_id"].startswith("exu-")


def test_argumento_omitido_falha_e_nao_grava():
    with pytest.raises(TypeError):
        _run(_tool("registrar_finalidade_exumacao").function(_Contexto("s-omitido")))


# ==================================== 5. correcao e deterministica, nao do modelo
def test_segundo_valor_diferente_e_tratado_como_correcao():
    contexto = _Contexto("s-correcao")
    _run(_tool("registrar_finalidade_exumacao").function(contexto, finalidade="TRANSPORTE"))
    resposta = _run(
        _tool("registrar_finalidade_exumacao").function(contexto, finalidade="CREMACAO")
    )
    assert resposta.data["outcome"] == authority.ACCEPTED
    assert resposta.data["superseded_value"] == "TRANSPORTE"
    assert resposta.data["value"] == "CREMACAO"


def test_nao_existe_tool_de_correcao_separada():
    """Escolher entre registrar e corrigir era mais uma decisao do modelo."""
    assert not [n for n in T.TOOL_NAMES if n.startswith("corrigir")]


# ============================================ 6. a resposta autoritativa e rastreavel
def test_consulta_sem_fonte_oficial_falha_segura_e_encaminha():
    resposta = _run(_tool("consultar_documentos_exumacao").function(_Contexto("s-doc")))
    assert resposta.data["status"] == NAO_DISPONIVEL
    assert resposta.data["motivo"] == "SEM_FONTE_OFICIAL_CARREGADA"
    assert resposta.data["encaminhar_administracao"] is True
    # Sem valor oficial nao ha campo para interpolar: em STRICT a resposta que
    # dependeria de `{{valor}}` simplesmente nao pode ser enviada.
    assert resposta.canned_response_fields == {}


def test_consulta_de_preco_generica_pede_contexto_e_nao_escolhe_tarifa():
    """Ha tres tarifas de exumacao. Escolher uma seria decidir pelo municipe."""
    resposta = _run(_tool("consultar_preco_exumacao").function(_Contexto("s-preco")))
    assert resposta.data["status"] == "NEEDS_CONTEXT"
    assert resposta.data["precisa_de_contexto"] is True
    assert resposta.data["encaminhar_administracao"] is False
    assert resposta.data["contexto_faltante"] == ["modalidade_tarifaria"]
    assert resposta.canned_response_fields == {}
    assert "R$" not in json.dumps(resposta.data, ensure_ascii=False)


def test_consulta_publicada_traz_origem_e_release():
    contexto = _Contexto("s-assina")
    _run(_tool("registrar_situacao_do_conjuge").function(contexto, situacao="VIVO"))
    resposta = _run(_tool("consultar_quem_assina_exumacao").function(contexto))
    assert resposta.data["status"] == DISPONIVEL
    assert resposta.data["source_id"] == "SRC_DOMAIN_RELATIONS_V1"
    assert resposta.data["aplicabilidade"] == {"situacao_do_conjuge": "VIVO"}
    assert resposta.data["release_id"].startswith("exu-")
    assert resposta.canned_response_fields["texto"]
