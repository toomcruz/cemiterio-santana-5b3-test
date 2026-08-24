#!/usr/bin/env python
"""Smoke do caminho real C1: API do Parlant + Gemini + tool determinística.

O Parlant 3.3.2 só começa a atender HTTP quando termina o bloco de
configuração do SDK. O smoke, portanto, sobe o servidor configurado em um
processo auxiliar e conversa com ele pela API `/lab/api/chat`, a mesma usada
pela página do laboratório. Após a evidência ser coletada, o processo auxiliar
recebe SIGTERM e o Uvicorn encerra normalmente.

Exige `GEMINI_API_KEY` no ambiente (no CI, vem do secret `PARLANT`). Nenhum
valor de chave é impresso.

    python scripts/smoke_parlant.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

MENSAGENS = ("quanto custa?",)

PORT = int(os.environ.get("LAB_PORT", "8801"))
BASE_URL = f"http://127.0.0.1:{PORT}"
ROOT = Path(__file__).resolve().parent.parent
SERVER_SCRIPT = ROOT / "scripts" / "serve_c1_price.py"

# Limites internos, curtos e diagnósticos. O workflow mantém um teto externo
# apenas como última proteção contra travamento do runner.
READY_TIMEOUT_S = int(os.environ.get("POC_C1_READY_TIMEOUT_S", "150"))
TURN_TIMEOUT_S = float(os.environ.get("POC_C1_TURN_TIMEOUT_S", "180"))
STOP_TIMEOUT_S = float(os.environ.get("POC_C1_STOP_TIMEOUT_S", "15"))


def _key_present() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


async def _wait_for_server(process: asyncio.subprocess.Process) -> None:
    """Espera a API real ficar disponível ou expõe a falha do servidor cedo."""
    started = time.monotonic()
    next_report = 0.0

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=5.0) as client:
        while (elapsed := time.monotonic() - started) < READY_TIMEOUT_S:
            if process.returncode is not None:
                raise RuntimeError(
                    f"Servidor Parlant encerrou antes de ficar pronto (exit {process.returncode})."
                )

            try:
                response = await client.get("/lab/api/health")
                if response.status_code == 200:
                    health = response.json()
                    if health.get("agent_id") and health.get("mode") == "parlant-gemini":
                        print(f"Servidor Parlant pronto em {elapsed:.1f}s.", flush=True)
                        return
            except (httpx.HTTPError, ValueError):
                pass

            if elapsed >= next_report:
                print(
                    f"Aguardando o servidor Parlant ficar pronto ({elapsed:.0f}s/{READY_TIMEOUT_S}s)...",
                    flush=True,
                )
                next_report += 15.0
            await asyncio.sleep(1)

    raise TimeoutError(
        f"Servidor Parlant não ficou pronto em {READY_TIMEOUT_S}s. "
        "O limite interno encerrou o smoke antes de consumir o teto do workflow."
    )


async def _probe() -> int:
    falhas: list[str] = []
    session = "smoke"

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=TURN_TIMEOUT_S) as client:
        for mensagem in MENSAGENS:
            response = await client.post(
                "/lab/api/chat",
                json={"session_id": session, "message": mensagem},
            )
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            rastro: dict[str, Any] = payload["trace"]

            print("\n>>>", mensagem, flush=True)
            print("<<<", payload["reply"], flush=True)
            print(
                "    ",
                json.dumps(
                    {
                        "modo": payload["mode"],
                        "ms": payload["latency_ms"],
                        "guidelines": rastro["guidelines"],
                        "journey": rastro["journey_states"],
                        "tools": [c["tool"] for c in rastro["tool_calls"]],
                        "fallback": rastro["fallback"],
                        "erro": rastro["error"],
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )

            if not payload["reply"] or payload["reply"].startswith("(sem resposta"):
                falhas.append(f"sem resposta para: {mensagem}")
            if rastro["error"]:
                falhas.append(f"erro no turno '{mensagem}': {rastro['error']}")

            if mensagem == "quanto custa?":
                chamadas_preco = [
                    chamada
                    for chamada in rastro["tool_calls"]
                    if chamada["tool"] == "consultar_preco_exumacao"
                ]
                if not chamadas_preco:
                    falhas.append("C1 não chamou consultar_preco_exumacao")
                else:
                    resultado = chamadas_preco[-1].get("result") or {}
                    # Sem contexto o Gateway não escolhe uma tarifa. Nesse caso
                    # números na resposta seriam um valor inventado pelo modelo.
                    if (
                        resultado.get("status") == "NEEDS_CONTEXT"
                        and any(char.isdigit() for char in payload["reply"])
                    ):
                        falhas.append(
                            "C1 exibiu número mesmo com a consulta de preço pedindo contexto"
                        )

    if falhas:
        print("\nFALHAS:", flush=True)
        for falha in falhas:
            print(" -", falha, flush=True)
    else:
        print(
            "\nOK: API real respondeu, chamou a tool de preço e não inventou tarifa sem contexto.",
            flush=True,
        )

    return 1 if falhas else 0


async def _stop_server(process: asyncio.subprocess.Process) -> bool:
    """Encerra o Uvicorn auxiliar sem sinalizar o próprio processo do smoke."""
    if process.returncode is None:
        print("Encerrando servidor auxiliar...", flush=True)
        process.terminate()

    try:
        returncode = await asyncio.wait_for(process.wait(), timeout=STOP_TIMEOUT_S)
    except TimeoutError:
        print("Servidor auxiliar não encerrou no prazo; forçando término.", flush=True)
        process.kill()
        returncode = await process.wait()

    if returncode == 0:
        print("Servidor auxiliar encerrado normalmente.", flush=True)
        return True

    print(f"Servidor auxiliar terminou com exit {returncode}.", flush=True)
    return False


async def main() -> int:
    if not _key_present():
        print("GEMINI_API_KEY ausente: smoke do caminho Parlant+Gemini não executado.")
        return 2
    if not SERVER_SCRIPT.is_file():
        print(f"Servidor auxiliar ausente: {SERVER_SCRIPT}")
        return 2

    env = os.environ.copy()
    env["LAB_PORT"] = str(PORT)
    env["PYTHONUNBUFFERED"] = "1"

    process: asyncio.subprocess.Process | None = None
    code = 1
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            str(SERVER_SCRIPT),
            cwd=str(ROOT),
            env=env,
        )
        await _wait_for_server(process)
        code = await _probe()
    except Exception as error:
        print(f"\nFALHA DO SMOKE: {type(error).__name__}: {error}", flush=True)
        code = 1
    finally:
        if process is not None and not await _stop_server(process):
            code = 1

    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
