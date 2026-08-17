#!/usr/bin/env python
"""Inspeciona o schema das Tools pelo caminho real do Parlant 3.3.2 (sem rede).

Motivacao: o run 32069767929 continuou reprovando com `Argument '<x>' is missing`
mesmo depois de `ca02336`, que declarou enums e descricoes nos parametros. Os
testes offline liam o objeto decorado (`ALL_TOOLS[i].tool`) — que nao e o que o
ToolCaller ve. As tools da SDK sao hospedadas num `PluginServer` e lidas de volta
pelo engine via `ServiceRegistry`, atravessando serializacao HTTP.

Este script compara os dois lados:

  A. o descritor local, direto do decorador `@p.tool`;
  B. o descritor que o engine obtem via `ServiceRegistry.read_tool_service(...)`,
     que e a fonte usada para montar o prompt do ToolCaller.

Roda com o provider sintetico: nenhuma chamada a LLM externo.

    python scripts/inspect_tool_schema.py
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("PARLANT_HOME", tempfile.mkdtemp(prefix="parlant-inspect-"))

import parlant.sdk as p  # noqa: E402
from parlant.core.services.tools.service_registry import ServiceRegistry  # noqa: E402

from santana_parlant_poc.agent.build import build_agent  # noqa: E402
from santana_parlant_poc.agent.tools import ALL_TOOLS  # noqa: E402
from santana_parlant_poc.synthetic.nlp import synthetic_nlp_service  # noqa: E402

PORTA = int(os.environ.get("INSPECT_PORT", "8880"))
SAIDA = Path(__file__).resolve().parent.parent / "tool-schema-inspection.json"

INTERESSAM = (
    "consultar_base_autoritativa",
    "registrar_fato",
    "corrigir_fato",
    "registrar_assunto_fora_de_escopo",
)
RESULTADO: dict[str, Any] = {}


def _descritores(tool: Any) -> dict[str, Any]:
    return {nome: dict(descritor) for nome, (descritor, _) in tool.parameters.items()}


async def main() -> int:
    async with p.Server(
        port=PORTA,
        nlp_service=synthetic_nlp_service,
        session_store="transient",
        customer_store="transient",
    ) as server:
        await build_agent(server)

        # A. lado local: o objeto que o decorador produziu.
        local = {t.tool.name: _descritores(t.tool) for t in ALL_TOOLS}

        # B. lado do engine: exatamente o servico que o ToolCaller consulta.
        registro = server.container[ServiceRegistry]
        servico = await registro.read_tool_service("built-in")
        remoto = {t.name: _descritores(t) for t in await servico.list_tools()}

        relatorio: dict[str, Any] = {"tools": {}}
        for nome in INTERESSAM:
            a, b = local.get(nome, {}), remoto.get(nome, {})
            diferencas = {
                parametro: {"local": a.get(parametro), "engine": b.get(parametro)}
                for parametro in sorted(set(a) | set(b))
                if a.get(parametro) != b.get(parametro)
            }
            relatorio["tools"][nome] = {
                "local": a,
                "engine": b,
                "identicos": not diferencas,
                "diferencas": diferencas,
            }

        RESULTADO.update(relatorio)
        SAIDA.write_text(
            json.dumps(relatorio, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )

        print("=" * 74)
        print("SCHEMA DAS TOOLS — decorador (local) x servico lido pelo engine")
        print("=" * 74)
        for nome, dados in relatorio["tools"].items():
            print(f"\n### {nome}  ->  {'IDENTICOS' if dados['identicos'] else 'DIVERGEM'}")
            for parametro in sorted(set(dados["local"]) | set(dados["engine"])):
                print(f"  {parametro}:")
                print(f"    local  : {json.dumps(dados['local'].get(parametro), ensure_ascii=False)[:200]}")
                print(f"    engine : {json.dumps(dados['engine'].get(parametro), ensure_ascii=False)[:200]}")
        print("\n" + "=" * 74)
        perdidos = [n for n, d in relatorio["tools"].items() if not d["identicos"]]
        print(f"tools cujo schema se perde no caminho: {perdidos or 'nenhuma'}")
        print(f"relatorio: {SAIDA.name}")
        print("=" * 74, flush=True)

        os.kill(os.getpid(), signal.SIGINT)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
