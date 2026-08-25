"""Servidor do laboratorio (overlay Fase 4 / Omniroute).

Copia do lab/server.py da POC Gemini, com um unico ajuste critico:

o turno Parlant emite um preambulo cedo (`ready` sem stage) e so depois
chama tools / responde. Esperar a primeira mensagem `ai_agent` captura so
o preambulo ("Deixa eu verificar") e o smoke falha com tools=[].

Este overlay espera `status=ready` com `stage=completed` (mesmo padrao de
`scripts/micro_smoke.py` e `santana_parlant_poc/turnos.py`), depois coleta
a resposta final e as tool events. Nao imprime chave. Lab only.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from ..store import STORE
from .fallback import DeterministicLab

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

MODE_PARLANT = "parlant-gemini"
MODE_OFFLINE = "offline-deterministico"

TURN_TIMEOUT_S = float(os.environ.get("POC_LAB_TURN_TIMEOUT_S", "180"))
STATUS_WAIT_S = int(os.environ.get("POC_LAB_STATUS_WAIT_S", "30"))


def gemini_key_present() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str


class LabState:
    """Contexto compartilhado entre a pagina e o agente."""

    def __init__(self, mode: str, parlant_port: int = 8800) -> None:
        self.mode = mode
        self.parlant_port = parlant_port
        self.agent_id: str | None = None
        self.session_map: dict[str, str] = {}
        self.deterministic = DeterministicLab(STORE)

    async def _parlant_session(self, client: httpx.AsyncClient, lab_session: str) -> str:
        if lab_session in self.session_map:
            return self.session_map[lab_session]
        response = await client.post(
            "/sessions",
            json={"agent_id": self.agent_id, "title": f"lab-{lab_session}"},
            params={"allow_greeting": False},
        )
        response.raise_for_status()
        session_id = response.json()["id"]
        self.session_map[lab_session] = session_id
        return session_id

    async def _esperar_turno_completo(
        self, client: httpx.AsyncClient, session_id: str, offset: int
    ) -> tuple[bool, dict[str, Any]]:
        """Espera ready+completed; nao encerra no preambulo."""
        cursor = offset + 1
        limite = time.perf_counter() + TURN_TIMEOUT_S
        while time.perf_counter() < limite:
            resposta = await client.get(
                f"/sessions/{session_id}/events",
                params={
                    "min_offset": cursor,
                    "kinds": "status",
                    "wait_for_data": STATUS_WAIT_S,
                },
            )
            if resposta.status_code == 504:
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
                    return False, interno if isinstance(interno, dict) else {}
                if estado == "ready" and interno.get("stage") == "completed":
                    return True, interno if isinstance(interno, dict) else {}
        return False, {}

    async def _turn_parlant(self, lab_session: str, message: str) -> dict[str, Any]:
        base = f"http://127.0.0.1:{self.parlant_port}"
        async with httpx.AsyncClient(base_url=base, timeout=TURN_TIMEOUT_S + 30.0) as client:
            session_id = await self._parlant_session(client, lab_session)
            STORE.start_turn(session_id)

            created = await client.post(
                f"/sessions/{session_id}/events",
                json={"kind": "message", "source": "customer", "message": message},
            )
            created.raise_for_status()
            offset = created.json()["offset"]

            concluiu, _estado = await self._esperar_turno_completo(client, session_id, offset)
            if not concluiu:
                STORE.record_error(
                    session_id,
                    "turno nao chegou a ready com stage='completed'",
                )

            reply = ""
            # Coleta pos-turno: resposta final (nao preamble) + tools oficiais.
            events = await client.get(
                f"/sessions/{session_id}/events",
                params={"min_offset": offset + 1, "wait_for_data": 0},
            )
            if events.status_code == 200:
                for event in events.json():
                    data = event.get("data") or {}
                    if not isinstance(data, dict):
                        continue
                    if event.get("kind") == "message" and event.get("source") == "ai_agent":
                        texto = data.get("message") or ""
                        if not texto:
                            continue
                        if "__preamble__" in (data.get("tags") or []):
                            continue
                        reply = texto
                    elif event.get("kind") == "tool":
                        for chamada in data.get("tool_calls", []) or []:
                            nome = str(chamada.get("tool_id", "?"))
                            STORE.record_tool_call(
                                session_id,
                                nome.rsplit(":", 1)[-1],
                                chamada.get("arguments") or chamada.get("args") or {},
                                (chamada.get("result") or {}).get("data"),
                            )
            else:
                STORE.record_error(
                    session_id,
                    f"falha ao coletar eventos do turno (HTTP {events.status_code})",
                )

            if not concluiu and not reply:
                STORE.record_error(session_id, "sem resposta do agente (turno incompleto)")

            trace = STORE.trace(session_id).as_dict()
            return {
                "session_id": lab_session,
                "engine_session_id": session_id,
                "reply": reply or "(sem resposta do agente)",
                "trace": trace,
                "case": STORE.case(session_id).snapshot(),
            }

    def _turn_offline(self, lab_session: str, message: str) -> dict[str, Any]:
        result = self.deterministic.respond(lab_session, message)
        return {
            "session_id": lab_session,
            "engine_session_id": lab_session,
            "reply": result.text,
            "trace": STORE.trace(lab_session).as_dict(),
            "case": STORE.case(lab_session).snapshot(),
        }

    async def turn(self, lab_session: str, message: str) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            if self.mode == MODE_PARLANT:
                payload = await self._turn_parlant(lab_session, message)
            else:
                payload = self._turn_offline(lab_session, message)
        except Exception as exc:  # rastro do laboratorio: erro nunca vira resposta inventada
            payload = {
                "session_id": lab_session,
                "engine_session_id": lab_session,
                "reply": (
                    "Tive um problema tecnico agora. Nao vou adivinhar nada: pode repetir, "
                    "por favor?"
                ),
                "trace": {
                    "guidelines": [],
                    "journey_states": [],
                    "tool_calls": [],
                    "fallback": "erro no motor de conversa",
                    "error": f"{type(exc).__name__}: {exc}",
                },
                "case": STORE.case(lab_session).snapshot(),
            }
        payload["mode"] = self.mode
        payload["latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return payload


def create_router(state: LabState) -> APIRouter:
    router = APIRouter(prefix="/lab")

    @router.get("/")
    async def index() -> FileResponse:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    @router.get("/api/health")
    async def health() -> JSONResponse:
        return JSONResponse(
            {
                "mode": state.mode,
                "gemini_key_present": gemini_key_present(),
                "agent_id": state.agent_id,
            }
        )

    @router.post("/api/chat")
    async def chat(request: ChatRequest) -> JSONResponse:
        lab_session = request.session_id or f"lab-{uuid.uuid4().hex[:8]}"
        payload = await state.turn(lab_session, request.message)
        return JSONResponse(payload)

    @router.post("/api/reset")
    async def reset(request: ChatRequest) -> JSONResponse:
        lab_session = request.session_id or "lab"
        engine_session = state.session_map.pop(lab_session, lab_session)
        STORE.reset(engine_session)
        STORE.reset(lab_session)
        return JSONResponse({"ok": True, "session_id": lab_session})

    return router
