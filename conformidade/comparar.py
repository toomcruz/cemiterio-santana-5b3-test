#!/usr/bin/env python3
"""Comparador de conformidade: implementacao de referencia x Gateway TS/Deno.

Vive em `conformidade/` porque nao pertence a nenhuma das duas implementacoes.
Ele nao conhece Python nem TypeScript: le dois relatorios e dois despejos e
compara.

O que ele exige
---------------
1. as duas implementacoes rodaram o MESMO conjunto de `vector_id`;
2. as duas reportam 47 PASS, 0 FAIL, 0 INVALIDO;
3. o resultado de cada caso e identico nas duas;
4. `por_vetor` identico nas duas;
5. a saida REAL canonizada de cada caso e identica **byte a byte**, e o mesmo
   para as escritas observadas e para o `release_id` de cada caso.

Sobre o rigor de cada exigencia, sendo honesto: como a comparacao de cada caso
contra o esperado ja e TOTAL, dois PASS implicam saidas iguais. As exigencias
1 a 4 servem para pegar caso ausente, `INVALIDO` e excecao — situacoes em que
uma implementacao nao chega a comparar nada. A exigencia 5 e a que compara o
que cada uma realmente emitiu, sem passar pelo esperado, e e ela que pega
deriva de formato em campo que nenhum vetor cobre hoje.

Uso:
    python3 conformidade/comparar.py \\
        --relatorio referencia=a.json --relatorio ts=b.json \\
        --despejo   referencia=c.json --despejo   ts=d.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CASOS_ESPERADOS = 47


def _ler(caminho: str) -> Any:
    return json.loads(Path(caminho).read_text(encoding="utf-8"))


def _par(valor: str) -> tuple[str, str]:
    nome, _, caminho = valor.partition("=")
    if not nome or not caminho:
        raise argparse.ArgumentTypeError(f"esperado nome=caminho, recebido {valor!r}")
    return nome, caminho


def comparar(relatorios: dict[str, Any], despejos: dict[str, Any]) -> list[str]:
    divergencias: list[str] = []
    nomes = sorted(relatorios)
    if len(nomes) != 2:
        return [f"esperados exatamente dois relatorios, recebidos {len(nomes)}"]
    a, b = nomes

    for nome in nomes:
        rel = relatorios[nome]
        if rel["total_de_casos"] != CASOS_ESPERADOS:
            divergencias.append(
                f"{nome}: {rel['total_de_casos']} casos, esperados {CASOS_ESPERADOS}"
            )
        if rel["fail"] or rel["invalido"]:
            divergencias.append(
                f"{nome}: {rel['fail']} FAIL e {rel['invalido']} INVALIDO; exigido zero"
            )
        if rel["pass"] != CASOS_ESPERADOS:
            divergencias.append(f"{nome}: {rel['pass']} PASS, esperados {CASOS_ESPERADOS}")

    ids = {nome: {c["vector_id"] for c in relatorios[nome]["casos"]} for nome in nomes}
    if ids[a] != ids[b]:
        so_a = sorted(ids[a] - ids[b])
        so_b = sorted(ids[b] - ids[a])
        divergencias.append(f"conjunto de vector_id difere: so em {a}={so_a}, so em {b}={so_b}")

    resultados = {
        nome: {c["vector_id"]: c["resultado"] for c in relatorios[nome]["casos"]} for nome in nomes
    }
    for vector_id in sorted(ids[a] & ids[b]):
        if resultados[a][vector_id] != resultados[b][vector_id]:
            divergencias.append(
                f"{vector_id}: {a}={resultados[a][vector_id]} vs {b}={resultados[b][vector_id]}"
            )

    if relatorios[a]["por_vetor"] != relatorios[b]["por_vetor"]:
        divergencias.append(
            f"por_vetor difere: {a}={relatorios[a]['por_vetor']} vs {b}={relatorios[b]['por_vetor']}"
        )

    if despejos:
        if set(despejos) != set(nomes):
            divergencias.append(f"despejos {sorted(despejos)} nao batem com relatorios {nomes}")
        else:
            chaves_a, chaves_b = set(despejos[a]), set(despejos[b])
            if chaves_a != chaves_b:
                divergencias.append(
                    f"despejo: conjunto de casos difere, so em {a}={sorted(chaves_a - chaves_b)}, "
                    f"so em {b}={sorted(chaves_b - chaves_a)}"
                )
            for vector_id in sorted(chaves_a & chaves_b):
                for campo in ("saida", "escritas", "release_id"):
                    va = despejos[a][vector_id][campo]
                    vb = despejos[b][vector_id][campo]
                    if va != vb:
                        divergencias.append(
                            f"{vector_id}.{campo} difere byte a byte:\n"
                            f"  {a}: {va}\n"
                            f"  {b}: {vb}"
                        )
    return divergencias


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--relatorio", action="append", type=_par, required=True)
    parser.add_argument("--despejo", action="append", type=_par, default=[])
    args = parser.parse_args()

    relatorios = {nome: _ler(caminho) for nome, caminho in args.relatorio}
    despejos = {nome: _ler(caminho) for nome, caminho in args.despejo}

    divergencias = comparar(relatorios, despejos)
    if divergencias:
        print("CONFORMIDADE: DIVERGENTE")
        for d in divergencias:
            print(f"  - {d}")
        return 1

    nomes = " x ".join(sorted(relatorios))
    print(f"CONFORMIDADE: IDENTICA ({nomes})")
    print(f"  casos: {CASOS_ESPERADOS}  PASS: {CASOS_ESPERADOS}  FAIL: 0  INVALIDO: 0")
    if despejos:
        total = sum(len(d) for d in despejos.values()) // len(despejos)
        print(f"  saida real comparada byte a byte em {total} casos: identica")
    return 0


if __name__ == "__main__":
    sys.exit(main())
