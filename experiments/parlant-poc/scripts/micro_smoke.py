#!/usr/bin/env python
"""Micro-smoke: o menor teste real possivel de Parlant + Gemini.

Isolado de proposito. Nao usa a POC completa: sem journey, sem relationships,
sem glossario, sem canned responses, sem as 38 entidades. So:

* 2 guidelines (uma de atendimento, uma de seguranca contra inventar preco);
* 1 tool simples;
* 1 conversa real, com a mensagem "quanto custa a exumacao?".

Objetivo: provar que o Parlant inicializa, que o Gemini responde, que uma
guideline e aplicada, que a tool e chamada, que sai uma resposta real e quantos
429 aconteceram no caminho.

    GEMINI_API_KEY=... python scripts/micro_smoke.py
"""

import asyncio
import os
import signal
import sys
import time
from typing import Any, Mapping

import httpx
import parlant.sdk as p
from lagom import Container
from parlant.adapters.nlp.gemini_service import GeminiTextEmbedding_001, T
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.service import ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.tracer import Tracer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from santana_parlant_poc.agent.nlp import (  # noqa: E402
    GeminiFlashOnlyService,
    ThrottledGemini,
    configured_model,
)

PORT = int(os.environ.get("MICRO_PORT", "8802"))
MENSAGEM = "quanto custa a exumação?"

CONTADORES = {"geracoes": 0, "embeddings": 0, "erros_429": 0}
RASTRO: dict[str, Any] = {"guidelines": [], "tools": [], "resposta": "", "erro": None}
RESULTADO = {"codigo": 1}


# --------------------------------------------------------------- instrumentacao
class GeradorContado(ThrottledGemini[T]):
    """Mesmo gerador da POC (modelo unico + throttle), so que contando chamadas."""

    async def _do_generate(self, prompt: Any, hints: Mapping[str, Any] = {}) -> Any:
        # Conta aqui, e nao em generate(), porque o retry do throttle da POC
        # absorve os 429 intermediarios antes de chegar em generate().
        CONTADORES["geracoes"] += 1
        try:
            return await super()._do_generate(prompt, hints)  # type: ignore[misc]
        except Exception as error:
            if "429" in str(error) or "RESOURCE_EXHAUSTED" in str(error):
                CONTADORES["erros_429"] += 1
            raise


class EmbedderContado(GeminiTextEmbedding_001):
    async def embed(self, texts: Any, hints: Mapping[str, Any] = {}) -> Any:
        CONTADORES["embeddings"] += 1
        return await super().embed(texts, hints)


class ServicoMicro(GeminiFlashOnlyService):
    async def get_schematic_generator(
        self, t: type[Any], hints: SchematicGeneratorHints = {}
    ) -> Any:
        _ = hints.get("model_size", ModelSize.AUTO)
        return GeradorContado[t](self.logger, self._tracer, self._meter)  # type: ignore[index]

    async def get_embedder(self, hints: Mapping[str, Any] = {}) -> Any:
        return EmbedderContado(self.logger, self._tracer, self._meter)


def servico_micro(container: Container) -> NLPService:
    if error := ServicoMicro.verify_environment():
        raise RuntimeError(error)
    return ServicoMicro(container[Logger], container[Tracer], container[Meter])


# ---------------------------------------------------------------------- a tool
@p.tool
async def consultar_preco_exumacao(context: p.ToolContext) -> p.ToolResult:
    """Consulta a base autoritativa do Cemiterio Santana sobre o valor da exumacao.

    Obrigatoria sempre que o municipe perguntar preco, valor, taxa ou custo.
    """
    RASTRO["tools"].append("consultar_preco_exumacao")
    return p.ToolResult(
        data={
            "status": "NAO_DISPONIVEL",
            "resposta": (
                "Nao ha valor de exumacao publicado. Quem informa valores e a Administracao "
                "do Cemiterio Santana."
            ),
        }
    )


def marcar_guideline(chave: str):
    async def on_match(ctx: Any, match: Any) -> None:
        RASTRO["guidelines"].append(chave)

    return on_match


