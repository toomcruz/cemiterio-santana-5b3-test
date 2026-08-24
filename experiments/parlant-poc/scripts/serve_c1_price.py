#!/usr/bin/env python
"""Servidor auxiliar do smoke C1: Parlant real com o agente mínimo de preço.

O SDK do Parlant 3.3.2 inicia o servidor apenas quando o bloco
`async with p.Server(...)` é encerrado. Por isso o cliente de smoke roda em
outro processo: este arquivo configura o agente, entrega o controle ao
servidor e é encerrado pelo pai com SIGTERM após a validação.
"""

from __future__ import annotations

import asyncio
import os
import sys

from fastapi import FastAPI

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from santana_parlant_poc.lab.server import (  # noqa: E402
    MODE_PARLANT,
    LabState,
    create_router,
    gemini_key_present,
)

PORT = int(os.environ.get("LAB_PORT", "8801"))


async def main() -> None:
    if not gemini_key_present():
        raise RuntimeError("GEMINI_API_KEY ausente no processo do servidor C1.")

    import parlant.sdk as p

    from santana_parlant_poc.agent.build import build_c1_price_agent
    from santana_parlant_poc.agent.nlp import gemini_flash_only

    state = LabState(mode=MODE_PARLANT, parlant_port=PORT)

    async def configure_api(app: FastAPI) -> None:
        app.include_router(create_router(state))

    # Em Parlant 3.3.2, ao encerrar este bloco o SDK processa a configuração e
    # passa a servir HTTP. O processo pai aguarda /lab/api/health e depois faz
    # o smoke pela mesma API usada pelo laboratório.
    async with p.Server(
        host="127.0.0.1",
        port=PORT,
        nlp_service=gemini_flash_only,
        configure_api=configure_api,
    ) as server:
        agent, _ = await build_c1_price_agent(server)
        state.agent_id = agent.id


if __name__ == "__main__":
    asyncio.run(main())
