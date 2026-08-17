#!/usr/bin/env python
"""Roda a bateria duas vezes com a mesma seed e compara o que precisa bater.

Determinismo aqui nao significa "dois JSONs identicos": tempo de execucao, ids
gerados pelo Parlant e ordem de conclusao das conversas paralelas mudam a cada
execucao por natureza. O que precisa ser estavel e o comportamento observado —
corpus, rastro, tools, journey, gates de autoridade e rede.

As duas execucoes rodam em processos separados de proposito: contadores do
provider e o cache de avaliacao do Parlant sao estado de processo, e reaproveita-los
faria a segunda execucao parecer estavel sem ter sido.

    python scripts/check_determinism.py
    SYNTHETIC_CONVERSATIONS=60 python scripts/check_determinism.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "synthetic-determinism.json"
RELATORIO = RAIZ / "synthetic-validation-report.json"

# Volume de chamadas ao provider: observado e reportado, mas nao e criterio.
# O motor do Parlant agenda lotes em paralelo e reavalia em iteracoes, entao o
# total de chamadas oscila em uma ou duas entre execucoes sem que nada do
# comportamento mude. Divergir aqui nao e o mesmo que divergir de decisao.
OBSERVADAS = ("chamadas_sinteticas", "embeddings_sinteticos", "chamadas_por_schema")

# Chaves cujo valor tem de se repetir entre execucoes com a mesma seed.
COMPARADAS = (
    "conversas",
    "turnos",
    "turnos_com_resposta",
    "turnos_com_erro",
    "categorias",
    "violacoes",
    "guidelines_ativadas",
    "tools_chamadas",
    "journey_estados",
    "casamento_de_guidelines",
    "resultado",
)


def recortar(relatorio: dict) -> dict:
    recorte = {chave: relatorio.get(chave) for chave in COMPARADAS}
    recorte["schemas_encontrados"] = relatorio.get("schemas", {}).get("schemas_encontrados")
    recorte["rede"] = relatorio.get("rede", {}).get("external_network_calls")
    cenarios = relatorio.get("cenarios", {})
    recorte["cenario_relationships"] = cenarios.get("relationships", {}).get("aprovados")
    recorte["cenario_tools"] = cenarios.get("tools", {}).get("aprovados")
    recorte["cenario_journey"] = cenarios.get("journey", {}).get("estados_distintos")
    recorte["cenario_falhas"] = cenarios.get("modos_de_falha", {}).get("violacoes")
    return recorte


def observar(relatorio: dict) -> dict:
    """Metricas de volume: reportadas, fora do criterio."""
    dados = {chave: relatorio.get(chave) for chave in OBSERVADAS}
    dados["chamadas_por_schema"] = relatorio.get("schemas", {}).get("chamadas_por_schema")
    return dados


def executar(porta: int) -> dict:
    ambiente = dict(os.environ, SYNTHETIC_PORT=str(porta))
    processo = subprocess.run(
        [sys.executable, str(RAIZ / "scripts" / "run_synthetic_validation.py")],
        cwd=RAIZ,
        env=ambiente,
        capture_output=True,
        text=True,
    )
    if not RELATORIO.exists():
        raise SystemExit(
            f"execucao na porta {porta} nao gerou relatorio:\n{processo.stdout[-2000:]}\n"
            f"{processo.stderr[-2000:]}"
        )
    return json.loads(RELATORIO.read_text(encoding="utf-8"))


def main() -> int:
    porta = int(os.environ.get("SYNTHETIC_PORT", "8860"))
    relatorio_1 = executar(porta)
    relatorio_2 = executar(porta + 1)
    primeira, segunda = recortar(relatorio_1), recortar(relatorio_2)
    observado_1, observado_2 = observar(relatorio_1), observar(relatorio_2)

    divergencias = {
        chave: {"execucao_1": primeira[chave], "execucao_2": segunda[chave]}
        for chave in primeira
        if primeira[chave] != segunda[chave]
    }
    volume = {
        chave: {"execucao_1": observado_1.get(chave), "execucao_2": observado_2.get(chave)}
        for chave in OBSERVADAS
        if observado_1.get(chave) != observado_2.get(chave)
    }

    saida = {
        "seed": os.environ.get("SYNTHETIC_SEED", "padrao"),
        "conversas": os.environ.get("SYNTHETIC_CONVERSATIONS", "300"),
        "deterministico": not divergencias,
        "divergencias": divergencias,
        "variacao_de_volume_tolerada": volume,
        "execucao_1": primeira,
        "execucao_2": segunda,
    }
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    if divergencias:
        print(f"DETERMINISMO: FAIL — {len(divergencias)} divergencia(s)")
        for chave in divergencias:
            print(f"  divergiu: {chave}")
        return 1

    print("DETERMINISMO: PASS — as duas execucoes coincidem no que importa")
    for chave in volume:
        print(f"  (volume oscilou, fora do criterio: {chave})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
