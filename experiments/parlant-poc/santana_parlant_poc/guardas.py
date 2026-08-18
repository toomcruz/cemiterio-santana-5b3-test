"""Guardas de resposta compartilhadas pelo laboratorio sintetico e pelo smoke real.

Ficam fora de `synthetic/` de proposito: importar o runner sintetico so para
usar uma funcao traria junto o `PARLANT_HOME` isolado dele, que sobrescreveria o
do smoke real e reintroduziria o bug do cache de avaliacao entre execucoes.
"""

from __future__ import annotations

import json
import re
from typing import Any, Mapping, Sequence

# Token numerico completo (de "R$ 351,67" extrai "351,67"), para rastrear origem.
_TOKEN_NUMERICO = re.compile(r"\d[\d.,]*")


def numeros_sem_origem_em_tool(
    resposta: str, chamadas: Sequence[Mapping[str, Any]]
) -> list[str]:
    """Numeros da resposta que nao aparecem em nenhum resultado de tool do turno.

    Enquanto a base nao publicava valor nenhum, "resposta com digito" bastava
    como sinal de invencao. Com a tabela tarifaria carregada, uma resposta
    legitima pode conter `R$ 351,67` — e o criterio passou a ser origem: o
    numero exibido ao municipe tem de estar no que a tool devolveu. Numero que o
    modelo escreveu sozinho continua sendo preco inventado.
    """
    if not resposta:
        return []
    fonte = json.dumps([c.get("result") for c in chamadas], ensure_ascii=False)
    return [
        token
        for token in _TOKEN_NUMERICO.findall(resposta)
        if token.strip(".,") and token.strip(".,") not in fonte
    ]
