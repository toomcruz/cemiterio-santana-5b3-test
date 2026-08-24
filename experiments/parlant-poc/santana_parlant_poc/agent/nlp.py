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
import hashlib
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
from parlant.core.nlp.embedding import BaseEmbedder, EmbeddingResult
from parlant.core.nlp.generation import SchematicGenerationResult
from parlant.core.nlp.service import EmbedderHints, ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.nlp.tokenization import EstimatingTokenizer
from parlant.core.tracer import Tracer

DEFAULT_MODEL = "gemini-3.7-flash"

# Requests por minuto.
#
# Nao ha tabela por modelo aqui de proposito. A versao anterior tinha uma, com
# valores que ninguem mediu, e `gemini-3.1-flash-lite` simplesmente nao estava
# nela: caiu no fallback de 5 rpm, e o run 32146735829 gastou 1176 dos seus 1180
# segundos esperando o limiter (98 chamadas x 12 s). Um numero inventado que
# "quase" acerta e pior que a ausencia dele, porque nao aparece em lugar nenhum.
#
# `RPM_FAIL_SAFE` e a unica constante, e ela e deliberadamente conservadora: e o
# que sobra quando ninguem configurou nada. O valor real da chave e configuracao
# explicita, via `POC_GEMINI_RPM`, e o smoke real EXIGE que ela venha declarada
# (`exigir_rpm_declarado`).
RPM_FAIL_SAFE = 5

# Retentativa apos 429. Zero por padrao: um 429 encerra o teste em vez de
# continuar consumindo cota. `POC_GEMINI_RETRIES_429` permite subir quando a
# execucao for de producao, nao de teste.
DEFAULT_RETRIES_ON_429 = 0

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


def rpm_declarado() -> int | None:
    """RPM vindo de `POC_GEMINI_RPM`, ou `None` quando nao foi declarado."""
    bruto = os.environ.get("POC_GEMINI_RPM", "").strip()
    if not bruto:
        return None
    try:
        return max(1, int(bruto))
    except ValueError as erro:
        raise ValueError(
            f"POC_GEMINI_RPM invalido: {bruto!r}. Use um inteiro de requests por minuto."
        ) from erro


def configured_rpm(model_name: str) -> int:
    """RPM efetivo. Declarado vence; senao, o fail-safe conservador."""
    declarado = rpm_declarado()
    return declarado if declarado is not None else RPM_FAIL_SAFE


def exigir_rpm_declarado() -> int:
    """Usado pelos caminhos que gastam cota: sem declaracao, nao roda.

    O fail-safe de 5 rpm existe para nao estourar quota por acidente, nao para
    ser o valor de trabalho. Deixa-lo silenciosamente em vigor foi o que
    transformou um turno de 15 chamadas em 20 minutos de espera.
    """
    declarado = rpm_declarado()
    if declarado is None:
        raise RuntimeError(
            "POC_GEMINI_RPM nao declarado. Este caminho consome cota e o RPM precisa ser "
            "explicito: declare o limite real da chave no workflow. "
            f"Sem declaracao o fail-safe seria {RPM_FAIL_SAFE} rpm "
            f"({60 / RPM_FAIL_SAFE:.0f}s por chamada, serializado)."
        )
    return declarado


def configured_retries_on_429() -> int:
    bruto = os.environ.get("POC_GEMINI_RETRIES_429", "").strip()
    if not bruto:
        return DEFAULT_RETRIES_ON_429
    try:
        return max(0, int(bruto))
    except ValueError:
        return DEFAULT_RETRIES_ON_429


# Tempo total que os limiters passaram esperando, e quantas esperas houve. E o
# que separa "o Parlant esta lento" de "estamos serializados no rate limit" — sem
# esse numero, os dois se parecem no relogio.
THROTTLE_STATS = {"espera_s": 0.0, "esperas": 0, "chamadas": 0}


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
        THROTTLE_STATS["chamadas"] += 1
        if wait:
            THROTTLE_STATS["espera_s"] += wait
            THROTTLE_STATS["esperas"] += 1
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


class LocalPocTokenizer(EstimatingTokenizer):
    """Contagem local para o índice interno da POC, sem chamada ao Gemini."""

    async def estimate_token_count(self, prompt: str) -> int:
        return max(1, int(len(prompt) / CARACTERES_POR_TOKEN) + 1)


class PocLocalEmbedder(BaseEmbedder):
    """Embedding determinístico, somente para o índice interno do laboratório.

    O C1 valida o Gemini no caminho que decide interpretação e tool call.
    Embeddings servem apenas para o Parlant localizar as entidades já criadas.
    Usar a API Gemini também neste passo fazia sete chamadas adicionais antes
    do primeiro turno e esgotava a cota gratuita, sem aumentar a evidência do
    teste C1. Este vetor por n-gramas é local, reproduzível e não existe fora
    desta POC isolada.
    """

    _DIMENSIONS = 3072

    def __init__(self, logger: Logger, tracer: Tracer, meter: Meter) -> None:
        super().__init__(
            logger,
            tracer,
            meter,
            "local-poc-ngram-embedding",
        )
        self._tokenizer = LocalPocTokenizer()

    @property
    def id(self) -> str:
        return "local/poc-ngram-embedding"

    @property
    def tokenizer(self) -> EstimatingTokenizer:
        return self._tokenizer

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def dimensions(self) -> int:
        return self._DIMENSIONS

    @staticmethod
    def _features(text: str) -> list[str]:
        normalized = re.sub(r"[^a-z0-9áàâãéêíóôõúç ]+", " ", text.lower())
        words = [word for word in normalized.split() if word]
        features = list(words)
        for word in words:
            padded = f"^{word}$"
            features.extend(padded[index : index + 3] for index in range(len(padded) - 2))
        return features or ["_"]

    async def do_embed(
        self,
        texts: list[str],
        hints: Mapping[str, Any] = {},
    ) -> EmbeddingResult:
        vectors: list[list[float]] = []
        for text in texts:
            vector = [0.0] * self._DIMENSIONS
            for feature in self._features(text):
                digest = hashlib.sha256(feature.encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "big") % self._DIMENSIONS
                vector[index] += 1.0 if digest[4] % 2 else -1.0
            length = sum(value * value for value in vector) ** 0.5
            if length:
                vector = [value / length for value in vector]
            vectors.append(vector)
        return EmbeddingResult(vectors=vectors)


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

        for _ in range(1 + configured_retries_on_429()):
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
        """Índice local da POC; Gemini fica reservado ao caminho decisório real."""
        return PocLocalEmbedder(self.logger, self._tracer, self._meter)


def gemini_flash_only(container: Container) -> NLPService:
    """Factory no formato esperado por `parlant.sdk.Server(nlp_service=...)`."""
    if error := GeminiFlashOnlyService.verify_environment():
        raise RuntimeError(error)

    return GeminiFlashOnlyService(container[Logger], container[Tracer], container[Meter])
