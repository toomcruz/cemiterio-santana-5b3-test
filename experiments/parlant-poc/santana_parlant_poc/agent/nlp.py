"""NLP service da POC: Gemini Flash, com limite de requisicoes por minuto.

Dois ajustes em relacao ao adaptador padrao do Parlant, ambos observados no CI
com a chave desta POC (`PARLANT`):

1. **Sem `gemini-2.5-pro`.** O adaptador usa Pro para tarefas grandes e a API
   responde `404 ... no longer available to new users` para chaves novas.
2. **Throttle proprio.** A chave esta no free tier, com poucos requests por
   minuto por modelo. O Parlant avalia todas as entidades (guidelines, journey)
   em paralelo no start e estoura o limite (`429 RESOURCE_EXHAUSTED`). O
   limitador abaixo espaca as chamadas e respeita o `retryDelay` devolvido pela
   API.

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
    Gemini_2_5_Flash,
    Gemini_2_5_Flash_Lite,
    GeminiService,
    T,
)
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.generation import SchematicGenerationResult
from parlant.core.nlp.service import ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.tracer import Tracer

# Requests por minuto do free tier, por modelo (ajustavel por variavel de ambiente).
DEFAULT_RPM_BY_MODEL = {
    "gemini-2.5-flash": 5,
    "gemini-2.5-flash-lite": 15,
}
MAX_RETRIES_ON_429 = 6

_RETRY_DELAY = re.compile(r"[Pp]lease retry in ([0-9.]+)s")


def configured_rpm(model_name: str) -> int:
    """RPM do modelo; `POC_GEMINI_RPM` sobrescreve todos (util com chave paga)."""
    override = os.environ.get("POC_GEMINI_RPM", "").strip()
    if override:
        try:
            return max(1, int(override))
        except ValueError:
            pass
    return DEFAULT_RPM_BY_MODEL.get(model_name, 5)


class RateLimiter:
    """Espaca chamadas em `60/rpm` segundos, compartilhado por todos os geradores."""

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


class _ThrottledMixin:
    """Aplica o limitador e reage a 429 com espera, em vez de derrubar o start."""

    async def generate(  # type: ignore[override]
        self,
        prompt: Any,
        hints: Mapping[str, Any] = {},
    ) -> SchematicGenerationResult[T]:
        last_error: BaseException | None = None
        limiter = await limiter_for(self.model_name)  # type: ignore[attr-defined]

        for _ in range(MAX_RETRIES_ON_429):
            await limiter.acquire()
            try:
                return await super().generate(prompt, hints)  # type: ignore[misc]
            except Exception as error:
                if not _is_rate_limit(error):
                    raise
                last_error = error
                await limiter.penalize(_retry_after(error))

        assert last_error is not None
        raise last_error


class ThrottledFlash(_ThrottledMixin, Gemini_2_5_Flash[T]):
    pass


class ThrottledFlashLite(_ThrottledMixin, Gemini_2_5_Flash_Lite[T]):
    pass


# Mapa explicito e testavel: nenhuma entrada aponta para um modelo "pro".
# O padrao e Flash-Lite em todos os tamanhos porque o free tier libera bem mais
# requests por minuto nele (15 contra 5 do Flash), e o start do Parlant avalia
# dezenas de entidades. Com uma chave paga, use POC_GEMINI_MODEL=flash.
MODEL_BY_SIZE = {
    ModelSize.NANO: ThrottledFlashLite,
    ModelSize.MINI: ThrottledFlashLite,
    ModelSize.LARGE: ThrottledFlashLite,
    ModelSize.AUTO: ThrottledFlashLite,
}


def generator_class(size: ModelSize) -> type:
    if os.environ.get("POC_GEMINI_MODEL", "").strip() == "flash":
        return ThrottledFlashLite if size == ModelSize.NANO else ThrottledFlash
    return MODEL_BY_SIZE[size]


class GeminiFlashOnlyService(GeminiService):
    """GeminiService restrito a Flash/Flash-Lite e com throttle da POC."""

    async def get_schematic_generator(
        self, t: type[Any], hints: SchematicGeneratorHints = {}
    ) -> Any:
        generator_cls = generator_class(hints.get("model_size", ModelSize.AUTO))
        return generator_cls[t](self.logger, self._tracer, self._meter)  # type: ignore[index]


def gemini_flash_only(container: Container) -> NLPService:
    """Factory no formato esperado por `parlant.sdk.Server(nlp_service=...)`."""
    if error := GeminiFlashOnlyService.verify_environment():
        raise RuntimeError(error)

    return GeminiFlashOnlyService(container[Logger], container[Tracer], container[Meter])
