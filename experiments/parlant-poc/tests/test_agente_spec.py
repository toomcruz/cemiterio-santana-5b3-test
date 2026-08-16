"""Validacao offline da configuracao do agente Parlant.

Nao chama o Gemini: verifica a especificacao (guidelines, relationships,
journey, tools, canned responses, glossary) e a fronteira IA x regra.
"""

import asyncio
import re

import parlant.sdk as p
import pytest

from santana_parlant_poc.agent import spec, tools
from santana_parlant_poc.domain import authority, catalog, knowledge
from santana_parlant_poc.store import LabStore, STORE

_DIGITOS = re.compile(r"\d")
_PALAVRAS_PROIBIDAS = ("r$", "reais", "dias uteis", "certidao de obito", "rg e cpf")


def test_todas_as_tools_referenciadas_existem():
    disponiveis = set(tools.TOOL_NAMES)
    for guideline in spec.GUIDELINES:
        assert set(guideline.get("tools", [])) <= disponiveis, guideline["key"]
    for state in spec.JOURNEY["states"]:
        if state["kind"] == "tool":
            assert state["tool"] in disponiveis


def test_relationships_apontam_para_guidelines_existentes():
    chaves = {g["key"] for g in spec.GUIDELINES}
    for rel in spec.RELATIONSHIPS:
        assert rel["source"] in chaves
        assert set(rel["targets"]) <= chaves
        assert rel["kind"] in ("prioritize_over", "entail", "depend_on")


def test_autoridade_tem_prioridade_sobre_coleta():
    prioridades = {
        (r["source"], alvo)
        for r in spec.RELATIONSHIPS
        if r["kind"] == "prioritize_over"
        for alvo in r["targets"]
    }
    for guardiao in ("G_PRECO", "G_DOCUMENTOS", "G_PRAZO", "G_INJECAO"):
        assert (guardiao, "G_COLETA") in prioridades


def test_canned_responses_nao_contem_preco_documento_ou_prazo():
    for canrep in spec.CANNED_RESPONSES:
        texto = canrep["template"].lower()
        assert not _DIGITOS.search(texto), canrep["key"]
        for proibida in _PALAVRAS_PROIBIDAS:
            assert proibida not in texto, (canrep["key"], proibida)


def test_canned_responses_referenciadas_existem():
    chaves = {c["key"] for c in spec.CANNED_RESPONSES}
    for guideline in spec.GUIDELINES:
        assert set(guideline.get("canned_responses", [])) <= chaves


def test_descricao_do_agente_declara_a_fronteira_ia():
    descricao = spec.AGENT_DESCRIPTION.lower()
    for proibicao in ("preco", "documentos", "prazo", "procedimento"):
        assert proibicao in descricao
    assert "consultar_base_autoritativa" in descricao
    assert "next_question" in descricao


def test_criticidade_e_valida_no_parlant():
    validos = {c.name for c in p.Criticality}
    for guideline in spec.GUIDELINES:
        assert guideline.get("criticality", "MEDIUM") in validos


def test_glossario_cobre_o_vocabulario_do_municipe():
    sinonimos = {s.lower() for term in spec.GLOSSARY for s in term.get("synonyms", [])}
    assert "tirar os restos" in sinonimos
    assert {t["name"] for t in spec.GLOSSARY} >= {"Exumacao", "Jazigo", "Ossuario"}


def test_journey_usa_o_estado_deterministico_antes_de_falar():
    estados = [s["key"] for s in spec.JOURNEY["states"]]
    assert estados[0] == "S_ESTADO"
    assert spec.JOURNEY["states"][0]["kind"] == "tool"
    assert spec.JOURNEY["states"][0]["tool"] == "consultar_estado_do_caso"


def test_cenarios_exigidos_estao_declarados():
    assert len(spec.SCENARIO_COVERAGE) == 10


# --------------------------------------------------------------- tools reais
def _ctx(session_id: str = "sess-teste") -> p.ToolContext:
    return p.ToolContext(agent_id="agente", session_id=session_id, customer_id="municipe")


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _sessao_limpa():
    STORE.reset("sess-teste")
    yield
    STORE.reset("sess-teste")


def test_tool_registrar_fato_valida_contra_o_catalogo():
    resultado = _run(tools.registrar_fato.function(_ctx(), fato="exhumation_purpose", valor="PIX"))
    assert resultado.data["outcome"] == authority.REJECTED
    assert "TRANSPORTE" in resultado.data["allowed_values"]


def test_tool_registrar_fato_nao_confirma_autorizacao():
    resultado = _run(
        tools.registrar_fato.function(
            _ctx(), fato="exhumation_authorization", valor="OBTIDA_RESPONSAVEL_JAZIGO"
        )
    )
    assert resultado.data["outcome"] == authority.RECORDED_AS_CLAIM
    assert resultado.data["case"]["confirmed_facts"].get("exhumation_authorization") is None


def test_tool_base_autoritativa_nunca_devolve_preco():
    resultado = _run(tools.consultar_base_autoritativa.function(_ctx(), assunto="quanto custa"))
    assert resultado.data["status"] == knowledge.NOT_AVAILABLE
    assert not _DIGITOS.search(resultado.data["answer"])


def test_tool_estado_do_caso_traz_proxima_pergunta_do_catalogo():
    resultado = _run(tools.consultar_estado_do_caso.function(_ctx()))
    proxima = resultado.data["next_question"]
    assert proxima["question"] in catalog.questions_by_fact().values()


def test_tools_registram_rastro_para_a_pagina():
    store = LabStore()
    session = "sess-rastro"
    STORE.reset(session)
    _run(tools.registrar_fato.function(_ctx(session), fato="remains_status", valor="SEPULTADO"))
    rastro = STORE.trace(session).as_dict()
    assert rastro["tool_calls"][0]["tool"] == "registrar_fato"
    STORE.reset(session)
    assert store.sessions() == []


def test_nlp_service_da_poc_nao_usa_gemini_pro():
    """A chave nova da POC recebe 404 em `gemini-2.5-pro`; so a familia Flash e usada."""
    from santana_parlant_poc.agent import nlp

    assert set(nlp.MODEL_BY_SIZE) == set(nlp.ModelSize)
    for tamanho, classe in nlp.MODEL_BY_SIZE.items():
        assert "Pro" not in classe.__name__, (tamanho, classe.__name__)


def test_rate_limiter_espaca_chamadas():
    from santana_parlant_poc.agent import nlp

    limiter = nlp.RateLimiter(rpm=600)  # 0,1s entre chamadas
    inicio = asyncio.get_event_loop_policy().new_event_loop()
    try:
        inicio.run_until_complete(limiter.acquire())
        marcado = __import__("time").monotonic()
        inicio.run_until_complete(limiter.acquire())
        assert __import__("time").monotonic() - marcado >= 0.09
    finally:
        inicio.close()


def test_retry_de_429_usa_o_delay_sugerido_pela_api():
    from santana_parlant_poc.agent import nlp

    erro = Exception("429 RESOURCE_EXHAUSTED ... Please retry in 44.46s")
    assert nlp._is_rate_limit(erro)
    assert nlp._retry_after(erro) > 44
    assert not nlp._is_rate_limit(Exception("404 NOT_FOUND"))
