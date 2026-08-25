"""Integracao minima Omniroute (OpenAI-compat) para a Fase 4 / C1 no lab.

Espelha `experiments/c1-nvidia/nvidia_nlp.py`, mas:

1. Aponta para Omniroute local via env (`LITELLM_PROVIDER_BASE_URL`,
   `LITELLM_PROVIDER_API_KEY`, `LITELLM_PROVIDER_MODEL_NAME`).
2. Nao injeta `/no_think` (especifico do Nemotron).
3. Embeddings ficam locais (JinaAI/HuggingFace) — sem trafego Gemini/Google.
4. Nao toca producao, Supabase, n8n, WhatsApp, W-API ou Vercel.

O Parlant 3.3.2 ja traz `NLPServices.litellm`. Esta camada so instrumenta o
gerador para contar chamadas e abortar se o teto estourar.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any


class TetoDeChamadasEstourado(RuntimeError):
    """Crescimento inesperado de chamadas: aborta em vez de continuar gastando."""


@dataclass
class Chamada:
    indice: int
    fase: str
    modelo: str
    duracao_s: float
    tokens_entrada: int | None
    tokens_saida: int | None
    erro: str | None = None


@dataclass
class ContadorDeChamadas:
    """Contador com reserva de indice sob lock (mesmo padrao da C1 NVIDIA)."""

    teto: int = 250
    fase: str = "inicializacao"
    chamadas: list[Chamada] = field(default_factory=list)
    _reservados: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def proxima(self) -> int:
        with self._lock:
            self._reservados += 1
            indice = self._reservados
            estourou = indice > self.teto
        if estourou:
            raise TetoDeChamadasEstourado(
                f"teto de {self.teto} chamadas Omniroute estourado na chamada {indice} "
                f"(fase '{self.fase}'). Abortando para nao gastar mais."
            )
        return indice

    def registrar(self, chamada: Chamada) -> None:
        with self._lock:
            self.chamadas.append(chamada)

    def por_fase(self, fase: str) -> list[Chamada]:
        return [c for c in self.chamadas if c.fase == fase]

    def resumo(self) -> dict[str, Any]:
        def agregar(itens: list[Chamada]) -> dict[str, Any]:
            duracoes = sorted(c.duracao_s for c in itens)
            return {
                "chamadas": len(itens),
                "erros": sum(1 for c in itens if c.erro),
                "tokens_entrada": sum(c.tokens_entrada or 0 for c in itens),
                "tokens_saida": sum(c.tokens_saida or 0 for c in itens),
                "latencia_total_s": round(sum(duracoes), 2),
                "latencia_p50_s": round(duracoes[len(duracoes) // 2], 2) if duracoes else None,
                "latencia_max_s": round(duracoes[-1], 2) if duracoes else None,
            }

        erros_429 = sum(1 for c in self.chamadas if c.erro and "429" in c.erro)
        return {
            "teto": self.teto,
            "reservados": self._reservados,
            "total": len(self.chamadas),
            "inicializacao": agregar(self.por_fase("inicializacao")),
            "turno": agregar(self.por_fase("turno")),
            "retries": {
                "erros_429": erros_429,
                "retries_observed_min": erros_429,
                "retry_owner": "Parlant/library layer",
            },
        }


CONTADOR = ContadorDeChamadas()


class ShimLiteLLM:
    """Substitui o modulo `litellm` no gerador do Parlant e contabiliza."""

    def __init__(self, real: Any, contador: ContadorDeChamadas) -> None:
        self._real = real
        self._contador = contador

    def __getattr__(self, nome: str) -> Any:
        return getattr(self._real, nome)

    async def acompletion(self, **kwargs: Any) -> Any:
        indice = self._contador.proxima()
        fase = self._contador.fase
        modelo = str(kwargs.get("model", "?"))
        inicio = time.perf_counter()
        try:
            resposta = await self._real.acompletion(**kwargs)
        except Exception as erro:
            self._contador.registrar(
                Chamada(
                    indice=indice,
                    fase=fase,
                    modelo=modelo,
                    duracao_s=time.perf_counter() - inicio,
                    tokens_entrada=None,
                    tokens_saida=None,
                    erro=f"{type(erro).__name__}: {erro}",
                )
            )
            raise

        uso = getattr(resposta, "usage", None)
        self._contador.registrar(
            Chamada(
                indice=indice,
                fase=fase,
                modelo=modelo,
                duracao_s=time.perf_counter() - inicio,
                tokens_entrada=getattr(uso, "prompt_tokens", None),
                tokens_saida=getattr(uso, "completion_tokens", None),
            )
        )
        return resposta


class ServicoOmnirouteContado:
    """Delega tudo ao LiteLLM do Parlant; so instrumenta o gerador."""

    def __init__(self, interno: Any, contador: ContadorDeChamadas) -> None:
        self._interno = interno
        self._contador = contador

    @property
    def supports_streaming(self) -> bool:
        return bool(getattr(self._interno, "supports_streaming", False))

    async def get_schematic_generator(self, t: Any, hints: Any = {}) -> Any:
        gerador = await self._interno.get_schematic_generator(t, hints)
        real = getattr(gerador, "_client", None)
        if real is not None and not isinstance(real, ShimLiteLLM):
            gerador._client = ShimLiteLLM(real, self._contador)
        return gerador

    async def get_streaming_text_generator(self, hints: Any = {}) -> Any:
        return await self._interno.get_streaming_text_generator(hints)

    async def get_embedder(self, hints: Any = {}) -> Any:
        return await self._interno.get_embedder(hints)

    async def get_moderation_service(self) -> Any:
        return await self._interno.get_moderation_service()


def servico_omniroute(container: Any) -> Any:
    """Factory para `p.Server(nlp_service=...)` via Omniroute/LiteLLM."""
    import parlant.sdk as p

    return ServicoOmnirouteContado(p.NLPServices.litellm(container), CONTADOR)
