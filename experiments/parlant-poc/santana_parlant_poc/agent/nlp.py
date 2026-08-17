"""NLP service da POC: um unico modelo Gemini, com limite de requests por minuto.

Quatro ajustes em relacao ao adaptador padrao do Parlant, todos observados no CI
com a chave desta POC (`PARLANT`):

1. **Sem `gemini-2.5-pro`** — a API responde
   `404 ... no longer available to new users` para chaves novas.
2. **Sem `gemini-2.5-flash-lite`** — mesmo 404 nessa chave.
3. **Modelo unico e recente.** O padrao e `gemini-3.7-flash`
   (`POC_GEMINI_MODEL` troca). O `gemini-2.5-flash` funciona, mas o free tier
   dele e de 5 requests/minuto, o que torna o start do Parlant inviavel.
4. **Throttle proprio** — o Parlant avalia todas as entidades em paralelo no
   start e estoura o limite do free tier (`429 RESOURCE_EXHAUSTED`). O
   limitador espaca as chamadas e respeita o `retryDelay` devolvido pela API.

Nada disso muda a autoridade das regras: continua toda fora do LLM.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any, Mapping

from lagom import Container
from parlant.adapters.nlp.gemini_service import (
    GeminiSchematicGenerator,
    GeminiService,
    T,
)
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.generation import SchematicGenerationResult
from parlant.core.nlp.service import ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.tracer import Tracer

DEFAULT_MODEL = "gemini-3.7-flash"

# Requests por minuto do free tier, por modelo.
DEFAULT_RPM_BY_MODEL = {
    "gemini-2.5-flash": 5,
    "gemini-3.7-flash": 10,
    "gemini-3.6-flash": 10,
    "gemini-3.5-flash": 10,
}
DEFAULT_RPM = 5
MAX_RETRIES_ON_429 = 6

_RETRY_DELAY = re.compile(r"[Pp]lease retry in ([0-9.]+)s")


def configured_model() -> str:
    """Modelo usado em todos os tamanhos. Nunca um modelo `pro`."""
    model = os.environ.get("POC_GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    if "pro" in model:
        raise ValueError(
            f"POC_GEMINI_MODEL={model!r}: modelos 'pro' nao sao usados nesta POC "
            "(404 para chaves novas)."
        )
    return model


def configured_rpm(model_name: str) -> int:
    """RPM do modelo; `POC_GEMINI_RPM` sobrescreve (util com chave paga)."""
    override = os.environ.get("POC_GEMINI_RPM", "").strip()
    if override:
        try:
            return max(1, int(override))
        except ValueError:
            pass
    return DEFAULT_RPM_BY_MODEL.get(model_name, DEFAULT_RPM)


class RateLimiter:
    """Espaca chamadas em `60/rpm` segundos."""

    def __init__(self, rpm: int) -> None:
        self._interval = 60.0 / rpm
        self._lock = asyncio.Lock()
        self._next_slot = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next_slot - now)
            self._next_slot = max(now, self._next_slot) + self._interval
        if wait:
            await asyncio.sleep(wait)

    async def penalize(self, seconds: float) -> None:
        """Empurra a proxima janela apos um 429."""
        async with self._lock:
            self._next_slot = max(self._next_slot, time.monotonic() + seconds)


_LIMITERS: dict[str, RateLimiter] = {}
_LIMITERS_LOCK = asyncio.Lock()


async def limiter_for(model_name: str) -> RateLimiter:
    async with _LIMITERS_LOCK:
        if model_name not in _LIMITERS:
            _LIMITERS[model_name] = RateLimiter(configured_rpm(model_name))
        return _LIMITERS[model_name]


def _retry_after(error: BaseException) -> float:
    match = _RETRY_DELAY.search(str(error))
    return float(match.group(1)) + 1.0 if match else 20.0


def _is_rate_limit(error: BaseException) -> bool:
    text = str(error)
    return "429" in text or "RESOURCE_EXHAUSTED" in text


class ThrottledGemini(GeminiSchematicGenerator[T]):
    """Gerador da POC: modelo unico, chamadas espacadas, 429 tratado com espera."""

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        super().__init__(
            model_name=configured_model(),
            logger=logger,
            tracer=tracer,
            meter=meter,
        )

    @property
    def max_tokens(self) -> int:
        return 1024 * 1024

    async def generate(
        self,
        prompt: Any,
        hints: Mapping[str, Any] = {},
    ) -> SchematicGenerationResult[T]:
        limiter = await limiter_for(self.model_name)
        # `thinking_budget` so existe na familia 2.5; nos modelos 3.x a chamada falha.
        base = {"thinking_config": {"thinking_budget": 0}} if self.model_name.startswith("gemini-2.5") else {}
        merged = {**base, **hints}
        last_error: BaseException | None = None

        for _ in range(MAX_RETRIES_ON_429):
            await limiter.acquire()
            try:
                return await super().generate(prompt, merged)
            except Exception as error:
                if not _is_rate_limit(error):
                    raise
                last_error = error
                await limiter.penalize(_retry_after(error))

        assert last_error is not None
        raise last_error


# Todos os tamanhos usam o mesmo gerador: a chave da POC so tem acesso a um modelo.
MODEL_BY_SIZE = {
    ModelSize.NANO: ThrottledGemini,
    ModelSize.MINI: ThrottledGemini,
    ModelSize.LARGE: ThrottledGemini,
    ModelSize.AUTO: ThrottledGemini,
}


class GeminiFlashOnlyService(GeminiService):
    """GeminiService da POC: modelo unico (`configured_model`) e throttle."""

    async def get_schematic_generator(
        self, t: type[Any], hints: SchematicGeneratorHints = {}
    ) -> Any:
        generator_cls = MODEL_BY_SIZE[hints.get("model_size", ModelSize.AUTO)]
        return generator_cls[t](self.logger, self._tracer, self._meter)  # type: ignore[index]


def gemini_flash_only(container: Container) -> NLPService:
    """Factory no formato esperado por `parlant.sdk.Server(nlp_service=...)`."""
    if error := GeminiFlashOnlyService.verify_environment():
        raise RuntimeError(error)

    return GeminiFlashOnlyService(container[Logger], container[Tracer], container[Meter])
