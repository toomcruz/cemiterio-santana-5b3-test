"""Persistent, single-worker queue for authorized Boss routine dispatches."""
import hashlib
import sqlite3
import threading
import time
import uuid
import os
import logging

logger = logging.getLogger("openbot_bridge.task_queue")

WINDOW = 3600
try:
    LIMIT = int(os.getenv("BRIDGE_DISPATCH_LIMIT_PER_HOUR", "60"))
except ValueError as exc:
    raise RuntimeError("BRIDGE_DISPATCH_LIMIT_PER_HOUR must be an integer") from exc
if not 1 <= LIMIT <= 60:
    raise RuntimeError("BRIDGE_DISPATCH_LIMIT_PER_HOUR must be between 1 and 60")
try:
    DISPATCH_INTERVAL = int(os.getenv("BRIDGE_DISPATCH_INTERVAL_SECONDS", "5"))
except ValueError as exc:
    raise RuntimeError("BRIDGE_DISPATCH_INTERVAL_SECONDS must be an integer") from exc
if not 1 <= DISPATCH_INTERVAL <= 3600:
    raise RuntimeError("BRIDGE_DISPATCH_INTERVAL_SECONDS must be between 1 and 3600")
MAX_ROWS = 500
MAX_ATTEMPTS = 5


class TaskQueue:
    def __init__(self, path, dispatch, run_lookup, enabled, interval=2):
        self.path = str(path)
        self.dispatch = dispatch
        self.run_lookup = run_lookup
        self.enabled = enabled
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self.enqueue_lock = threading.Lock()
        with self._db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS task_queue(
                task_id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE,
                task_hash TEXT NOT NULL, task TEXT NOT NULL,
                state TEXT NOT NULL, run_id TEXT, delivery_id TEXT,
                attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
                error TEXT, result TEXT, created REAL NOT NULL, updated REAL NOT NULL,
                terminal_seen REAL, lookup_failures INTEGER NOT NULL DEFAULT 0);
            """)
            # Additive migration for queues created by earlier bridge versions.
            columns = {row[1] for row in db.execute("PRAGMA table_info(task_queue)")}
            if "terminal_seen" not in columns:
                db.execute("ALTER TABLE task_queue ADD COLUMN terminal_seen REAL")
            if "lookup_failures" not in columns:
                db.execute("ALTER TABLE task_queue ADD COLUMN lookup_failures INTEGER NOT NULL DEFAULT 0")
            db.executescript("""
              CREATE TABLE IF NOT EXISTS task_dispatches(at REAL NOT NULL);
              CREATE INDEX IF NOT EXISTS task_queue_state ON task_queue(state,next_attempt,created);
            """)
            # A crash during POST has an unknowable remote outcome: never replay it automatically.
            db.execute("UPDATE task_queue SET state='failed', error='Despacho interrompido; resultado externo incerto, reconciliação manual necessária.', updated=? WHERE state='dispatching'", (time.time(),))

    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def start(self):
        self.thread = threading.Thread(target=self._work, name="bridge-task-queue", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=8)

    def enqueue(self, task, idempotency_key=None):
        now = time.time()
        task_hash = hashlib.sha256(task.encode("utf-8")).hexdigest()
        task_id = uuid.uuid4().hex
        with self.enqueue_lock:
            with self._db() as db:
                if idempotency_key:
                    old = db.execute("SELECT * FROM task_queue WHERE idempotency_key=?", (idempotency_key,)).fetchone()
                    if old:
                        if old["task_hash"] != task_hash:
                            raise ValueError("idempotency_key já usado com tarefa diferente.")
                        return dict(old), False
                count = db.execute("SELECT count(*) FROM task_queue").fetchone()[0]
                if count >= MAX_ROWS:
                    raise RuntimeError("Fila persistente cheia; nenhum registro terminal foi removido.")
                db.execute("INSERT INTO task_queue(task_id,idempotency_key,task_hash,task,state,created,updated) VALUES(?,?,?,?,?,?,?)",
                           (task_id,idempotency_key,task_hash,task,"queued",now,now))
                row = db.execute("SELECT * FROM task_queue WHERE task_id=?", (task_id,)).fetchone()
                return dict(row), True

    def get(self, task_id):
        with self._db() as db:
            row = db.execute("SELECT * FROM task_queue WHERE task_id=?", (task_id,)).fetchone()
            if not row:
                raise LookupError("Tarefa não encontrada.")
            return dict(row)

    def _work(self):
        while not self.stop_event.is_set():
            try:
                self._sync_running()
                if self.enabled():
                    self._dispatch_one()
            except Exception as exc:
                # Log only the exception class: exception messages may contain prompts,
                # response bodies, or other private data.
                logger.error("queue_cycle_failed exception_type=%s", type(exc).__name__)
            self.stop_event.wait(self.interval)

    def _sync_running(self, task_id=None):
        with self._db() as db:
            if task_id is None:
                rows = db.execute("SELECT task_id,run_id,terminal_seen,state,error FROM task_queue WHERE state IN ('running','result_missing')").fetchall()
            else:
                rows = db.execute("SELECT task_id,run_id,terminal_seen,state,error FROM task_queue WHERE task_id=? AND (state IN ('running','result_missing') OR (state='failed' AND error LIKE 'RESULT_MISSING:%')) AND run_id IS NOT NULL", (task_id,)).fetchall()
        for row in rows:
            try:
                remote = self.run_lookup(row["run_id"])
                state = remote.get("status")
                if state in ("succeeded", "failed", "interrupted", "cancelled", "needs-attention"):
                    observed = row["terminal_seen"] or time.time()
                    with self._db() as db:
                        db.execute("UPDATE task_queue SET terminal_seen=COALESCE(terminal_seen,?),lookup_failures=0 WHERE task_id=?", (observed,row["task_id"]))
                        observed = db.execute("SELECT terminal_seen FROM task_queue WHERE task_id=?", (row["task_id"],)).fetchone()[0]
                    if state == "succeeded":
                        # A terminal run is not complete for this queue until its final answer
                        # is visible in the read-only projection and durably stored here.
                        result = self.run_lookup.result(row["run_id"])
                        logger.info("task_result_check task_id=%s run_id=%s terminal_state=%s result_available=%s", row["task_id"], row["run_id"], state, bool(isinstance(result, str) and result.strip()))
                        if not isinstance(result, str) or not result.strip():
                            if time.time() - observed >= 300 and (row["state"] in ("running", "result_missing") or (row["state"] == "failed" and str(row["error"] or "").startswith("RESULT_MISSING:"))):
                                with self._db() as db:
                                    db.execute("UPDATE task_queue SET state='failed',error='RESULT_MISSING: execução concluída sem resposta; reconciliação manual disponível por task_id; sem reenvio automático.',updated=? WHERE task_id=? AND (state IN ('running','result_missing') OR (state='failed' AND error LIKE 'RESULT_MISSING:%'))", (time.time(), row["task_id"]))
                            continue
                        new_state, error = "succeeded", None
                    else:
                        result = None
                        new_state, error = "failed", remote.get("error") or f"OpenBot terminou com estado {state}."
                        logger.info("task_result_check task_id=%s run_id=%s terminal_state=%s result_available=false", row["task_id"], row["run_id"], state)
                    with self._db() as db:
                        db.execute("UPDATE task_queue SET state=?,result=?,error=?,updated=? WHERE task_id=? AND (state IN ('running','result_missing') OR (state='failed' AND error LIKE 'RESULT_MISSING:%'))",
                                   (new_state,result,error,time.time(),row["task_id"]))
            except Exception as exc:
                # Bound the lifetime of an unobservable run so it cannot block dispatch forever.
                with self._db() as db:
                    db.execute("UPDATE task_queue SET lookup_failures=lookup_failures+1 WHERE task_id=?", (row["task_id"],))
                    failures = db.execute("SELECT lookup_failures FROM task_queue WHERE task_id=?", (row["task_id"],)).fetchone()[0]
                    logger.warning("task_reconcile_failed task_id=%s run_id=%s failures=%s error_class=%s", row["task_id"], row["run_id"] or "-", failures, type(exc).__name__)
                    if failures >= 12 and row["state"] == "running":
                        db.execute("UPDATE task_queue SET state='failed',error='STATUS_UNAVAILABLE: consulta upstream falhou repetidamente; resultado incerto, sem reenvio automático.',updated=? WHERE task_id=? AND state='running'", (time.time(),row["task_id"]))
                        row = dict(row)
                        row["state"] = "failed"
                        row["error"] = "STATUS_UNAVAILABLE"
                continue

    def _dispatch_one(self):
        now = time.time()
        with self._db() as db:
            # A run whose status endpoint has repeatedly failed is terminal for
            # serialization purposes; retain its IDs and mark uncertainty explicitly.
            db.execute("UPDATE task_queue SET state='failed',error='STATUS_UNAVAILABLE: consulta upstream falhou repetidamente; resultado incerto, sem reenvio automático.',updated=? WHERE state='running' AND lookup_failures>=12", (now,))
            db.execute("DELETE FROM task_dispatches WHERE at<?", (now-WINDOW,))
            if db.execute("SELECT count(*) FROM task_dispatches").fetchone()[0] >= LIMIT:
                return
            # Serialize full run lifetimes, not only the HTTP POST, to keep upstream
            # concurrency at one and avoid overwhelming the local OpenBot worker.
            if db.execute("SELECT 1 FROM task_queue WHERE state IN ('dispatching','running') LIMIT 1").fetchone():
                return
            last = db.execute("SELECT max(at) FROM task_dispatches").fetchone()[0]
            if last is not None and now - last < DISPATCH_INTERVAL:
                return
            row = db.execute("SELECT * FROM task_queue WHERE state='queued' AND next_attempt<=? ORDER BY created LIMIT 1", (now,)).fetchone()
            if not row:
                return
            # Reserve transactionally before POST; a crash is marked uncertain, never blindly replayed.
            db.execute("UPDATE task_queue SET state='dispatching',attempts=attempts+1,updated=? WHERE task_id=? AND state='queued'", (now,row["task_id"]))
            db.execute("INSERT INTO task_dispatches(at) VALUES(?)", (now,))
        started = time.monotonic()
        try:
            response = self.dispatch(row["task"], row["task_id"])
            run_id = response.get("runId") if isinstance(response, dict) else None
            delivery_id = response.get("deliveryId") if isinstance(response, dict) else None
            if not isinstance(run_id, str) or not run_id:
                raise RuntimeError("OpenBot não retornou runId recuperável.")
            logger.info("task_dispatch_complete task_id=%s run_id=%s delivery_id=%s outcome=accepted duration_ms=%.3f", row["task_id"], run_id, delivery_id or "-", (time.monotonic() - started) * 1000)
            with self._db() as db:
                db.execute("UPDATE task_queue SET state='running',run_id=?,delivery_id=?,error=NULL,updated=? WHERE task_id=? AND state='dispatching'",
                           (run_id,delivery_id,time.time(),row["task_id"]))
        except Exception as exc:
            # Explicit HTTP 429 is known not accepted and safe to retry; other outcomes may be ambiguous.
            known_reject = getattr(exc, "status_code", None) == 429
            logger.warning("task_dispatch_complete task_id=%s outcome=%s error_class=%s duration_ms=%.3f", row["task_id"], "rejected" if known_reject else "error", type(exc).__name__, (time.monotonic() - started) * 1000)
            attempts = row["attempts"] + 1
            if known_reject and attempts < MAX_ATTEMPTS:
                delay = min(300, 2 ** attempts * 5)
                with self._db() as db:
                    db.execute("UPDATE task_queue SET state='queued',next_attempt=?,error='OpenBot aplicou limite; nova tentativa agendada.',updated=? WHERE task_id=?",
                               (time.time()+delay,time.time(),row["task_id"]))
            else:
                with self._db() as db:
                    db.execute("UPDATE task_queue SET state='failed',error=?,updated=? WHERE task_id=?",
                               ("Despacho incerto; conferir OpenBot antes de reenviar." if not known_reject else "Limite externo persistente após retentativas.",time.time(),row["task_id"]))

