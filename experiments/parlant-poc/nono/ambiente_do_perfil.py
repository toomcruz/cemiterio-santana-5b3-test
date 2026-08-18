"""Aplica o filtro de ambiente do perfil e executa um comando com ele.

Nao substitui o Nono: o Nono aplica isso no kernel, junto com filesystem e
rede. Isto e o pedaco que da para reproduzir sem o Nono instalado — util para
provar, em CI ou em container, que a suite passa com um ambiente sem nenhuma
chave, e para testar o filtro antes de rodar de verdade.

Uso:
    python nono/ambiente_do_perfil.py -- .venv/bin/python -m pytest -q
    python nono/ambiente_do_perfil.py --mostrar
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

from validar_perfil import sem_comentarios  # noqa: E402

PERFIL = AQUI / "santana-parlant-lab.jsonc"


def _casa(nome: str, padrao: str) -> bool:
    return nome == padrao or (padrao.endswith("*") and nome.startswith(padrao[:-1]))


def ambiente_filtrado(base: dict[str, str] | None = None) -> dict[str, str]:
    """Precedencia do Nono: deny_vars vence allow_vars; allow_vars fecha o resto."""
    perfil = json.loads(sem_comentarios(PERFIL.read_text(encoding="utf-8")))
    ambiente = perfil.get("environment") or {}
    permitidas = ambiente.get("allow_vars") or []
    negadas = ambiente.get("deny_vars") or []

    saida = {}
    for nome, valor in (base if base is not None else os.environ).items():
        if any(_casa(nome, p) for p in negadas):
            continue
        if permitidas and not any(_casa(nome, p) for p in permitidas):
            continue
        saida[nome] = valor
    for nome, valor in (ambiente.get("set_vars") or {}).items():
        # `$WORKDIR` do Nono e o diretorio de lancamento: a raiz do repositorio.
        saida[nome] = valor.replace("$WORKDIR", str(AQUI.parent.parent.parent))
    return saida


def main() -> int:
    argumentos = sys.argv[1:]
    if argumentos[:1] == ["--mostrar"]:
        for nome in sorted(ambiente_filtrado()):
            print(nome)
        return 0
    if argumentos[:1] == ["--"]:
        argumentos = argumentos[1:]
    if not argumentos:
        print(__doc__)
        return 2
    os.execvpe(argumentos[0], argumentos, ambiente_filtrado())


if __name__ == "__main__":
    raise SystemExit(main())
