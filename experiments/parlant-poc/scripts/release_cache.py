"""Ferramenta de linha de comando do cache de release, usada pelo workflow.

O runner do GitHub Actions e efemero: sem um passo explicito de restore/save, o
`PARLANT_HOME` comeca vazio em toda execucao e a indexacao inteira e refeita —
foram 991,8s no run 32146735829, dos quais 15m17s so em `Evaluating entities`.

Este script existe porque essas decisoes nao podem morar dentro de um `run:` de
YAML: elas precisam de teste.

    python scripts/release_cache.py id
        Imprime o `release_id`. E a chave do cache, e so ela: cache de outra
        release nunca serve.

    python scripts/release_cache.py verificar
        Confere o que o restore trouxe. Diretorio ausente e cold start normal
        (codigo 0, "cold"). Diretorio presente mas com marcador ausente,
        ilegivel, de outra release ou em construcao inacabada e falha fechada
        (codigo 1) — o indice nao pode ser usado.

    python scripts/release_cache.py publicavel
        Codigo 0 somente se a release foi construida ate o fim e publicada.
        E o que autoriza o passo de save: cache so e guardado depois de
        construcao completa e valida.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from santana_parlant_poc import release  # noqa: E402


def _id() -> int:
    print(release.release_id())
    return 0


def _verificar() -> int:
    identificador = release.release_id()
    home = release.raiz_das_releases() / identificador

    if not home.exists() or not any(home.iterdir()):
        print(f"cold: nenhum cache restaurado para {identificador}")
        return 0

    try:
        marcador = release._ler_marcador(home)
    except release.CacheDeReleaseInvalido as erro:
        print(f"CACHE INVALIDO: {erro}")
        return 1

    if marcador["release_id"] != identificador:
        print(
            f"CACHE DE OUTRA RELEASE: o diretorio diz {marcador['release_id']!r}, "
            f"esperado {identificador!r}"
        )
        return 1

    if marcador["estado"] != release.ESTADO_PRONTA:
        print(
            f"CACHE INCOMPLETO: estado {marcador['estado']!r} — a construcao anterior "
            "nao terminou"
        )
        return 1

    arquivos = sum(1 for _ in home.rglob("*") if _.is_file())
    print(f"warm: cache valido de {identificador} ({arquivos} arquivos)")
    return 0


def _publicavel() -> int:
    identificador = release.release_id()
    home = release.raiz_das_releases() / identificador
    if not home.exists():
        print("nada a salvar: a release nao chegou a ser construida")
        return 1
    try:
        marcador = release._ler_marcador(home)
    except release.CacheDeReleaseInvalido as erro:
        print(f"nada a salvar: {erro}")
        return 1
    if marcador["estado"] != release.ESTADO_PRONTA:
        print(f"nada a salvar: release em estado {marcador['estado']!r}")
        return 1
    print(f"publicavel: {identificador}")
    return 0


COMANDOS = {"id": _id, "verificar": _verificar, "publicavel": _publicavel}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in COMANDOS:
        print(__doc__)
        return 2
    return COMANDOS[sys.argv[1]]()


if __name__ == "__main__":
    raise SystemExit(main())
