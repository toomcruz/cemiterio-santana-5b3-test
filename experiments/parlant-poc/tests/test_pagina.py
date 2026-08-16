"""A pagina de teste e sua API (modo offline, sem chave e sem rede)."""

from fastapi.testclient import TestClient

from santana_parlant_poc.lab.server import MODE_OFFLINE, create_offline_app


def client() -> TestClient:
    return TestClient(create_offline_app())


def test_pagina_de_chat_carrega():
    resposta = client().get("/lab")
    assert resposta.status_code == 200
    corpo = resposta.text
    for rotulo in (
        "guideline(s) ativada(s)",
        "journey / estado",
        "tools chamadas",
        "fallback",
        "tempo de resposta",
    ):
        assert rotulo in corpo


def test_health_reporta_modo_sem_vazar_segredo():
    dados = client().get("/lab/api/health").json()
    assert dados["mode"] == MODE_OFFLINE
    assert set(dados) == {"mode", "gemini_key_present", "agent_id"}
    assert isinstance(dados["gemini_key_present"], bool)


def test_chat_devolve_resposta_rastro_e_tempo():
    c = client()
    dados = c.post(
        "/lab/api/chat",
        json={"message": "meu pai esta enterrado ai e quero tirar os restos"},
    ).json()

    assert dados["reply"]
    assert dados["latency_ms"] > 0
    assert dados["mode"] == MODE_OFFLINE
    assert dados["trace"]["guidelines"]
    assert dados["trace"]["journey_states"]
    assert dados["trace"]["tool_calls"]
    assert dados["trace"]["fallback"]  # modo offline sempre sinaliza
    assert dados["trace"]["error"] is None
    assert dados["case"]["goal"] == "GOAL_EXUMACAO"


def test_sessao_mantem_o_caso_entre_mensagens():
    c = client()
    primeira = c.post("/lab/api/chat", json={"message": "minha mae esta viva"}).json()
    session = primeira["session_id"]
    segunda = c.post(
        "/lab/api/chat",
        json={"session_id": session, "message": "ele ainda esta enterrado"},
    ).json()

    confirmados = segunda["case"]["confirmed_facts"]
    assert confirmados["surviving_spouse_status"]["value"] == "VIVO"
    assert confirmados["remains_status"]["value"] == "SEPULTADO"
    # regra derivada aplicada fora do LLM
    assert confirmados["required_authorization_signatory"]["rule"] == (
        "REL_EXUMACAO_SIGNATORY_SPOUSE_ALIVE"
    )

    c.post("/lab/api/reset", json={"session_id": session, "message": ""})
    depois = c.post(
        "/lab/api/chat", json={"session_id": session, "message": "bom dia"}
    ).json()
    assert depois["case"]["confirmed_facts"] == {}
