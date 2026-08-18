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
    assert "consultar_*" in descricao
    assert "registrar_*" in descricao
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


def _tool(nome: str):
    return next(t for t in tools.ALL_TOOLS if t.tool.name == nome)


def test_tool_de_registro_valida_contra_o_catalogo():
    resultado = _run(_tool("registrar_finalidade_exumacao").function(_ctx(), finalidade="PIX"))
    assert resultado.data["outcome"] == authority.REJECTED
    assert "TRANSPORTE" in resultado.data["allowed_values"]


def test_nenhuma_tool_confirma_a_autorizacao_de_exumacao():
    """O fato `authoritative_only` nao tem tool: nao ha por onde tentar."""
    autoritativos = set(authority.authoritative_facts())
    assert "exhumation_authorization" in autoritativos
    assert not (autoritativos & set(tools.TOOL_POR_FATO))

    # E, pelo caminho direto do Gateway, a escrita falha fechada.
    from santana_parlant_poc.gateway import GATEWAY

    caso = STORE.case("sess-teste")
    resultado = GATEWAY.registrar_fato(caso, "exhumation_authorization", "OBTIDA_RESPONSAVEL_JAZIGO")
    assert resultado["outcome"] == authority.REJECTED
    assert caso.confirmed_value("exhumation_authorization") is None


def test_consulta_de_preco_sem_contexto_nao_devolve_valor():
    """Com tres tarifas na base, a pergunta generica pergunta de volta."""
    resultado = _run(_tool("consultar_preco_exumacao").function(_ctx()))
    assert resultado.data["status"] == "NEEDS_CONTEXT"
    assert resultado.canned_response_fields == {}
    assert not _DIGITOS.search(str(resultado.data.get("valor") or ""))


def test_tool_estado_do_caso_traz_proxima_pergunta_do_catalogo():
    resultado = _run(tools.consultar_estado_do_caso.function(_ctx()))
    proxima = resultado.data["next_question"]
    assert proxima["question"] in catalog.questions_by_fact().values()


def test_tools_registram_rastro_para_a_pagina():
    store = LabStore()
    session = "sess-rastro"
    STORE.reset(session)
    _run(_tool("registrar_situacao_dos_restos").function(_ctx(session), situacao="SEPULTADO"))
    rastro = STORE.trace(session).as_dict()
    assert rastro["tool_calls"][0]["tool"] == "registrar_situacao_dos_restos"
    STORE.reset(session)
    assert store.sessions() == []


def test_nlp_service_da_poc_nao_usa_gemini_pro(monkeypatch):
    """A chave da POC recebe 404 em `gemini-2.5-pro` e em `flash-lite`."""
    from santana_parlant_poc.agent import nlp

    assert set(nlp.MODEL_BY_SIZE) == set(nlp.ModelSize)
    monkeypatch.delenv("POC_GEMINI_MODEL", raising=False)
    assert nlp.configured_model() == "gemini-3.7-flash"
    assert "pro" not in nlp.configured_model()

    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-2.5-pro")
    with pytest.raises(ValueError):
        nlp.configured_model()


def test_rpm_e_configuracao_explicita_com_fail_safe(monkeypatch):
    """Nao ha mais tabela de RPM por modelo — ela tinha numeros que ninguem mediu.

    `gemini-3.1-flash-lite` simplesmente nao estava nela e caiu no fallback de 5
    rpm em silencio: o run 32146735829 gastou 1176 dos seus 1180 segundos
    esperando o limiter.
    """
    from santana_parlant_poc.agent import nlp

    assert not hasattr(nlp, "DEFAULT_RPM_BY_MODEL")

    monkeypatch.delenv("POC_GEMINI_RPM", raising=False)
    assert nlp.rpm_declarado() is None
    assert nlp.configured_rpm("qualquer-modelo") == nlp.RPM_FAIL_SAFE

    monkeypatch.setenv("POC_GEMINI_RPM", "60")
    assert nlp.rpm_declarado() == 60
    assert nlp.configured_rpm("qualquer-modelo") == 60
    assert nlp.exigir_rpm_declarado() == 60


def test_caminho_que_gasta_cota_exige_rpm_declarado(monkeypatch):
    """O fail-safe existe para nao estourar quota, nao para ser o valor de trabalho."""
    from santana_parlant_poc.agent import nlp

    monkeypatch.delenv("POC_GEMINI_RPM", raising=False)
    with pytest.raises(RuntimeError, match="POC_GEMINI_RPM nao declarado"):
        nlp.exigir_rpm_declarado()


def test_429_nao_retenta_por_padrao(monkeypatch):
    """Um 429 encerra o teste em vez de continuar consumindo cota."""
    from santana_parlant_poc.agent import nlp

    monkeypatch.delenv("POC_GEMINI_RETRIES_429", raising=False)
    assert nlp.configured_retries_on_429() == 0
    monkeypatch.setenv("POC_GEMINI_RETRIES_429", "3")
    assert nlp.configured_retries_on_429() == 3


def test_o_limiter_contabiliza_a_espera(monkeypatch):
    """Sem esse numero, "o turno demorou" nao distingue lentidao de rate limit."""
    import asyncio

    from santana_parlant_poc.agent import nlp

    antes = dict(nlp.THROTTLE_STATS)

    async def exercitar() -> None:
        limiter = nlp.RateLimiter(rpm=600)  # 0,1s por chamada
        for _ in range(3):
            await limiter.acquire()

    asyncio.run(exercitar())
    assert nlp.THROTTLE_STATS["chamadas"] == antes["chamadas"] + 3
    assert nlp.THROTTLE_STATS["espera_s"] > antes["espera_s"]


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


def test_toda_tool_declarada_e_alcancavel_por_alguma_guideline():
    """Tool sem guideline nao chega ao engine — e o modelo nunca poderia chama-la.

    O inventario da bateria sintetica pegou isso na pratica: 19 tools
    declaradas, 15 no `ServiceRegistry`. As quatro orfas existiam so no codigo.
    """
    usadas = {nome for g in spec.GUIDELINES for nome in g.get("tools", [])}
    usadas |= {s["tool"] for s in spec.JOURNEY["states"] if s.get("tool")}
    orfas = set(tools.TOOL_NAMES) - usadas
    assert orfas == set(), f"tools que nenhuma guideline aciona: {sorted(orfas)}"


def test_cada_tool_de_consulta_tem_uma_guideline_dedicada():
    """Uma guideline, uma tool: e assim que o assunto deixa de ser argumento."""
    for tipo, nome_tool in tools.TOOL_POR_TIPO_DE_INFORMACAO.items():
        donas = [g["key"] for g in spec.GUIDELINES if nome_tool in g.get("tools", [])]
        assert len(donas) == 1, f"{tipo}: {donas}"
