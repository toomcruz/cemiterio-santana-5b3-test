"""Isolated, *offline-only* proof of a per-conversation OpenBot task router.

This intentionally does not include network, credentials, WhatsApp, or a real
OpenBot client. Integration is gated on independent authorization and audit.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from hmac import new as hmac_new
import re
import sqlite3
from pathlib import Path
from typing import Protocol
from uuid import uuid4

TTL_SECONDS = 300
MAX_OPEN_TASKS = 40  # deliberately below OpenBot's 50-open-task limit
ID_RE = re.compile(r"^lab:[a-z0-9_-]{2,40}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


@dataclass(frozen=True)
class ProviderReceipt:
    message_id: str
    delivery_id: str


class TaskTransport(Protocol):
    lab_only: bool

    def start_task(self, agent_id: str, text: str, client_message_id: str) -> tuple[str, str, ProviderReceipt]: ...

    def send_task(self, agent_id: str, task_id: str, text: str, client_message_id: str) -> ProviderReceipt: ...

    def close_task(self, agent_id: str, task_id: str) -> None: ...


@dataclass(frozen=True)
class DispatchResult:
    state: str  # ACCEPTED, DUPLICATE, UNKNOWN, or NEEDS_RECONCILIATION
    session_id: str
    task_id: str | None
    thread_id: str | None
    delivery_id: str | None
    duplicate: bool = False


class ReconciliationRequired(Exception):
    """A previous attempt may have reached the provider. NEVER auto-retry."""


class IsolationGuard(Exception):
    """Fail closed rather than risk mixed conversations."""


class SessionRouter:
    def __init__(self, db_path: str | Path, key: bytes, transport: TaskTransport,
                 agent_id: str = "sana-lab", ttl: int = TTL_SECONDS) -> None:
        if not isinstance(key, bytes) or len(key) < 32:
            raise IsolationGuard("32+ byte HMAC key required; do not persist it beside the database")
        if not getattr(transport, "lab_only", False):
            raise IsolationGuard("LAB-only transport required; real OpenBot requires separate integration review")
        if ttl <= 0:
            raise ValueError("TTL must be positive")
        self.key, self.transport, self.agent_id, self.ttl = key, transport, agent_id, ttl
        self.db_path = str(db_path)
        self.db = sqlite3.connect(self.db_path, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=10000")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
              session_id TEXT PRIMARY KEY, scope_hash TEXT NOT NULL,
              agent_id TEXT NOT NULL, task_id TEXT, thread_id TEXT,
              opened REAL NOT NULL, expires REAL NOT NULL,
              state TEXT NOT NULL CHECK(state IN ('active','expired','unknown','close_pending'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_session
              ON sessions(scope_hash,agent_id) WHERE state IN ('active','unknown');
            CREATE TABLE IF NOT EXISTS requests (
              operation_key TEXT PRIMARY KEY, scope_hash TEXT NOT NULL,
              payload_hash TEXT NOT NULL, session_id TEXT NOT NULL,
              state TEXT NOT NULL CHECK(state IN ('reserved','accepted','completed','failed','unknown')),
              delivery_id TEXT, message_id TEXT, created REAL NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(session_id)
            );
            CREATE INDEX IF NOT EXISTS requests_session_idx ON requests(session_id);
        """)

    def close(self) -> None:
        self.db.close()

    def _scope(self, conversation_id: str) -> str:
        if not ID_RE.fullmatch(conversation_id):
            raise IsolationGuard("only synthetic LAB conversation IDs are allowed")
        return hmac_new(self.key, f"santana-lab|{conversation_id}".encode(), "sha256").hexdigest()

    def sweep_expired(self, now: float) -> int:
        """Close only terminal, expired tasks; keep failures as close_pending.

        The 40-task guard counts failures as still open. A 202 or missing result
        does not permit closing an OpenBot task.
        """
        self.db.execute("BEGIN IMMEDIATE")
        try:
            rows=self.db.execute("""SELECT s.session_id, s.task_id FROM sessions s
                WHERE (s.state='active' AND s.expires<=? OR s.state='close_pending')
                AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.session_id=s.session_id
                    AND r.state NOT IN ('completed','failed'))
                LIMIT ?""",(now,MAX_OPEN_TASKS)).fetchall()
            for row in rows:
                self.db.execute("UPDATE sessions SET state='close_pending' WHERE session_id=?",(row['session_id'],))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        closed=0
        for row in rows:
            if not row["task_id"]:
                continue
            try:
                self.transport.close_task(self.agent_id,row["task_id"])
            except Exception:
                continue  # stays close_pending and counts against capacity
            self.db.execute("UPDATE sessions SET state='expired' WHERE session_id=? AND state='close_pending'",
                            (row['session_id'],))
            closed+=1
        return closed

    def submit(self, conversation_id: str, text: str, operation_key: str, now: float) -> DispatchResult:
        """Reserve before dispatch; any uncertain transport outcome blocks further work."""
        scope = self._scope(conversation_id)
        if not KEY_RE.fullmatch(operation_key):
            raise IsolationGuard("invalid idempotency key")
        if not isinstance(text, str) or not text.strip() or len(text) > 3000:
            raise IsolationGuard("empty or oversized LAB prompt")
        payload_hash = sha256(text.encode()).hexdigest()
        # Bounded cleanup before capacity checks; the mock transport is offline.
        self.sweep_expired(now)
        created_new = False
        self.db.execute("BEGIN IMMEDIATE")
        try:
            old = self.db.execute("SELECT * FROM requests WHERE operation_key=?", (operation_key,)).fetchone()
            if old:
                if old["scope_hash"] != scope or old["payload_hash"] != payload_hash:
                    raise IsolationGuard("idempotency key reused with different conversation or text")
                session = self.db.execute("SELECT * FROM sessions WHERE session_id=?", (old["session_id"],)).fetchone()
                if old["state"] in ("reserved", "unknown"):
                    raise ReconciliationRequired("previous request has uncertain outcome")
                result = DispatchResult("DUPLICATE", session["session_id"], session["task_id"],
                                        session["thread_id"], old["delivery_id"], True)
                self.db.execute("COMMIT")
                return result

            blocked=self.db.execute("SELECT 1 FROM sessions WHERE scope_hash=? AND agent_id=? AND state='close_pending'",
                                    (scope,self.agent_id)).fetchone()
            if blocked:
                raise ReconciliationRequired("previous provider task close is unconfirmed")
            current = self.db.execute("SELECT * FROM sessions WHERE scope_hash=? AND agent_id=? AND state IN ('active','unknown')",
                                      (scope, self.agent_id)).fetchone()
            if current and current["state"] == "unknown":
                raise ReconciliationRequired("existing session has uncertain provider outcome")
            if current and now >= current["expires"]:
                raise ReconciliationRequired("expired session has unresolved provider work")
            if current and current["task_id"] is None:
                raise ReconciliationRequired("session start is in progress")
            if current is None:
                # Conservatively bound local task count; task close/reconciliation is explicit.
                open_count = self.db.execute("SELECT COUNT(*) FROM sessions WHERE state IN ('active','unknown','close_pending')").fetchone()[0]
                if open_count >= MAX_OPEN_TASKS:
                    raise IsolationGuard("LAB task capacity reached; human handoff required")
                session_id = uuid4().hex
                self.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
                                (session_id,scope,self.agent_id,None,None,now,now+self.ttl,"active"))
                created_new = True
                task_id = None
                thread_id = None
            else:
                session_id, task_id, thread_id = current["session_id"], current["task_id"], current["thread_id"]
                self.db.execute("UPDATE sessions SET expires=? WHERE session_id=?", (now+self.ttl,session_id))
            self.db.execute("INSERT INTO requests VALUES (?,?,?,?,?,?,?,?)",
                            (operation_key,scope,payload_hash,session_id,"reserved",None,None,now))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

        try:
            if created_new:
                task_id, thread_id, receipt = self.transport.start_task(self.agent_id, text, operation_key)
                if not task_id or not thread_id:
                    raise ValueError("provider did not return scoped task/thread ID")
            else:
                receipt = self.transport.send_task(self.agent_id, task_id, text, operation_key)
            if not receipt.delivery_id or not receipt.message_id:
                raise ValueError("provider acknowledgement lacks identifiers")
        except Exception as exc:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                self.db.execute("UPDATE requests SET state='unknown' WHERE operation_key=?", (operation_key,))
                self.db.execute("UPDATE sessions SET state='unknown' WHERE session_id=?", (session_id,))
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise
            raise ReconciliationRequired("transport outcome unknown; no automatic resend") from exc

        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("UPDATE requests SET state='accepted', delivery_id=?, message_id=? WHERE operation_key=?",
                            (receipt.delivery_id,receipt.message_id,operation_key))
            if created_new:
                self.db.execute("UPDATE sessions SET task_id=?, thread_id=? WHERE session_id=?",
                                (task_id,thread_id,session_id))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        return DispatchResult("ACCEPTED",session_id,task_id,thread_id,receipt.delivery_id)

    def confirm_terminal(self, operation_key: str, delivery_id: str, terminal: str) -> None:
        """Apply *verified* provider terminal state; a 202 receipt is NOT completion.

        The caller must first verify the delivery ID via authorized OpenBot
        read-only status/turn correlation. Never infer delivery from an ACK.
        """
        if terminal not in ("completed", "failed"):
            raise ValueError("expected verified completed/failed state")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            record=self.db.execute("SELECT * FROM requests WHERE operation_key=?",(operation_key,)).fetchone()
            if not record or record["delivery_id"] != delivery_id or record["state"] not in ("accepted",terminal):
                raise IsolationGuard("terminal receipt not correlated to accepted request")
            self.db.execute("UPDATE requests SET state=? WHERE operation_key=?",(terminal,operation_key))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
