#!/usr/bin/env python
"""Micro-smoke: o menor teste real possivel de Parlant + Gemini.

Isolado de proposito. Nao usa a POC completa: sem journey, sem relationships,
sem glossario, sem canned responses, sem as 38 entidades. So:

* 1 guideline (a de seguranca: nao inventar preco);
* 1 tool simples;
* 1 conversa real, com a mensagem "quanto custa a exumacao?".

Cada entidade a mais custa chamadas de indexacao no start do Parlant, e a cota
do free tier do Gemini e o recurso escasso aqui — dai o tamanho minimo.

Objetivo: provar que o Parlant inicializa, que o Gemini responde, que a
guideline e aplicada, que a tool e chamada, que sai uma resposta real e quantos
429 aconteceram no caminho.

    GEMINI_API_KEY=... python scripts/micro_smoke.py
"""

import asyncio
import json
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

CONTADORES = {"geracoes": 0, "embeddings": 0, "erros_429": 0, "erros_404": 0}
RASTRO: dict[str, Any] = {
    "guidelines": [],
    "tools": [],
    "tool_calls": [],
    "mensagens": [],
    "resposta": "",
    "turno_s": -1.0,
    "erro": None,
}
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
            texto = str(error)
            if "429" in texto or "RESOURCE_EXHAUSTED" in texto:
                CONTADORES["erros_429"] += 1
            if "404" in texto or "NOT_FOUND" in texto:
                CONTADORES["erros_404"] += 1
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
TEMPO_MAXIMO_DO_TURNO = 240.0


async def _esperar_turno(client: httpx.AsyncClient, session_id: str, offset: int) -> bool:
    """Aguarda a sessao voltar ao estado `ready`, ou seja, o turno terminar.

    O Parlant emite um preambulo ("Compreendo a sua duvida") antes de casar
    guidelines e chamar tools; encerrar na primeira mensagem perde o turno real.
    """
    cursor = offset + 1
    limite = time.perf_counter() + TEMPO_MAXIMO_DO_TURNO

    while time.perf_counter() < limite:
        resposta = await client.get(
            f"/sessions/{session_id}/events",
            params={"min_offset": cursor, "kinds": "status", "wait_for_data": 60},
        )
        if resposta.status_code == 504:  # long-poll sem novidade; tenta de novo
            continue
        resposta.raise_for_status()

        for evento in resposta.json():
            cursor = max(cursor, evento["offset"] + 1)
            dados = evento.get("data") or {}
            estado = dados.get("status") if isinstance(dados, dict) else None
            if estado in ("error", "cancelled"):
                RASTRO["erro"] = f"turno terminou com status '{estado}'"
                return False
            if estado == "ready":
                return True

    RASTRO["erro"] = "o turno nao chegou ao estado 'ready' dentro do tempo limite"
    return False


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

        inicio_turno = time.perf_counter()
        evento = await client.post(
            f"/sessions/{session_id}/events",
            json={"kind": "message", "source": "customer", "message": MENSAGEM},
        )
        evento.raise_for_status()
        offset = evento.json()["offset"]

        concluiu = await _esperar_turno(client, session_id, offset)
        RASTRO["turno_s"] = time.perf_counter() - inicio_turno
        if not concluiu:
            return

        # Turno fechado: agora le tudo o que o agente produziu no caminho.
        eventos = await client.get(
            f"/sessions/{session_id}/events",
            params={"min_offset": offset + 1, "wait_for_data": 0},
        )
        eventos.raise_for_status()

        for item in eventos.json():
            dados = item.get("data") or {}
            if not isinstance(dados, dict):
                continue

            if item["kind"] == "message" and item.get("source") == "ai_agent":
                if dados.get("message"):
                    RASTRO["mensagens"].append(dados["message"])
                    RASTRO["resposta"] = dados["message"]  # a ultima e a final

            elif item["kind"] == "tool":
                for chamada in dados.get("tool_calls", []):
                    nome = chamada.get("tool_id", "?")
                    RASTRO["tools"].append(nome)
                    RASTRO["tool_calls"].append(
                        {
                            "tool": nome,
                            "argumentos": chamada.get("arguments"),
                            "retorno": (chamada.get("result") or {}).get("data"),
                        }
                    )


def _relatorio(inicializacao: float, total: float) -> int:
    resposta = RASTRO["resposta"]
    falhas = []
    if not resposta:
        falhas.append("nenhuma resposta real foi gerada")
    if not RASTRO["guidelines"]:
        falhas.append("nenhuma guideline foi aplicada")
    if not RASTRO["tool_calls"]:
        falhas.append("a tool nao foi chamada")
    if CONTADORES["erros_429"]:
        falhas.append(f"{CONTADORES['erros_429']} erros 429")
    if CONTADORES["erros_404"]:
        falhas.append(f"{CONTADORES['erros_404']} erros 404")
    if any(ch.isdigit() for ch in resposta):
        falhas.append("a resposta contem numero (possivel preco inventado)")
    if RASTRO["erro"]:
        falhas.append(RASTRO["erro"])

    print("\n" + "=" * 72)
    print("MICRO-SMOKE PARLANT + GEMINI")
    print("=" * 72)
    print(f"resultado ................: {'PASS' if not falhas else 'FAIL'}")
    print(f"modelo ...................: {configured_model()}")
    print(f"tempo de inicializacao ...: {inicializacao:.1f}s")
    print(f"tempo do turno ...........: {RASTRO['turno_s']:.1f}s")
    print(f"tempo total ..............: {total:.1f}s")
    print(f"chamadas de geracao ......: {CONTADORES['geracoes']}")
    print(f"chamadas de embedding ....: {CONTADORES['embeddings']}")
    print(f"erros 404 ................: {CONTADORES['erros_404']}")
    print(f"erros 429 ................: {CONTADORES['erros_429']}")
    print(f"guidelines aplicadas .....: {sorted(set(RASTRO['guidelines'])) or '-'}")
    print(f"tools chamadas ...........: {sorted(set(RASTRO['tools'])) or '-'}")
    for chamada in RASTRO["tool_calls"]:
        print(f"  tool .................: {chamada['tool']}")
        print(f"  argumentos ...........: {json.dumps(chamada['argumentos'], ensure_ascii=False)}")
        print(f"  retorno ..............: {json.dumps(chamada['retorno'], ensure_ascii=False)}")
    print(f"mensagem enviada .........: {MENSAGEM}")
    print(f"mensagens do agente ......: {len(RASTRO['mensagens'])}")
    for indice, mensagem in enumerate(RASTRO["mensagens"], start=1):
        print(f"  [{indice}] {mensagem}")
    print(f"resposta final ...........: {resposta or '(nenhuma)'}")
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

        # Uma unica guideline: cada entidade extra custa chamadas de indexacao no
        # start, e a cota do free tier e o recurso mais escasso deste teste.
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
