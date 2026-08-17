"""Estado limpo por execucao — precisa ser importado antes de `parlant.sdk`.

O Parlant guarda no `PARLANT_HOME` um cache de avaliacao (`evaluation_cache.json`)
com o resultado da indexacao de guidelines e journeys. Reaproveitar esse cache
entre execucoes torna a bateria dependente do que sobrou de rodadas anteriores:
foi assim que o mapa de transicoes da Journey ficou congelado vazio, e a Journey
nunca saia do primeiro estado por mais que o provider respondesse certo.

Uma validacao reproduzivel comeca do zero. `PARLANT_HOME` e definido aqui, na
importacao, porque `parlant.bin.server` le a variavel no momento em que e
importado — depois disso, mudar a variavel nao tem efeito.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path


def _definir_home() -> Path:
    escolhido = os.environ.get("SYNTHETIC_PARLANT_HOME")
    if escolhido:
        destino = Path(escolhido)
        if destino.exists() and os.environ.get("SYNTHETIC_KEEP_HOME") != "1":
            shutil.rmtree(destino)
        destino.mkdir(parents=True, exist_ok=True)
    else:
        destino = Path(tempfile.mkdtemp(prefix="parlant-synthetic-"))
    os.environ["PARLANT_HOME"] = str(destino)
    return destino


PARLANT_HOME = _definir_home()
