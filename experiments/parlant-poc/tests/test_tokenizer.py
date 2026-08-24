"""Regressao do caminho Gemini da POC: geracao, contagem de tokens e embeddings.

O blocker que estes testes travam: o adaptador do Parlant 3.3.2 conta os tokens
do embedder (`gemini-embedding-001`) usando `gemini-2.5-flash` como aproximacao,
e esse modelo responde 404 para a chave desta POC. O turno morria na contagem de
tokens, nao na geracao.

Tudo aqui roda offline, com um cliente falso: nenhum teste toca a rede.
"""

import asyncio
from typing import Any

import pytest

from santana_parlant_poc.agent import nlp


class _ContagemFalsa:
    def __init__(self, total: int) -> None:
        self.total_tokens = total


class _ModelosFalsos:
    """Captura o modelo pedido e simula a resposta da API de count_tokens."""

    def __init__(self, erro: Exception | None = None) -> None:
        self.erro = erro
        self.modelos_pedidos: list[str] = []

    async def count_tokens(self, model: str, contents: str) -> _ContagemFalsa:
        self.modelos_pedidos.append(model)
        if self.erro is not None:
            raise self.erro
        return _ContagemFalsa(total=len(contents) // 4)


class _ClienteFalso:
    def __init__(self, erro: Exception | None = None) -> None:
        self.aio = type("Aio", (), {"models": _ModelosFalsos(erro)})()

    @property
    def modelos_pedidos(self) -> list[str]:
        return self.aio.models.modelos_pedidos


@pytest.fixture(autouse=True)
def _limpar_estatisticas():
    nlp.TOKENIZER_STATS.update(
        {
            "modelo_pedido": None,
            "count_tokens_ok": 0,
            "count_tokens_404": 0,
            "count_tokens_outros_erros": 0,
            "estimativas_locais": 0,
            "modo": "api",
            "motivo_do_fallback": None,
        }
    )
    yield


# ---------------------------------------------------------------- modelo unico
def test_geracao_usa_o_modelo_configurado(monkeypatch):
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    assert nlp.configured_model() == "gemini-3.1-flash-lite"


def test_modelo_pro_e_recusado(monkeypatch):
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-pro")
    with pytest.raises(ValueError):
        nlp.configured_model()


def test_contagem_nunca_pede_gemini_2_5(monkeypatch):
    """Regressao do blocker: a contagem ia para `gemini-2.5-flash` e dava 404."""
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    cliente = _ClienteFalso()
    tokenizer = nlp.PocEstimatingTokenizer(cliente, nlp.configured_model())

    asyncio.run(tokenizer.estimate_token_count("mensagem do municipe"))

    assert cliente.modelos_pedidos == ["gemini-3.1-flash-lite"]
    assert not any("2.5" in modelo for modelo in cliente.modelos_pedidos)
    assert nlp.TOKENIZER_STATS["count_tokens_ok"] == 1


def test_contagem_devolve_o_total_da_api(monkeypatch):
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    cliente = _ClienteFalso()
    tokenizer = nlp.PocEstimatingTokenizer(cliente, nlp.configured_model())

    texto = "a" * 400
    assert asyncio.run(tokenizer.estimate_token_count(texto)) == 100


# ------------------------------------------------------------------- fallback
def test_404_na_contagem_vira_estimativa_local_e_e_contabilizado(monkeypatch):
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    erro = RuntimeError("404 NOT_FOUND - model no longer available to new users")
    cliente = _ClienteFalso(erro=erro)
    tokenizer = nlp.PocEstimatingTokenizer(cliente, nlp.configured_model())

    total = asyncio.run(tokenizer.estimate_token_count("quanto custa a exumacao?"))

    assert total > 0, "o 404 nao pode derrubar o turno"
    assert nlp.TOKENIZER_STATS["count_tokens_404"] == 1
    assert nlp.TOKENIZER_STATS["modo"] == "local"
    assert nlp.TOKENIZER_STATS["estimativas_locais"] == 1
    assert "404" in nlp.TOKENIZER_STATS["motivo_do_fallback"]


def test_apos_o_404_a_api_nao_e_chamada_de_novo(monkeypatch):
    """Um 404 e definitivo para a chave: insistir so gastaria chamada."""
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    cliente = _ClienteFalso(erro=RuntimeError("404 NOT_FOUND"))
    tokenizer = nlp.PocEstimatingTokenizer(cliente, nlp.configured_model())

    for _ in range(4):
        asyncio.run(tokenizer.estimate_token_count("texto"))

    assert len(cliente.modelos_pedidos) == 1
    assert nlp.TOKENIZER_STATS["estimativas_locais"] == 4


def test_erro_que_nao_e_404_tambem_e_contabilizado(monkeypatch):
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")
    cliente = _ClienteFalso(erro=RuntimeError("500 INTERNAL"))
    tokenizer = nlp.PocEstimatingTokenizer(cliente, nlp.configured_model())

    assert asyncio.run(tokenizer.estimate_token_count("texto")) > 0
    assert nlp.TOKENIZER_STATS["count_tokens_outros_erros"] == 1
    assert nlp.TOKENIZER_STATS["count_tokens_404"] == 0


def test_estimativa_local_sobrestima_em_vez_de_subestimar():
    """Melhor truncar o prompt do que estourar a janela de contexto."""
    cliente = _ClienteFalso()
    tokenizer = nlp.PocEstimatingTokenizer(cliente, "gemini-3.1-flash-lite")
    texto = "palavra " * 100  # 800 caracteres
    local = tokenizer._estimar_local(texto)
    assert local >= len(texto) / 4


# ------------------------------------------------------------------ embedder
def test_embedder_da_poc_e_local_e_nao_consume_cota_do_gemini(monkeypatch):
    """O índice interno não pode criar chamadas Gemini antes do turno C1."""
    monkeypatch.setenv("GEMINI_API_KEY", "chave-de-teste-nao-usada")

    from parlant.adapters.nlp.gemini_service import GoogleEstimatingTokenizer

    class _Nulo:
        def __getattr__(self, _nome: str) -> Any:
            return self

        def __call__(self, *_a: Any, **_k: Any) -> Any:
            return self

    embedder = nlp.PocEmbedder(_Nulo(), _Nulo(), _Nulo())
    tokenizer = embedder.tokenizer

    assert isinstance(tokenizer, nlp.LocalPocTokenizer)
    assert not isinstance(tokenizer, GoogleEstimatingTokenizer)
    assert embedder.model_name == "local-poc-ngram-embedding"

    resultado = asyncio.run(embedder.do_embed(["quanto custa a exumacao?"]))
    assert len(resultado.vectors) == 1
    assert len(resultado.vectors[0]) == embedder.dimensions
    assert any(valor != 0 for valor in resultado.vectors[0])

def test_servico_da_poc_entrega_o_embedder_da_poc(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "chave-de-teste-nao-usada")
    monkeypatch.setenv("POC_GEMINI_MODEL", "gemini-3.1-flash-lite")

    class _Nulo:
        def __getattr__(self, _nome: str) -> Any:
            return self

        def __call__(self, *_a: Any, **_k: Any) -> Any:
            return self

    servico = nlp.GeminiFlashOnlyService(_Nulo(), _Nulo(), _Nulo())
    embedder = asyncio.run(servico.get_embedder())
    assert isinstance(embedder, nlp.PocEmbedder)
