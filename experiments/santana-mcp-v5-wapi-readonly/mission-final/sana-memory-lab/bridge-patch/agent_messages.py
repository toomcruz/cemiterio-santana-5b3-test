"""Direct, idempotent Local Scripts messages for explicitly listed agents.

Writes only to the bridge's own private SQLite state. OpenBot message sends use
the documented Local Scripts API; response recovery reads the existing local
projection in read-only mode and correlates by the delivery IDs returned by
OpenBot. This module never retries a send after an uncertain outcome.
"""
import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from result_adapter import official_agent_delivery_result

MAX_MESSAGE_CHARS = 3800
MAX_DELIVERIES = 16
MAX_RESULT_CHARS = 65536
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
TERMINAL = {"succeeded", "failed", "interrupted", "cancelled", "needs-attention"}


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _valid_agent_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)


def _private_state_file(path):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.stat()
    if parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
        raise PermissionError("Diretório de estado da ponte não é privado.")
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(fd)
    except FileExistsError:
        pass
    st = path.lstat()
    if not path.is_file() or path.is_symlink() or st.st_uid != os.geteuid() or st.st_mode & 0o077:
        raise PermissionError("Arquivo de estado da ponte não é regular e privado.")
    return path


class AgentMessageStore:
    """Persist direct message receipts and recover results by exact delivery IDs."""

    def __init__(self, state_path, run_db, send_message, authorized_agent, enabled=False, read_delivery=None):
        self.path = _private_state_file(state_path)
        self.run_db = Path(run_db)
        self.send_message = send_message
        self.authorized_agent = authorized_agent
        self.enabled = bool(enabled)
        self.read_delivery = read_delivery
        with self._db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS direct_agent_messages(
                request_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                request_hash TEXT NOT NULL,
                client_message_id TEXT NOT NULL,
                message_id TEXT,
                delivery_ids TEXT NOT NULL DEFAULT '[]',
                state TEXT NOT NULL,
                error TEXT,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                UNIQUE(agent_id, idempotency_key),
                UNIQUE(agent_id, client_message_id));
              CREATE INDEX IF NOT EXISTS direct_agent_messages_state
                ON direct_agent_messages(state, updated);
            """)
            # A crash while the HTTP call was in flight has an unknown outcome.
            # Never auto-send it again, even if OpenBot's 24-hour key expires.
            db.execute("UPDATE direct_agent_messages SET state='uncertain',error='Envio interrompido; conferir o OpenBot antes de iniciar novo pedido.',updated=? WHERE state='dispatching'", (time.time(),))

    def _db(self):
        db = sqlite3.connect(str(self.path), timeout=3)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def validate(agent_id, message, idempotency_key):
        if not _valid_agent_id(agent_id):
            raise ValueError("agent_id inválido.")
        if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
            raise ValueError("Mensagem vazia ou maior que o limite permitido.")
        if not isinstance(idempotency_key, str) or not ID_PATTERN.fullmatch(idempotency_key):
            raise ValueError("Informe idempotency_key de 8 a 128 caracteres.")

    def submit(self, agent_id, message, idempotency_key):
        if not self.enabled:
            raise PermissionError("Envio direto a agentes está desabilitado.")
        self.validate(agent_id, message, idempotency_key)
        if not self.authorized_agent(agent_id):
            raise PermissionError("Agente não está autorizado pelo Local Scripts atual.")
        clean = message.strip()
        digest = hashlib.sha256(_canonical([agent_id, clean]).encode("utf-8")).hexdigest()
        now = time.time()
        request_id = uuid.uuid4().hex
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM direct_agent_messages WHERE agent_id=? AND idempotency_key=?", (agent_id, idempotency_key)).fetchone()
            if old:
                if old["request_hash"] != digest:
                    raise ValueError("idempotency_key já foi usada com agente ou mensagem diferente.")
                return self._public(dict(old))
            db.execute("INSERT INTO direct_agent_messages(request_id,agent_id,idempotency_key,request_hash,client_message_id,state,created,updated) VALUES(?,?,?,?,?,'dispatching',?,?)",
                       (request_id, agent_id, idempotency_key, digest, idempotency_key, now, now))

        try:
            receipt = self.send_message(agent_id, clean, idempotency_key)
            message_id, delivery_ids = self._validate_receipt(receipt, agent_id)
        except Exception as exc:
            known_reject = getattr(exc, "status_code", None) == 429
            state = "rejected" if known_reject else "uncertain"
            safe_error = "OpenBot recusou a mensagem (HTTP 429)." if known_reject else f"Resultado do envio incerto ({type(exc).__name__}); não houve reenvio automático."
            with self._db() as db:
                db.execute("UPDATE direct_agent_messages SET state=?,error=?,updated=? WHERE request_id=? AND state='dispatching'", (state, safe_error, time.time(), request_id))
            return self.get(request_id)

        with self._db() as db:
            db.execute("UPDATE direct_agent_messages SET state='accepted',message_id=?,delivery_ids=?,error=NULL,updated=? WHERE request_id=? AND state='dispatching'",
                       (message_id, json.dumps(delivery_ids), time.time(), request_id))
        return self.get(request_id)

    @staticmethod
    def _validate_receipt(receipt, agent_id):
        if not isinstance(receipt, dict) or not isinstance(receipt.get("messageId"), str) or not receipt["messageId"]:
            raise RuntimeError("Recibo do OpenBot sem messageId válido.")
        deliveries = receipt.get("deliveries")
        if not isinstance(deliveries, list) or len(deliveries) > MAX_DELIVERIES:
            raise RuntimeError("Recibo do OpenBot sem deliveries válidas.")
        ids = []
        for delivery in deliveries:
            if not isinstance(delivery, dict) or delivery.get("recipientAgentId") != agent_id:
                raise RuntimeError("Recibo do OpenBot não corresponde ao agente solicitado.")
            delivery_id = delivery.get("id")
            if not isinstance(delivery_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", delivery_id):
                raise RuntimeError("Recibo do OpenBot contém delivery ID inválido.")
            if delivery_id not in ids:
                ids.append(delivery_id)
        return receipt["messageId"], ids

    @staticmethod
    def _public(row):
        return {
            "request_id": row["request_id"], "agent_id": row["agent_id"],
            "message_id": row["message_id"], "delivery_ids": json.loads(row["delivery_ids"]),
            "state": row["state"], "error": row["error"],
            "created_at": row["created"], "updated_at": row["updated"],
        }

    def get(self, request_id):
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{32}", request_id):
            raise ValueError("request_id inválido.")
        with self._db() as db:
            row = db.execute("SELECT * FROM direct_agent_messages WHERE request_id=?", (request_id,)).fetchone()
        if not row:
            raise LookupError("Execução direta não encontrada.")
        return self._public(dict(row))

    def status(self, request_id, with_result=False):
        row = self.get(request_id)
        result = {**row, "result_available": False, "result": None, "truncated": False}
        if row["state"] not in ("accepted", "running", "succeeded", "failed") or not row["delivery_ids"]:
            return result
        projection = self._read_projection(row["delivery_ids"], row["agent_id"])
        result.update(projection)
        if projection["state"] in TERMINAL:
            with self._db() as db:
                db.execute("UPDATE direct_agent_messages SET state=?,error=?,updated=? WHERE request_id=? AND state IN ('accepted','running','succeeded','failed')",
                           (projection["state"], projection.get("error"), time.time(), request_id))
            result["state"] = projection["state"]
            result["error"] = projection.get("error")
        elif projection["state"] == "running" and row["state"] == "accepted":
            with self._db() as db:
                db.execute("UPDATE direct_agent_messages SET state='running',updated=? WHERE request_id=? AND state='accepted'", (time.time(), request_id))
            result["state"] = "running"
        if not with_result:
            result["result"] = None
        return result

    def _read_projection(self, delivery_ids, agent_id):
        if self.read_delivery is not None:
            if not self.authorized_agent(agent_id):
                raise PermissionError("Agent authorization revoked")
            try:
                return official_agent_delivery_result(delivery_ids, lambda delivery_id: self.read_delivery(agent_id, delivery_id), MAX_RESULT_CHARS)
            except (RuntimeError, OSError):
                pass  # old API unavailable; retain the strict, exact projection fallback

        try:
            st = self.run_db.stat()
        except FileNotFoundError:
            return {"state": "accepted", "result_available": False, "result": None, "truncated": False, "error": None,
                    "message": "A projeção local de respostas ainda não está disponível."}
        if st.st_uid != os.geteuid() or st.st_mode & 0o077:
            raise PermissionError("Permissões inseguras no banco local de histórico.")
        uri = self.run_db.resolve().as_uri() + "?mode=ro"
        texts, errors, states, found = [], [], [], False
        try:
            with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
                db.row_factory = sqlite3.Row
                for delivery_id in delivery_ids:
                    row = db.execute(
                        "SELECT d.delivery_id,d.turn_id,t.thread_id FROM projection_deliveries d "
                        "LEFT JOIN projection_turns t ON t.turn_id=d.turn_id WHERE d.delivery_id=? LIMIT 1",
                        (delivery_id,),
                    ).fetchone()
                    if not row:
                        continue
                    found = True
                    if not row["turn_id"] or not row["thread_id"]:
                        continue
                    turn = db.execute("SELECT * FROM projection_turns WHERE turn_id=? LIMIT 1", (row["turn_id"],)).fetchone()
                    if turn:
                        keys = set(turn.keys())
                        state = turn["status"] if "status" in keys else None
                        error = turn["error"] if "error" in keys else None
                        if isinstance(state, str):
                            states.append(state)
                        if isinstance(error, str) and error.strip():
                            errors.append(error.strip())
                    messages = db.execute(
                        "SELECT author,status,item_type,message_json FROM projection_thread_messages "
                        "WHERE thread_id=? AND turn_id=? ORDER BY ordinal LIMIT 100",
                        (row["thread_id"], row["turn_id"]),
                    ).fetchall()
                    for author, message_status, item_type, raw in messages:
                        if author != "assistant":
                            continue
                        try:
                            message = json.loads(raw)
                        except (TypeError, ValueError):
                            continue
                        if item_type == "final_answer" and message_status == "completed":
                            text = message.get("text") if isinstance(message, dict) else None
                            if isinstance(text, str) and text.strip():
                                texts.append(text)
                        elif item_type in ("error", "failure", "provider_error"):
                            text = message.get("text") if isinstance(message, dict) else None
                            if isinstance(text, str) and text.strip():
                                errors.append(text.strip())
        except sqlite3.Error:
            raise RuntimeError("Não foi possível ler a projeção local em modo somente leitura.") from None

        output = "\n\n".join(texts)
        # No guessed completion: a completed final_answer or explicit terminal turn state is required.
        terminal = next((s for s in reversed(states) if s in TERMINAL), None)
        normalized = terminal or ("succeeded" if output else ("running" if found else "accepted"))
        return {
            "state": normalized,
            "result_available": bool(output),
            "result": output[:MAX_RESULT_CHARS] if output else None,
            "truncated": len(output) > MAX_RESULT_CHARS,
            "error": "\n".join(dict.fromkeys(errors)) or None,
            "message": None if output or errors else "OpenBot ainda não apresentou resposta terminal correlacionada.",
        }
