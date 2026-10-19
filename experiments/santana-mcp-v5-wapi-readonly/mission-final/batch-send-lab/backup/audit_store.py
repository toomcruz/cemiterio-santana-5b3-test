"""Durable approval, deduplication, and audit state for outbound messages."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any


class AuditStore:
    def __init__(self, path: str, dedupe_seconds: int = 900, approval_ttl: int = 600):
        self.path = path
        self.dedupe_seconds = dedupe_seconds
        self.approval_ttl = approval_ttl
        self._lock = threading.RLock()
        if path != ":memory:":
            Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(Path(path).parent, 0o700)
            if not Path(path).exists():
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
            else:
                os.chmod(path, 0o600)
        self._db = sqlite3.connect(path, timeout=10, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA busy_timeout=10000")
        self._db.execute("PRAGMA synchronous=FULL")
        if path != ":memory:":
            self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS outbound_approvals (
                approval_id TEXT PRIMARY KEY,
                client TEXT NOT NULL,
                kind TEXT NOT NULL,
                phone TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                dedupe_key TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                provider_message_id TEXT,
                provider_inserted_id TEXT,
                outcome_json TEXT,
                error_code TEXT,
                human_approved_at REAL,
                human_approved_by TEXT
            );
            CREATE INDEX IF NOT EXISTS outbound_state_idx
                ON outbound_approvals(state, created_at DESC);
            CREATE TABLE IF NOT EXISTS mcp_read_rate_events (
                principal_key TEXT NOT NULL,
                occurred_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS mcp_read_rate_window_idx
                ON mcp_read_rate_events(principal_key, occurred_at);
        """)
        columns = {row[1] for row in self._db.execute("PRAGMA table_info(outbound_approvals)")}
        if "human_approved_at" not in columns:
            self._db.execute("ALTER TABLE outbound_approvals ADD COLUMN human_approved_at REAL")
        if "human_approved_by" not in columns:
            self._db.execute("ALTER TABLE outbound_approvals ADD COLUMN human_approved_by TEXT")
        index_columns = [row[2] for row in self._db.execute("PRAGMA index_info(outbound_dedupe_idx)")]
        if index_columns != ["dedupe_key", "created_at"]:
            self._db.execute("DROP INDEX IF EXISTS outbound_dedupe_idx")
            self._db.execute("CREATE INDEX outbound_dedupe_idx ON outbound_approvals(dedupe_key, created_at DESC)")

    @staticmethod
    def _row(row):
        return dict(row) if row is not None else None

    def prepare(self, client: str, kind: str, phone: str, payload: dict[str, Any], payload_hash: str, dedupe_key: str):
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute(
                    "UPDATE outbound_approvals SET state='expired',phone='[redacted]',payload_json='{}',updated_at=? "
                    "WHERE state='prepared' AND expires_at<?", (now, now)
                )
                existing = self._db.execute(
                    "SELECT * FROM outbound_approvals WHERE dedupe_key=? AND created_at>? "
                    "AND state IN ('prepared','human_approved','sending','outcome_unknown','accepted_by_api','simulated') "
                    "ORDER BY created_at DESC LIMIT 1",
                    (dedupe_key, now - self.dedupe_seconds),
                ).fetchone()
                if existing:
                    self._db.execute("COMMIT")
                    return self._row(existing), False
                approval_id = str(uuid.uuid4())
                self._db.execute(
                    "INSERT INTO outbound_approvals(approval_id,client,kind,phone,payload_json,payload_hash,dedupe_key,state,created_at,expires_at,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,'prepared',?,?,?)",
                    (approval_id, client, kind, phone, json.dumps(payload, ensure_ascii=False), payload_hash,
                     dedupe_key, now, now + self.approval_ttl, now),
                )
                row = self._db.execute("SELECT * FROM outbound_approvals WHERE approval_id=?", (approval_id,)).fetchone()
                self._db.execute("COMMIT")
                return self._row(row), True
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def get(self, approval_id: str, client: str):
        with self._lock:
            row = self._db.execute("SELECT * FROM outbound_approvals WHERE approval_id=? AND client=?", (approval_id, client)).fetchone()
            return self._row(row)

    def get_any(self, approval_id: str):
        with self._lock:
            row = self._db.execute("SELECT * FROM outbound_approvals WHERE approval_id=?", (approval_id,)).fetchone()
            return self._row(row)

    def record_operator_approval(self, approval_id: str, operator: str):
        """Approve one prepared fixture message after a separate interactive CLI review."""
        if not operator or len(operator) > 128:
            raise ValueError("Identidade do operador inválida.")
        now = time.time()
        with self._lock:
            changed = self._db.execute(
                "UPDATE outbound_approvals SET state='human_approved',human_approved_at=?,human_approved_by=?,updated_at=? "
                "WHERE approval_id=? AND state='prepared' AND expires_at>=?",
                (now, operator, now, approval_id, now),
            ).rowcount
            return self.get_any(approval_id) if changed else None

    def cleanup_expired(self):
        now = time.time()
        with self._lock:
            self._db.execute(
                "UPDATE outbound_approvals SET state='expired',phone='[redacted]',payload_json='{}',updated_at=? "
                "WHERE state='prepared' AND expires_at<?", (now, now)
            )

    def consume_read_quota(self, principal_key: str, max_calls: int, window_seconds: int = 60,
                           now: float | None = None) -> tuple[bool, int]:
        """Atomically consume a persistent read quota; caller supplies a pseudonymous key."""
        if not principal_key or not 1 <= max_calls <= 1000 or not 1 <= window_seconds <= 3600:
            raise ValueError("Limite de leitura inválido.")
        at = time.time() if now is None else float(now)
        key = hashlib.sha256(principal_key.encode("utf-8")).hexdigest()
        cutoff = at - window_seconds
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("DELETE FROM mcp_read_rate_events WHERE occurred_at < ?", (at - 3600,))
                count = self._db.execute(
                    "SELECT COUNT(*) FROM mcp_read_rate_events WHERE principal_key=? AND occurred_at>?",
                    (key, cutoff),
                ).fetchone()[0]
                if count >= max_calls:
                    oldest = self._db.execute(
                        "SELECT MIN(occurred_at) FROM mcp_read_rate_events WHERE principal_key=? AND occurred_at>?",
                        (key, cutoff),
                    ).fetchone()[0]
                    retry_after = max(1, int(oldest + window_seconds - at + 0.999))
                    self._db.execute("COMMIT")
                    return False, retry_after
                self._db.execute("INSERT INTO mcp_read_rate_events(principal_key,occurred_at) VALUES(?,?)", (key, at))
                self._db.execute("COMMIT")
                return True, 0
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def claim(self, approval_id: str, client: str, kind: str):
        """Persist the sending state before network I/O; never retry an ambiguous attempt."""
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                row = self._db.execute("SELECT * FROM outbound_approvals WHERE approval_id=? AND client=?", (approval_id, client)).fetchone()
                if row is None:
                    self._db.execute("COMMIT")
                    return None, "not_found"
                row = self._row(row)
                if row["kind"] != kind:
                    self._db.execute("COMMIT")
                    return row, "wrong_kind"
                if row["state"] != "human_approved" or not row["human_approved_at"] or not row["human_approved_by"]:
                    self._db.execute("COMMIT")
                    return row, "already_processed"
                if row["expires_at"] < now:
                    self._db.execute("UPDATE outbound_approvals SET state='expired',phone='[redacted]',payload_json='{}',updated_at=? WHERE approval_id=?", (now, approval_id))
                    self._db.execute("COMMIT")
                    row["state"] = "expired"
                    return row, "expired"
                updated = self._db.execute(
                    "UPDATE outbound_approvals SET state='sending',updated_at=? WHERE approval_id=? AND state='human_approved'",
                    (now, approval_id),
                ).rowcount
                self._db.execute("COMMIT")
                if not updated:
                    return row, "already_processed"
                row["state"] = "sending"
                return row, "claimed"
            except Exception:
                self._db.execute("ROLLBACK")
                raise

    def finish(self, approval_id: str, state: str, outcome: dict[str, Any] | None = None, error_code: str | None = None):
        if state not in {"simulated", "accepted_by_api", "rejected_by_api", "outcome_unknown", "blocked_human_pause", "blocked_send_disabled", "blocked_guard_unavailable"}:
            raise ValueError("Estado final inválido.")
        outcome = outcome or {}
        with self._lock:
            self._db.execute(
                "UPDATE outbound_approvals SET state=?,phone=?,payload_json='{}',updated_at=?,provider_message_id=?,provider_inserted_id=?,outcome_json=?,error_code=? WHERE approval_id=? AND state='sending'",
                (state, _mask_phone_for_audit(self._db, approval_id), time.time(), outcome.get("messageId"), outcome.get("insertedId"), json.dumps(outcome, ensure_ascii=False), error_code, approval_id),
            )


def _mask_phone_for_audit(db, approval_id: str) -> str:
    row = db.execute("SELECT phone FROM outbound_approvals WHERE approval_id=?", (approval_id,)).fetchone()
    if not row or not row[0] or row[0] == "[redacted]":
        return "[redacted]"
    phone = row[0]
    return "+" + phone[:4] + "•••••" + phone[-3:]


def from_environment() -> AuditStore:
    return AuditStore(os.getenv("SANTANA_AUDIT_DB", "./state/whatsapp_santana_mcp.sqlite3"))
