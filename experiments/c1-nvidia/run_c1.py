#!/usr/bin/env python
"""C1 real: Parlant + NVIDIA, uma unica mensagem, um unico turno.

    mensagem do municipe
      -> Parlant real
      -> NVIDIA (decisao autonoma de ferramenta)
      -> consultar_preco_exumacao()
      -> Santana Authority Gateway
      -> NEEDS_CONTEXT
      -> resposta controlada

Nao ha `tool_choice` forcado em lugar nenhum: as tools sao registradas pelo
build da POC e a escolha e do modelo. Nenhum preco pode aparecer na resposta.

Codigo de saida 0 = C1 PASS. Qualquer outro = FAIL.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
from typing import Any

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

MENSAGEM = "Quanto custa a exumação?"
PORT = int(os.environ.get("C1_PORT", "8811"))
TEMPO_MAXIMO_TURNO = float(os.environ.get("C1_TURNO_TIMEOUT", "300"))
RELATORIO = os.environ.get("C1_RELATORIO", "c1-nvidia-report.json")

# As tres tarifas reais da base. Nenhuma pode chegar ao municipe nesta C1.
TARIFAS_PROIBIDAS = ("106,57", "351,67", "586,04")

RESULTADO: dict[str, Any] = {"codigo": 1, "relatorio": {}}
T_INICIO: float = time.perf_counter()


def _falhar(falhas: list[str], condicao: bool, mensagem: str) -> None:
    if not condicao:
        falhas.append(mensagem)


async def _executar(server: Any, agente_id: str) -> tuple[int, dict[str, Any]]:
    import httpx

    from nvidia_nlp import CONTADOR
    from santana_parlant_poc import guardas
    from santana_parlant_poc.gateway import GATEWAY
    from santana_parlant_poc.store import STORE
    from santana_parlant_poc import turnos

    await server.ready.wait()
    t_init_fim = time.perf_counter()

    # A partir daqui, toda chamada e do turno.
    CONTADOR.fase = "turno"

    async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{PORT}", timeout=60.0) as cliente:
        sessao = await turnos.nova_sessao(cliente, agente_id, "C1-preco")
        resultado = await turnos.rodar_turno(
            cliente,
            sessao,
            MENSAGEM,
            categoria="pergunta_preco",
            conversa="C1",
            tempo_maximo=TEMPO_MAXIMO_TURNO,
        )

    historico = STORE.tool_history(sessao)
    resposta = resultado.resposta or ""
    tools_chamadas = [t["nome_curto"] for t in resultado.tools]
    argumentos = {t["nome_curto"]: t["argumentos"] for t in resultado.tools}

    # Estado devolvido pelo Gateway na chamada de preco, se houve.
    gateway: dict[str, Any] = {}
    for chamada in historico:
        if chamada["tool"] == "consultar_preco_exumacao":
            gateway = chamada["result"] or {}
            break

    numeros_sem_origem = guardas.numeros_sem_origem_em_tool(resposta, historico)
    tarifas_vazadas = [t for t in TARIFAS_PROIBIDAS if t in resposta]

    falhas: list[str] = []
    _falhar(falhas, resultado.erro is None, f"turno com erro: {resultado.erro}")
    _falhar(falhas, bool(resposta), "resposta final vazia")
    _falhar(
        falhas,
        "G_PRECO" in resultado.guidelines,
        f"G_PRECO nao casou (guidelines: {resultado.guidelines})",
    )
    _falhar(
        falhas,
        "consultar_preco_exumacao" in tools_chamadas,
        f"tool de preco nao foi escolhida (tools: {tools_chamadas})",
    )
    _falhar(
        falhas,
        argumentos.get("consultar_preco_exumacao") in ({}, None),
        f"tool de preco recebeu argumentos: {argumentos.get('consultar_preco_exumacao')!r}",
    )
    _falhar(
        falhas,
        "__missing__" not in json.dumps(argumentos, ensure_ascii=False),
        "argumento __missing__ presente",
    )
    _falhar(
        falhas,
        gateway.get("status") == "NEEDS_CONTEXT",
        f"Gateway devolveu {gateway.get('status')!r}, esperado NEEDS_CONTEXT",
    )
    _falhar(
        falhas,
        list(gateway.get("contexto_faltante") or []) == ["modalidade_tarifaria"],
        f"contexto_faltante inesperado: {gateway.get('contexto_faltante')}",
    )
    _falhar(falhas, not tarifas_vazadas, f"tarifa exibida ao municipe: {tarifas_vazadas}")
    _falhar(
        falhas,
        not numeros_sem_origem,
        f"numero sem origem em tool na resposta: {numeros_sem_origem}",
    )
    from santana_parlant_poc.agent import tools as agent_tools

    tools_proibidas = [t for t in tools_chamadas if t not in set(agent_tools.TOOL_NAMES)]
    _falhar(falhas, not tools_proibidas, f"tool fora do conjunto permitido: {tools_proibidas}")

    relatorio = {
        "mensagem": MENSAGEM,
        "modelo": os.environ.get("LITELLM_PROVIDER_MODEL_NAME"),
        "release_id": GATEWAY.release_id,
        "no_think": True,
        "tool_choice_forcado": False,
        "guidelines": resultado.guidelines,
        "journey_estados": resultado.journey,
        "tools": [
            {"tool": t["nome_curto"], "argumentos": t["argumentos"]} for t in resultado.tools
        ],
        "gateway": {
            "status": gateway.get("status"),
            "motivo": gateway.get("motivo"),
            "source_id": gateway.get("source_id"),
            "contexto_faltante": gateway.get("contexto_faltante"),
            "opcoes_possiveis": gateway.get("opcoes_possiveis"),
        },
        "resposta_final": resposta,
        "preambulos": resultado.preambulos,
        "gates": {
            "tarifa_exibida": len(tarifas_vazadas),
            "numeros_sem_origem": len(numeros_sem_origem),
            "tool_proibida": len(tools_proibidas),
        },
        "latencia": {
            "inicializacao_s": round(t_init_fim - T_INICIO, 2),
            "turno_s": round(resultado.duracao, 2),
        },
        "chamadas_nvidia": CONTADOR.resumo(),
        "chamadas_detalhe_turno": [
            {
                "indice": c.indice,
                "duracao_s": round(c.duracao_s, 2),
                "tokens_entrada": c.tokens_entrada,
                "tokens_saida": c.tokens_saida,
                "erro": c.erro,
            }
            for c in CONTADOR.por_fase("turno")
        ],
        "erros_http": [c.erro for c in CONTADOR.chamadas if c.erro],
        "retries": 0,
        "falhas": falhas,
    }
    return (0 if not falhas else 1), relatorio


async def main() -> int:
    global T_INICIO
    T_INICIO = time.perf_counter()
    if not os.environ.get("LITELLM_PROVIDER_API_KEY"):
        print("LITELLM_PROVIDER_API_KEY ausente: C1 nao executada.", file=sys.stderr)
        return 2

    import parlant.sdk as p

    from nvidia_nlp import CONTADOR, TetoDeChamadasEstourado, servico_nvidia
    from santana_parlant_poc.agent import spec
    from santana_parlant_poc.agent.build import build_agent
    from santana_parlant_poc import turnos

    CONTADOR.fase = "inicializacao"
    CONTADOR.teto = int(os.environ.get("C1_TETO_CHAMADAS", "250"))

    try:
        async with p.Server(port=PORT, nlp_service=servico_nvidia) as server:
            agente, criados = await build_agent(server)
            turnos.mapear_ids(criados, spec.JOURNEY.get("conditions", ()))

            async def runner() -> None:
                try:
                    codigo, relatorio = await _executar(server, agente.id)
                    RESULTADO["codigo"] = codigo
                    RESULTADO["relatorio"] = relatorio
                except TetoDeChamadasEstourado as erro:
                    RESULTADO["codigo"] = 3
                    RESULTADO["relatorio"] = {
                        "abortado": str(erro),
                        "chamadas_nvidia": CONTADOR.resumo(),
                    }
                except Exception as erro:  # noqa: BLE001
                    RESULTADO["codigo"] = 4
                    RESULTADO["relatorio"] = {
                        "excecao": f"{type(erro).__name__}: {erro}",
                        "chamadas_nvidia": CONTADOR.resumo(),
                    }
                finally:
                    os.kill(os.getpid(), signal.SIGINT)

            asyncio.create_task(runner())
    except TetoDeChamadasEstourado as erro:
        RESULTADO["codigo"] = 3
        RESULTADO["relatorio"] = {
            "abortado": str(erro),
            "chamadas_nvidia": CONTADOR.resumo(),
        }

    return RESULTADO["codigo"]


def _imprimir(relatorio: dict[str, Any], codigo: int) -> None:
    with open(RELATORIO, "w", encoding="utf-8") as arquivo:
        json.dump(relatorio, arquivo, ensure_ascii=False, indent=2)

    print("\n================ C1 NVIDIA ================")
    print(json.dumps(relatorio, ensure_ascii=False, indent=2))
    print("==========================================")
    resumo = relatorio.get("chamadas_nvidia", {})
    print(f"CHAMADAS NVIDIA TOTAIS: {resumo.get('total')}")
    print(f"  inicializacao: {(resumo.get('inicializacao') or {}).get('chamadas')}")
    print(f"  turno:         {(resumo.get('turno') or {}).get('chamadas')}")
    print("C1 PASS" if codigo == 0 else "C1 FAIL")


if __name__ == "__main__":
    try:
        codigo = asyncio.run(main())
    except KeyboardInterrupt:
        codigo = RESULTADO["codigo"]
    _imprimir(RESULTADO.get("relatorio") or {}, codigo)
    sys.exit(codigo)
