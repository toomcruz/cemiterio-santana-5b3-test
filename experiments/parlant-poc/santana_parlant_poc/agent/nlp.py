"""NLP service da POC: Gemini sem `gemini-2.5-pro`.

O adaptador padrao do Parlant usa `gemini-2.5-pro` para tarefas grandes (e como
fallback do Flash). A API responde 404 para esse modelo em chaves novas:

    404 NOT_FOUND ... 'This model models/gemini-2.5-pro is no longer available
    to new users.'

Como a chave desta POC (`PARLANT`) e nova, o servico abaixo mapeia todos os
tamanhos de modelo para a familia Flash. Nada alem da escolha de modelo muda:
a autoridade das regras continua fora do LLM.
"""

from __future__ import annotations

from typing import Any

from lagom import Container
from parlant.adapters.nlp.gemini_service import (
    Gemini_2_5_Flash,
    Gemini_2_5_Flash_Lite,
    GeminiService,
)
from parlant.core.loggers import Logger
from parlant.core.meter import Meter
from parlant.core.nlp.service import ModelSize, NLPService, SchematicGeneratorHints
from parlant.core.tracer import Tracer

# Mapa explicito e testavel: nenhuma entrada aponta para um modelo "pro".
MODEL_BY_SIZE = {
    ModelSize.NANO: Gemini_2_5_Flash_Lite,
    ModelSize.MINI: Gemini_2_5_Flash,
    ModelSize.LARGE: Gemini_2_5_Flash,
    ModelSize.AUTO: Gemini_2_5_Flash,
}


class GeminiFlashOnlyService(GeminiService):
    """GeminiService restrito a modelos Flash."""

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