# ------------------------------------------------------------------- execucao
async def _conversa(server: p.Server, agent_id: str) -> None:
    base = f"http://127.0.0.1:{PORT}"
    async with httpx.AsyncClient(base_url=base, timeout=180.0) as client:
        sessao = await client.post(
            "/sessions",
            json={"agent_id": agent_id, "title": "micro-smoke"},
            params={"allow_greeting": False},
        )
        sessao.raise_for_status()
        session_id = sessao.json()["id"]

        evento = await client.post(
            f"/sessions/{session_id}/events",
            json={"kind": "message", "source": "customer", "message": MENSAGEM},
        )
        evento.raise_for_status()
        offset = evento.json()["offset"]

        eventos = await client.get(
            f"/sessions/{session_id}/events",
            params={
                "min_offset": offset + 1,
                "kinds": "message",
                "source": "ai_agent",
                "wait_for_data": 150,
            },
        )
        if eventos.status_code != 200:
            RASTRO["erro"] = f"sem resposta do agente (HTTP {eventos.status_code})"
            return

        for item in eventos.json():
            dados = item.get("data") or {}
            if isinstance(dados, dict) and dados.get("message"):
                RASTRO["resposta"] = dados["message"]


def _relatorio(inicializacao: float, total: float) -> int:
    resposta = RASTRO["resposta"]
    falhas = []
    if not resposta:
        falhas.append("nenhuma resposta real foi gerada")
    if CONTADORES["erros_429"]:
        falhas.append(f"{CONTADORES['erros_429']} erros 429")
    if any(ch.isdigit() for ch in resposta):
        falhas.append("a resposta contem numero (possivel preco inventado)")

    print("\n" + "=" * 72)
    print("MICRO-SMOKE PARLANT + GEMINI")
    print("=" * 72)
    print(f"resultado ................: {'PASS' if not falhas else 'FAIL'}")
    print(f"modelo ...................: {configured_model()}")
    print(f"tempo de inicializacao ...: {inicializacao:.1f}s")
    print(f"tempo total ..............: {total:.1f}s")
    print(f"chamadas de geracao ......: {CONTADORES['geracoes']}")
    print(f"chamadas de embedding ....: {CONTADORES['embeddings']}")
    print(f"erros 429 ................: {CONTADORES['erros_429']}")
    print(f"guidelines ativadas ......: {sorted(set(RASTRO['guidelines'])) or '-'}")
    print(f"tools chamadas ...........: {sorted(set(RASTRO['tools'])) or '-'}")
    print(f"mensagem enviada .........: {MENSAGEM}")
    print(f"resposta do agente .......: {resposta or '(nenhuma)'}")
    if RASTRO["erro"]:
        print(f"erro .....................: {RASTRO['erro']}")
    if falhas:
        print("falhas ...................: " + "; ".join(falhas))
    print("=" * 72)
    return 1 if falhas else 0


async def main() -> int:
    if not os.environ.get("GEMINI_API_KEY", "").strip():
        print("GEMINI_API_KEY ausente: micro-smoke nao executado.")
        return 2

    inicio = time.perf_counter()
    pronto: dict[str, float] = {}

    async with p.Server(
        port=PORT,
        nlp_service=servico_micro,
        session_store="transient",
        customer_store="transient",
    ) as server:
        agent = await server.create_agent(
            name="Micro atendente Santana",
            description=(
                "Atendente experimental do Cemiterio Santana. Fala portugues do Brasil, "
                "de forma curta e respeitosa. Nunca informa preco, valor ou taxa por conta "
                "propria."
            ),
        )

        await agent.create_guideline(
            condition="o municipe fala sobre exumacao ou retirada de restos mortais",
            action="acolha em uma frase e diga que vai ajudar com o pedido de exumacao",
            on_match=marcar_guideline("G_ATENDIMENTO"),
        )

        await agent.create_guideline(
            condition="o municipe pergunta preco, valor, taxa ou custo",
            action=(
                "chame consultar_preco_exumacao e responda exatamente o que ela devolver; "
                "nunca cite um valor, nem aproximado"
            ),
            tools=[consultar_preco_exumacao],
            on_match=marcar_guideline("G_SEM_PRECO"),
        )

        async def runner() -> None:
            try:
                await server.ready.wait()
                pronto["inicializacao"] = time.perf_counter() - inicio
                print(f"Parlant pronto em {pronto['inicializacao']:.1f}s. Enviando mensagem…")
                await _conversa(server, agent.id)
            except Exception as error:  # o relatorio precisa sair mesmo com falha
                RASTRO["erro"] = f"{type(error).__name__}: {error}"
            finally:
                RESULTADO["codigo"] = _relatorio(
                    pronto.get("inicializacao", -1.0), time.perf_counter() - inicio
                )
                os.kill(os.getpid(), signal.SIGINT)

        asyncio.create_task(runner())

    return RESULTADO["codigo"]


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(RESULTADO["codigo"])
