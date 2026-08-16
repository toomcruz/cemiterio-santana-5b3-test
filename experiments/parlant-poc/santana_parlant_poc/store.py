"""Estado em memoria do laboratorio (nao persiste nada, nao usa banco).

Guarda, por sessao de chat: o case deterministico de EXUMACAO e o rastro
(guidelines ativadas, estado da journey, tools chamadas, fallbacks).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from .domain.authority import ExhumationCase


@dataclass
class TurnTrace:
    """Rastro de um turno de conversa, exibido no laboratorio."""

    guidelines: list[str] = field(default_factory=list)
    journey_states: list[str] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    fallback: str | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "guidelines": list(dict.fromkeys(self.guidelines)),
            "journey_states": list(dict.fromkeys(self.journey_states)),
            "tool_calls": self.tool_calls,
            "fallback": self.fallback,
            "error": self.error,
        }


class LabStore:
    """Um case + um rastro corrente por sessao."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cases: dict[str, ExhumationCase] = {}
        self._traces: dict[str, TurnTrace] = {}
        self._created_at: dict[str, float] = {}

    def case(self, session_id: str) -> ExhumationCase:
        with self._lock:
            if session_id not in self._cases:
                self._cases[session_id] = ExhumationCase(case_id=f"case-{session_id}")
                self._created_at[session_id] = time.time()
            return self._cases[session_id]

    def trace(self, session_id: str) -> TurnTrace:
        with self._lock:
            if session_id not in self._traces:
                self._traces[session_id] = TurnTrace()
            return self._traces[session_id]

    def start_turn(self, session_id: str) -> TurnTrace:
        with self._lock:
            trace = TurnTrace()
            self._traces[session_id] = trace
            return trace

    def record_guideline(self, session_id: str, label: str) -> None:
        self.trace(session_id).guidelines.append(label)

    def record_journey_state(self, session_id: str, label: str) -> None:
        self.trace(session_id).journey_states.append(label)

    def record_tool_call(self, session_id: str, name: str, args: dict[str, Any], result: Any) -> None:
        self.trace(session_id).tool_calls.append(
            {"tool": name, "arguments": args, "result": result}
        )

    def record_fallback(self, session_id: str, reason: str) -> None:
        self.trace(session_id).fallback = reason

    def record_error(self, session_id: str, error: str) -> None:
        self.trace(session_id).error = error

    def reset(self, session_id: str) -> None:
        with self._lock:
            self._cases.pop(session_id, None)
            self._traces.pop(session_id, None)
            self._created_at.pop(session_id, None)

    def sessions(self) -> list[str]:
        with self._lock:
            return sorted(self._cases)


STORE = LabStore()
