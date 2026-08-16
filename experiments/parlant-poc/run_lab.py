#!/usr/bin/env python
"""Sobe o laboratorio da POC.

    python run_lab.py            # escolhe o modo pela presenca de GEMINI_API_KEY
    python run_lab.py --offline  # forca o modo deterministico (sem LLM)

Pagina de teste: http://localhost:8800/lab
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from fastapi import FastAPI

from santana_parlant_poc.lab.server import (
    MODE_OFFLINE,
    MODE_PARLANT,
    LabState,
    create_offline_app,
    create_router,
    gemini_key_present,
)


def _banner(mode: str, port: int) -> None:
    print("=" * 72)
    print(f"  Santana - POC Parlant (assunto: EXUMACAO)")
    print(f"  Modo .........: {mode}")
    print(f"  GEMINI_API_KEY: {'presente' if gemini_key_present() else 'ausente'}")
    print(f"  Pagina .......: http://localhost:{port}/lab")
    print("=" * 72)


async def _run_parlant(port: int) -> None:
    import parlant.sdk as p

    from santana_parlant_poc.agent.build import build_agent
    from santana_parlant_poc.agent.nlp import gemini_flash_only

    state = LabState(mode=MODE_PARLANT, parlant_port=port)

    async def configure_api(app: FastAPI) -> None:
        app.include_router(create_router(state))

    _banner(MODE_PARLANT, port)

    async with p.Server(
        port=port,
        nlp_service=gemini_flash_only,
        session_store="transient",
        customer_store="transient",
        configure_api=configure_api,
    ) as server:
        agent, _created = await build_agent(server)
        state.agent_id = agent.id
        print(f"  Agente criado: {agent.id}")


def _run_offline(port: int) -> None:
    import uvicorn

    _banner(MODE_OFFLINE, port)
    uvicorn.run(create_offline_app(), host="0.0.0.0", port=port, log_level="info")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Laboratorio da POC Parlant + Gemini")
    parser.add_argument("--port", type=int, default=8800)
    parser.add_argument("--offline", action="store_true", help="forca o modo sem LLM")
    args = parser.parse_args(argv)

    if args.offline or not gemini_key_present():
        if not args.offline:
            print("GEMINI_API_KEY ausente: subindo o laboratorio em modo deterministico.")
        _run_offline(args.port)
        return 0

    asyncio.run(_run_parlant(args.port))
    return 0


if __name__ == "__main__":
    sys.exit(main())
