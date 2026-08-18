"""Micro-benchmark do cache de indexacao por release (offline, sem Gemini).

Mede o que o run 32146735829 tornou impossivel ignorar: subir o agente custa
mais que o turno. Aqui o custo aparece em chamadas ao provider — que no caminho
real seriam chamadas ao Gemini, cada uma pagando o rate limit.

Sobe o mesmo agente duas vezes, **cada uma no seu processo**, porque o servidor
do Parlant so encerra por sinal e dois ciclos no mesmo interpretador mediriam o
desligamento junto:

  cold  — release nova, `PARLANT_HOME` vazio, indexacao inteira;
  warm  — mesma release, cache no lugar.

Uso:
    python scripts/bench_release.py
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

SAIDA = RAIZ / "bench-release.json"


async def _medir_no_filho(porta: int) -> None:
    """Sobe o agente uma vez e imprime o custo. Roda no processo filho."""
    import parlant.sdk as p

    from santana_parlant_poc.agent.build import build_agent
    from santana_parlant_poc.synthetic.nlp import CONTROLE, synthetic_nlp_service

    CONTROLE.reset(20260817)
    inicio = time.perf_counter()

    async with p.Server(
        port=porta,
        nlp_service=synthetic_nlp_service,
        session_store="transient",
        customer_store="transient",
    ) as servidor:
        await build_agent(servidor)
        medida = {
            "duracao_s": round(time.perf_counter() - inicio, 3),
            "chamadas": CONTROLE.chamadas,
            "embeddings": CONTROLE.embeddings,
        }
        print("MEDIDA " + json.dumps(medida), flush=True)
        # O servidor do Parlant so sai por sinal; sem isto o `async with` nunca
        # devolve o controle.
        os.kill(os.getpid(), signal.SIGINT)


def _rodar_filho(home: Path, porta: int) -> dict[str, float]:
    ambiente = dict(os.environ, PARLANT_HOME=str(home), BENCH_MODO="filho", BENCH_PORT=str(porta))
    processo = subprocess.run(
        [sys.executable, "-u", str(Path(__file__).resolve())],
        env=ambiente,
        capture_output=True,
        text=True,
        timeout=900,
    )
    for linha in processo.stdout.splitlines():
        if linha.startswith("MEDIDA "):
            return json.loads(linha[len("MEDIDA ") :])
    raise RuntimeError(
        f"medida nao encontrada (codigo {processo.returncode}):\n{processo.stdout[-1500:]}"
    )


def main() -> int:
    from santana_parlant_poc import release

    identificador = release.release_id()
    porta = int(os.environ.get("BENCH_PORT", "8890"))

    fria = release.preparar(identificador, limpo=True)
    medida_fria = _rodar_filho(fria.home, porta)
    fria.marcar_pronta()

    quente = release.preparar(identificador)
    if not quente.reaproveitada:
        raise RuntimeError("a segunda preparacao tinha de reaproveitar a release")
    medida_quente = _rodar_filho(quente.home, porta + 1)

    # O que ficou no disco depois do cold: e este arquivo que o warm reaproveita.
    cache = fria.home / "evaluation_cache.json"
    estado_do_cache = {
        "arquivo": cache.name,
        "existe": cache.exists(),
        "bytes": cache.stat().st_size if cache.exists() else 0,
    }

    poupadas = medida_fria["chamadas"] - medida_quente["chamadas"]
    delta = medida_fria["duracao_s"] - medida_quente["duracao_s"]
    relatorio = {
        "release_id": identificador,
        "cold": medida_fria,
        "warm": medida_quente,
        "diferenca_absoluta_s": round(delta, 3),
        "diferenca_percentual": (
            round(100 * delta / medida_fria["duracao_s"], 1) if medida_fria["duracao_s"] else 0.0
        ),
        "chamadas_evitadas": poupadas,
        "chamadas_evitadas_percentual": (
            round(100 * poupadas / medida_fria["chamadas"], 1) if medida_fria["chamadas"] else 0.0
        ),
        "embeddings_evitados": medida_fria["embeddings"] - medida_quente["embeddings"],
        "cache_apos_cold": estado_do_cache,
        "limite_da_medicao": (
            "MEDIDO: o home da release carrega estado reutilizavel entre boots — o warm "
            "refaz zero das operacoes de embedding do cold. NAO MEDIDO: a economia do lado "
            "da geracao. Com o provider sintetico `Evaluating entities` sai de graca, e o "
            "`evaluation_cache.json` termina praticamente vazio; entao os 15m17s que essa "
            "etapa custou no run real 32146735829 nao aparecem aqui nem para mais nem para "
            "menos. So um run real com a mesma release mede isso."
        ),
    }
    SAIDA.write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 70)
    print("MICRO-BENCHMARK — cache de indexacao por release")
    print("=" * 70)
    print(f"release_id ...............: {identificador}")
    print(f"cold  ....................: {medida_fria['duracao_s']:.2f}s, "
          f"{medida_fria['chamadas']} chamadas, {medida_fria['embeddings']} embeddings")
    print(f"warm  ....................: {medida_quente['duracao_s']:.2f}s, "
          f"{medida_quente['chamadas']} chamadas, {medida_quente['embeddings']} embeddings")
    print(f"diferenca ................: {relatorio['diferenca_absoluta_s']:.2f}s "
          f"({relatorio['diferenca_percentual']}%)")
    print(f"chamadas evitadas ........: {poupadas} "
          f"({relatorio['chamadas_evitadas_percentual']}%)")
    print(f"embeddings evitados ......: {relatorio['embeddings_evitados']}")
    print(f"cache apos o cold ........: {estado_do_cache['arquivo']} "
          f"({estado_do_cache['bytes']} bytes)")
    print("limite da medicao ........: MEDIDO o reuso de embeddings entre boots.")
    print("                            NAO MEDIDO a economia de geracao: com provider")
    print("                            sintetico `Evaluating entities` sai de graca.")
    print(f"relatorio ................: {SAIDA.name}")
    return 0


if __name__ == "__main__":
    if os.environ.get("BENCH_MODO") == "filho":
        try:
            asyncio.run(_medir_no_filho(int(os.environ.get("BENCH_PORT", "8890"))))
        except KeyboardInterrupt:
            pass
        raise SystemExit(0)
    raise SystemExit(main())
