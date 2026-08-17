"""Maquina de turnos do laboratorio, compartilhada pelos dois provedores.

Este modulo existe para que a validacao sintetica e o smoke real conversem com
o Parlant pelo mesmo codigo. Cada regra aqui saiu de um bug observado, e
duplicar isso em dois scripts seria reintroduzir o bug de um lado so:

* o turno so termina no `ready` com `stage="completed"` — o Parlant emite um
  `ready` logo apos o preambulo, e encerrar nele fazia a mensagem seguinte
  cancelar o processamento em andamento;
* o payload do status vem aninhado em `data`, e o evento final carrega
  `matched_guidelines`, `matched_journeys` e `matched_journey_states`;
* a resposta final e a ultima mensagem sem a tag `__preamble__`;
* os argumentos da tool sao lidos de `arguments` e de `args`;
* o texto chega com escape unicode, as vezes duplo.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .store import STORE

# id interno do Parlant -> chave da POC, para o rastro sair legivel.
MAPA_IDS: dict[str, dict[str, str]] = {
    "guidelines": {},
    "journey_states": {},
    "journey_conditions": {},
}

_ESCAPE_UNICODE = re.compile(r"\\+u([0-9a-fA-F]{4})")


def desescapar(texto: str) -> str:
    """Desfaz escape unicode, simples ou duplo (`\\u00e7` -> `ç`)."""
    return _ESCAPE_UNICODE.sub(lambda achado: chr(int(achado.group(1), 16)), texto or "")


def legivel(dominio: str, identificador: Any) -> str:
    bruto = str(identificador)
    if bruto in MAPA_IDS[dominio]:
        return MAPA_IDS[dominio][bruto]
    # Guideline projetada de um no da journey: "journey_node:<no>[:<aresta>]".
    if bruto.startswith("journey_node:"):
        no = bruto.split(":")[1]
        return f"ESTADO:{MAPA_IDS['journey_states'].get(no, no)}"
    return MAPA_IDS["journey_conditions"].get(bruto, bruto)


def mapear_ids(criados: dict[str, Any], condicoes_da_journey: Any = ()) -> None:
    """Traduz os ids que o Parlant devolve para as chaves declaradas na POC."""
    MAPA_IDS["guidelines"] = {
        str(getattr(objeto, "id", objeto)): chave
        for chave, objeto in criados["guidelines"].items()
    }
    MAPA_IDS["journey_states"] = {
        str(getattr(objeto, "id", objeto)): chave
        for chave, objeto in criados["journey_states"].items()
    }
    MAPA_IDS["journey_conditions"] = {
        str(identificador): f"J_CONDICAO_{indice}"
        for indice, identificador in enumerate(condicoes_da_journey, start=1)
    }


@dataclass
class ResultadoTurno:
    conversa: str
    categoria: str
    mensagem: str
    resposta: str = ""
    preambulos: list[str] = field(default_factory=list)
    mensagens: list[str] = field(default_factory=list)
    guidelines: list[str] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    journey: list[str] = field(default_factory=list)
    journeys_ativas: int = 0
    duracao: float = 0.0
    erro: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "conversa": self.conversa,
            "categoria": self.categoria,
            "mensagem": self.mensagem,
            "preambulos": self.preambulos,
            "mensagens": self.mensagens,
            "resposta_final": self.resposta,
            "guidelines": self.guidelines,
            "journey_estados": self.journey,
            "journeys_ativas": self.journeys_ativas,
            "tools": self.tools,
            "latencia_s": round(self.duracao, 2),
            "erro": self.erro,
        }


async def esperar_turno(
    cliente: httpx.AsyncClient, sessao: str, offset: int, tempo_maximo: float
) -> tuple[bool, dict[str, Any]]:
    """Espera o turno terminar de verdade e devolve o payload do evento final."""
    cursor = offset + 1
    limite = time.perf_counter() + tempo_maximo
    while time.perf_counter() < limite:
        resposta = await cliente.get(
            f"/sessions/{sessao}/events",
            params={"min_offset": cursor, "kinds": "status", "wait_for_data": 10},
        )
        if resposta.status_code == 504:  # long-poll sem novidade
            continue
        resposta.raise_for_status()
        for evento in resposta.json():
            cursor = max(cursor, evento["offset"] + 1)
            dados = evento.get("data") or {}
            if not isinstance(dados, dict):
                continue
            estado = dados.get("status")
            interno = dados.get("data") if isinstance(dados.get("data"), dict) else {}
            if estado in ("error", "cancelled"):
                return False, interno
            if estado == "ready" and interno.get("stage") == "completed":
                return True, interno
    return False, {}


async def nova_sessao(cliente: httpx.AsyncClient, agente_id: str, titulo: str) -> str:
    criacao = await cliente.post(
        "/sessions",
        json={"agent_id": agente_id, "title": titulo},
        params={"allow_greeting": False},
    )
    criacao.raise_for_status()
    return criacao.json()["id"]


async def rodar_turno(
    cliente: httpx.AsyncClient,
    sessao: str,
    texto: str,
    categoria: str,
    conversa: str,
    tempo_maximo: float,
) -> ResultadoTurno:
    resultado = ResultadoTurno(
        conversa=conversa, categoria=categoria, mensagem=texto
    )
    inicio = time.perf_counter()
    STORE.start_turn(sessao)

    try:
        evento = await cliente.post(
            f"/sessions/{sessao}/events",
            json={"kind": "message", "source": "customer", "message": texto},
        )
        evento.raise_for_status()
        offset = evento.json()["offset"]

        concluiu, estado_final = await esperar_turno(cliente, sessao, offset, tempo_maximo)
        if not concluiu:
            resultado.erro = "turno nao chegou a ready com stage='completed'"
        else:
            resultado.guidelines = [
                legivel("guidelines", item.get("id"))
                for item in estado_final.get("matched_guidelines", [])
            ]
            resultado.journey = [
                legivel("journey_states", item.get("id"))
                for item in estado_final.get("matched_journey_states", [])
            ]
            resultado.journeys_ativas = len(estado_final.get("matched_journeys", []))

            eventos = await cliente.get(
                f"/sessions/{sessao}/events",
                params={"min_offset": offset + 1, "wait_for_data": 0},
            )
            eventos.raise_for_status()
            for item in eventos.json():
                dados = item.get("data") or {}
                if not isinstance(dados, dict):
                    continue
                if item["kind"] == "message" and item.get("source") == "ai_agent":
                    corpo = desescapar(dados.get("message") or "")
                    if not corpo:
                        continue
                    if "__preamble__" in (dados.get("tags") or []):
                        resultado.preambulos.append(corpo)
                    else:
                        resultado.mensagens.append(corpo)
                        resultado.resposta = corpo
                elif item["kind"] == "tool":
                    for chamada in dados.get("tool_calls", []):
                        nome = str(chamada.get("tool_id", "?"))
                        resultado.tools.append(
                            {
                                "tool": nome,
                                "nome_curto": nome.rsplit(":", 1)[-1],
                                "argumentos": chamada.get("arguments")
                                or chamada.get("args"),
                                "retorno": (chamada.get("result") or {}).get("data"),
                            }
                        )
    except Exception as erro:  # falha de transporte nao pode derrubar a bateria
        resultado.erro = f"{type(erro).__name__}: {erro}"

    # O `on_match` da POC entra como complemento do rastro oficial.
    rastro = STORE.trace(sessao).as_dict()
    for chave in rastro["guidelines"]:
        if chave not in resultado.guidelines:
            resultado.guidelines.append(chave)
    for chave in rastro["journey_states"]:
        if chave not in resultado.journey:
            resultado.journey.append(chave)

    resultado.duracao = time.perf_counter() - inicio
    return resultado
