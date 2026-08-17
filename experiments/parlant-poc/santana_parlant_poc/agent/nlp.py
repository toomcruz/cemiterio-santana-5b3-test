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
    GeminiTextEmbedding_001,
    T,
)
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.generation import SchematicGenerationResult
from parlant.core.nlp.service import EmbedderHints, ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.nlp.tokenization import EstimatingTokenizer
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


# ------------------------------------------------------- contagem de tokens
# Estatisticas do caminho de contagem de tokens, lidas pela instrumentacao dos
# smokes. Nao ha estado escondido: o que aconteceu aqui aparece no relatorio.
TOKENIZER_STATS: dict[str, Any] = {
    "modelo_pedido": None,
    "count_tokens_ok": 0,
    "count_tokens_404": 0,
    "count_tokens_outros_erros": 0,
    "estimativas_locais": 0,
    "modo": "api",  # vira "local" apos um 404 no count_tokens
    "motivo_do_fallback": None,
}

# Aproximacao local: ~3,5 caracteres por token em portugues. Sobrestima de
# proposito — para o Parlant, achar o prompt maior do que e leva a truncar,
# enquanto achar menor levaria a estourar a janela de contexto.
CARACTERES_POR_TOKEN = 3.5


def _e_modelo_indisponivel(erro: BaseException) -> bool:
    texto = str(erro)
    return "404" in texto or "NOT_FOUND" in texto or "not found" in texto.lower()


class PocEstimatingTokenizer(EstimatingTokenizer):
    """Contagem de tokens presa ao modelo que a chave desta POC realmente tem.

    O adaptador do Parlant 3.3.2 conta tokens com o proprio modelo, exceto para
    o embedder: `GoogleEstimatingTokenizer.estimate_token_count` traduz
    `gemini-embedding-001` para `gemini-2.5-flash` como aproximacao. Com a chave
    desta POC esse modelo responde `404 ... no longer available to new users`, e
    o turno inteiro morria ali — nao no gerador, que ja usava o modelo certo.

    Aqui a contagem vai sempre para `configured_model()`. Se a API de
    `count_tokens` nao aceitar esse modelo, o tokenizer passa a estimar
    localmente e registra o motivo. A estimativa local **nao e** a contagem real
    do modelo: e uma aproximacao por tamanho de texto, usada so para dimensionar
    prompt, nunca para cobranca ou para decisao de autoridade.
    """

    def __init__(self, client: Any, model_name: str) -> None:
        self._client = client
        self._model_name = model_name
        TOKENIZER_STATS["modelo_pedido"] = model_name

    def _estimar_local(self, prompt: str) -> int:
        TOKENIZER_STATS["estimativas_locais"] += 1
        return max(1, int(len(prompt) / CARACTERES_POR_TOKEN) + 1)

    async def estimate_token_count(self, prompt: str) -> int:
        if TOKENIZER_STATS["modo"] == "local":
            return self._estimar_local(prompt)

        try:
            resultado = await self._client.aio.models.count_tokens(
                model=self._model_name,
                contents=prompt,
            )
        except Exception as erro:
            if _e_modelo_indisponivel(erro):
                # Um 404 aqui e definitivo para esta chave: nao adianta repetir.
                TOKENIZER_STATS["count_tokens_404"] += 1
                TOKENIZER_STATS["modo"] = "local"
                TOKENIZER_STATS["motivo_do_fallback"] = (
                    f"count_tokens recusou {self._model_name!r}: {str(erro)[:160]}"
                )
            else:
                TOKENIZER_STATS["count_tokens_outros_erros"] += 1
                TOKENIZER_STATS["modo"] = "local"
                TOKENIZER_STATS["motivo_do_fallback"] = (
                    f"count_tokens falhou para {self._model_name!r}: "
                    f"{type(erro).__name__}: {str(erro)[:160]}"
                )
            return self._estimar_local(prompt)

        TOKENIZER_STATS["count_tokens_ok"] += 1
        return int(getattr(resultado, "total_tokens", 0) or 0)


class PocEmbedder(GeminiTextEmbedding_001):
    """Embedder da POC: mesmo modelo de embedding, tokenizer da POC.

    O embedding continua em `gemini-embedding-001` — e o modelo de embedding da
    conta e nao apresenta 404. O que muda e so quem conta os tokens dele.
    """

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        super().__init__(logger, tracer, meter)
        self._poc_tokenizer = PocEstimatingTokenizer(
            client=self._client, model_name=configured_model()
        )

    @property
    def tokenizer(self) -> EstimatingTokenizer:  # type: ignore[override]
        return self._poc_tokenizer


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

    @property
    def tokenizer(self) -> EstimatingTokenizer:  # type: ignore[override]
        """Mesmo tokenizer guardado do embedder.

        No gerador o adaptador padrao ja usaria o modelo correto, mas passar
        pelos dois caminhos garante que um unico ponto decida qual modelo conta
        tokens — e que um 404 de contagem nunca derrube um turno.
        """
        if not hasattr(self, "_poc_tokenizer"):
            self._poc_tokenizer = PocEstimatingTokenizer(
                client=self._client, model_name=self.model_name
            )
        return self._poc_tokenizer

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

    async def get_embedder(self, hints: EmbedderHints = {}) -> Any:
        """Embedder da POC: o padrao conta tokens em `gemini-2.5-flash` (404)."""
        return PocEmbedder(self.logger, self._tracer, self._meter)


def gemini_flash_only(container: Container) -> NLPService:
    """Factory no formato esperado por `parlant.sdk.Server(nlp_service=...)`."""
    if error := GeminiFlashOnlyService.verify_environment():
        raise RuntimeError(error)

    return GeminiFlashOnlyService(container[Logger], container[Tracer], container[Meter])
