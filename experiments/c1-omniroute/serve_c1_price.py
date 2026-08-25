#!/usr/bin/env python
"""Servidor auxiliar do smoke C1 via Omniroute local (LiteLLM).

Substitui o serve_c1_price.py da POC Gemini no runner self-hosted.
Nao chama Google direto. Exige LITELLM_PROVIDER_* apontando para
http://127.0.0.1:20128/v1. Nao imprime chave.
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
)

PORT = int(os.environ.get("LAB_PORT", "8801"))


def _litellm_ready() -> bool:
    return bool(os.environ.get("LITELLM_PROVIDER_API_KEY", "").strip()) and bool(
        os.environ.get("LITELLM_PROVIDER_BASE_URL", "").strip()
    ) and bool(os.environ.get("LITELLM_PROVIDER_MODEL_NAME", "").strip())


async def main() -> None:
    if not _litellm_ready():
        raise RuntimeError(
            "LITELLM_PROVIDER_API_KEY/BASE_URL/MODEL_NAME ausentes no processo C1 Omniroute."
        )

    # Garante que nenhum caminho residual tente Google Gemini direto.
    os.environ.pop("GEMINI_API_KEY", None)
    os.environ.pop("GOOGLE_API_KEY", None)

    # Overlay do lab/server.py: espera ready+completed (nao o preambulo).
    # Este script roda em experiments/parlant-poc/scripts/; o arquivo
    # lab_server.py e copiado para santana_parlant_poc/lab/server.py no job.
    import parlant.sdk as p

    from omniroute_nlp import CONTADOR, servico_omniroute
    from santana_parlant_poc.agent.build import build_c1_price_agent

    CONTADOR.fase = "inicializacao"
    CONTADOR.teto = int(os.environ.get("C1_TETO_CHAMADAS", "250"))

    state = LabState(mode=MODE_PARLANT, parlant_port=PORT)

    async def configure_api(app: FastAPI) -> None:
        app.include_router(create_router(state))

    async with p.Server(
        host="127.0.0.1",
        port=PORT,
        nlp_service=servico_omniroute,
        configure_api=configure_api,
    ) as server:
        CONTADOR.fase = "turno"
        agent, _ = await build_c1_price_agent(server)
        state.agent_id = agent.id


if __name__ == "__main__":
    asyncio.run(main())
