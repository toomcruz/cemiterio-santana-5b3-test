"""Servidor do laboratorio: pagina de chat + API de teste.

Dois modos, escolhidos automaticamente:

* `parlant-gemini`  — quando `GEMINI_API_KEY` esta presente. Sobe o servidor
  Parlant com o agente da POC e o NLP service Gemini; a pagina conversa com o
  agente real.
* `offline`         — sem chave. A pagina continua funcionando com o motor
  deterministico (`fallback.py`), e o rastro mostra `fallback`.

Nenhum segredo e impresso: apenas a presenca da variavel e reportada.
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

    # ------------------------------------------------------------- parlant
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

    async def _turn_parlant(self, lab_session: str, message: str) -> dict[str, Any]:
        base = f"http://127.0.0.1:{self.parlant_port}"
        async with httpx.AsyncClient(base_url=base, timeout=180.0) as client:
            session_id = await self._parlant_session(client, lab_session)
            STORE.start_turn(session_id)

            created = await client.post(
                f"/sessions/{session_id}/events",
                json={"kind": "message", "source": "customer", "message": message},
            )
            created.raise_for_status()
            offset = created.json()["offset"]

            reply = ""
            events = await client.get(
                f"/sessions/{session_id}/events",
                params={
                    "min_offset": offset + 1,
                    "kinds": "message",
                    "source": "ai_agent",
                    "wait_for_data": 150,
                },
            )
            if events.status_code == 200:
                for event in events.json():
                    data = event.get("data") or {}
                    if isinstance(data, dict) and data.get("message"):
                        reply = data["message"]
            else:
                STORE.record_error(session_id, f"sem resposta do agente (HTTP {events.status_code})")

            trace = STORE.trace(session_id).as_dict()
            return {
                "session_id": lab_session,
                "engine_session_id": session_id,
                "reply": reply or "(sem resposta do agente)",
                "trace": trace,
                "case": STORE.case(session_id).snapshot(),
            }

    # ------------------------------------------------------------- offline
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

    def reset(self, lab_session: str) -> None:
        engine_session = self.session_map.pop(lab_session, lab_session)
        STORE.reset(engine_session)
        STORE.reset(lab_session)


def create_router(state: LabState) -> APIRouter:
    router = APIRouter(prefix="/lab")

    @router.get("", include_in_schema=False)
    @router.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    @router.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "mode": state.mode,
            "gemini_key_present": gemini_key_present(),
            "agent_id": state.agent_id,
        }

    @router.post("/api/chat")
    async def chat(request: ChatRequest) -> JSONResponse:
        session_id = request.session_id or f"lab-{uuid.uuid4().hex[:8]}"
        payload = await state.turn(session_id, request.message)
        return JSONResponse(payload)

    @router.post("/api/reset")
    async def reset(request: ChatRequest) -> dict[str, Any]:
        session_id = request.session_id or ""
        if session_id:
            state.reset(session_id)
        return {"reset": True, "session_id": session_id}

    return router


def create_offline_app() -> FastAPI:
    """App independente do Parlant, para uso sem chave Gemini."""
    app = FastAPI(title="Santana Parlant POC (laboratorio offline)")
    state = LabState(mode=MODE_OFFLINE)
    app.include_router(create_router(state))

    @app.get("/", include_in_schema=False)
    async def root() -> FileResponse:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    app.state.lab = state
    return app
