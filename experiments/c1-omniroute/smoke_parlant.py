#!/usr/bin/env python
"""Smoke C1 via Omniroute local (self-hosted), sem Google Gemini direto.

Copia do smoke_parlant.py da POC, com duas mudancas:
1. Exige LITELLM_PROVIDER_API_KEY (nao GEMINI_API_KEY).
2. Sobe o serve_c1_price.py overlaid (LiteLLM → Omniroute).

Nao imprime chave. Lab only.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import sys
import time
from pathlib import Path
from typing import Any

import httpx

MENSAGENS = ("quanto custa?",)

# Detecta tarifa/preço inventado em PT-BR sob NEEDS_CONTEXT.
# NÃO dispara em listas numeradas (1. / 2) / "opção 3") nem em contagens sem dinheiro.
# Numero sem R$/real(is) so conta se houver lexico monetario proximo.
_NUM_BR = r"\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?"
_RE_RS = re.compile(
    rf"(?<!\w)R\$\s*{_NUM_BR}(?!\w)",
    re.IGNORECASE,
)
# "real" (singular) e "reais" (plural) — NÃO "reai".
_RE_REAIS = re.compile(
    rf"(?<!\w){_NUM_BR}\s*rea(?:l|is)\b",
    re.IGNORECASE,
)
# Lexico monetario → numero (janela curta, sem exigir unidade).
_RE_LEXICO_NUM = re.compile(
    rf"(?i)\b(?:custa|custo|valor|pre[cç]o|tarifa|sai\s+por|fica\s+em)\b"
    rf"[^\d]{{0,24}}{_NUM_BR}(?!\w)"
)


def reply_mentions_tarifa(reply: str) -> bool:
    """True se a resposta ao usuário parecer citar valor monetário/tarifa."""
    if not reply:
        return False
    return bool(
        _RE_RS.search(reply)
        or _RE_REAIS.search(reply)
        or _RE_LEXICO_NUM.search(reply)
    )


PORT = int(os.environ.get("LAB_PORT", "8801"))
BASE_URL = f"http://127.0.0.1:{PORT}"
ROOT = Path(__file__).resolve().parent.parent
# No workflow, este arquivo e copiado para experiments/parlant-poc/scripts/.
# O servidor auxiliar fica ao lado da POC (overlaid).
SERVER_SCRIPT = ROOT / "scripts" / "serve_c1_price.py"

READY_TIMEOUT_S = int(os.environ.get("POC_C1_READY_TIMEOUT_S", "150"))
TURN_TIMEOUT_S = float(os.environ.get("POC_C1_TURN_TIMEOUT_S", "180"))
STOP_TIMEOUT_S = float(os.environ.get("POC_C1_STOP_TIMEOUT_S", "15"))


def _key_present() -> bool:
    return bool(os.environ.get("LITELLM_PROVIDER_API_KEY", "").strip())


async def _wait_for_server(process: asyncio.subprocess.Process) -> None:
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
                    mode = health.get("mode")
                    if health.get("agent_id") and mode in {
                        "parlant-gemini",
                        "parlant-omniroute",
                        "parlant-litellm",
                    }:
                        print(f"Servidor Parlant pronto em {elapsed:.1f}s (mode={mode}).", flush=True)
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
        f"Servidor Parlant nao ficou pronto em {READY_TIMEOUT_S}s."
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
                guidelines = rastro.get("guidelines") or []
                if "G_PRECO" not in guidelines:
                    falhas.append(
                        "C1 nao ativou guideline G_PRECO "
                        f"(guidelines={guidelines!r})"
                    )

                chamadas_preco = [
                    chamada
                    for chamada in rastro["tool_calls"]
                    if chamada["tool"] == "consultar_preco_exumacao"
                ]
                if not chamadas_preco:
                    falhas.append("C1 nao chamou consultar_preco_exumacao")
                else:
                    resultado = chamadas_preco[-1].get("result") or {}
                    if (
                        resultado.get("status") == "NEEDS_CONTEXT"
                        and reply_mentions_tarifa(payload["reply"])
                    ):
                        falhas.append(
                            "C1 inventou tarifa/preco mesmo com a consulta pedindo contexto"
                        )

    if falhas:
        print("\nFALHAS:", flush=True)
        for falha in falhas:
            print(" -", falha, flush=True)
    else:
        print(
            "\nOK: API real respondeu via Omniroute, ativou G_PRECO, "
            "chamou a tool de preco e nao inventou tarifa sem contexto.",
            flush=True,
        )

    return 1 if falhas else 0


async def _stop_server(process: asyncio.subprocess.Process) -> bool:
    termination_requested = False
    if process.returncode is None:
        print("Encerrando servidor auxiliar...", flush=True)
        termination_requested = True
        process.terminate()

    try:
        returncode = await asyncio.wait_for(process.wait(), timeout=STOP_TIMEOUT_S)
    except TimeoutError:
        print("Servidor auxiliar nao encerrou no prazo; forcando termino.", flush=True)
        process.kill()
        returncode = await process.wait()

    if returncode == 0:
        print("Servidor auxiliar encerrado normalmente.", flush=True)
        return True

    if termination_requested and returncode == -signal.SIGTERM:
        print("Servidor auxiliar encerrou pelo SIGTERM solicitado.", flush=True)
        return True

    print(f"Servidor auxiliar terminou com exit {returncode}.", flush=True)
    return False


async def main() -> int:
    if not _key_present():
        print("LITELLM_PROVIDER_API_KEY ausente: smoke Omniroute nao executado.")
        return 2
    if not SERVER_SCRIPT.is_file():
        print(f"Servidor auxiliar ausente: {SERVER_SCRIPT}")
        return 2

    # Evita caminho Google residual se algum import antigo olhar GEMINI_*.
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GOOGLE_API_KEY", None)

    env = os.environ.copy()
    env["LAB_PORT"] = str(PORT)
    env["PYTHONUNBUFFERED"] = "1"
    env.pop("GEMINI_API_KEY", None)
    env.pop("GOOGLE_API_KEY", None)

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
