"""MCP Events support for the OpenBot bridge (stdlib only).

Subscriptions are scoped to the authenticated bridge principal and a single
run_id. The monitor reads only those runs from OpenBot's local read-only DB.
"""
import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import secrets
import socket
import sqlite3
import ssl
import time
import urllib.parse
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

EVENT_NAME = "openbot.run.completed"
TERMINAL = {"succeeded", "failed", "interrupted", "cancelled", "needs-attention"}
MAX_CALLBACK_BYTES = 256 * 1024
MAX_ATTEMPTS = 5
DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _secret_bytes(secret):
    if not isinstance(secret, str) or not secret.startswith("whsec_"):
        raise ValueError("callback_endpoint_error: invalid_signing_secret")
    try:
        key = base64.b64decode(secret[6:], validate=True)
    except Exception:
        raise ValueError("callback_endpoint_error: invalid_signing_secret") from None
    if not 24 <= len(key) <= 64:
        raise ValueError("callback_endpoint_error: invalid_signing_secret")
    return key


def _public_callback(url):
    if not isinstance(url, str):
        raise ValueError("callback_endpoint_error: invalid_url")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("callback_endpoint_error: https_required")
    if parsed.fragment or not parsed.path.startswith("/") or len(url) > 2048:
        raise ValueError("callback_endpoint_error: invalid_url")
    try:
        port = parsed.port or 443
    except ValueError:
        raise ValueError("callback_endpoint_error: invalid_url") from None
    if port != 443:
        raise ValueError("callback_endpoint_error: nonstandard_port")
    try:
        infos = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    except OSError:
        raise ValueError("callback_endpoint_error: dns_failed") from None
    addresses = sorted({item[4][0] for item in infos})
    if not addresses:
        raise ValueError("callback_endpoint_error: dns_empty")
    for raw in addresses:
        addr = ipaddress.ip_address(raw)
        if not addr.is_global:
            raise ValueError("callback_endpoint_error: non_public_address")
    return parsed, addresses


def _post_pinned(url, body, headers, timeout=5):
    parsed, addresses = _public_callback(url)
    context = ssl.create_default_context()
    last_error = None
    for address in addresses:
        conn = None
        try:
            # Connect to the validated IP while retaining original hostname for TLS/SNI.
            raw = socket.create_connection((address, 443), timeout=timeout)
            tls = context.wrap_socket(raw, server_hostname=parsed.hostname)
            conn = http.client.HTTPSConnection(parsed.hostname, 443, timeout=timeout, context=context)
            conn.sock = tls
            path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
            conn.request("POST", path, body=body, headers=headers)
            response = conn.getresponse()
            response_body = response.read(8192)
            return response.status, response_body
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            last_error = exc
        finally:
            if conn:
                conn.close()
    raise RuntimeError("callback_delivery_failed") from last_error


class EventStore:
    def __init__(self, path, run_row, run_result, principal_id, interval=60, post_hook=None):
        self.path = Path(path)
        self.run_row = run_row
        self.run_result = run_result
        self.principal_id = principal_id
        self.post_hook = post_hook or _post_pinned
        self.interval = max(30, min(int(interval), 3600))
        self._lock = __import__("threading").RLock()
        self._stop = __import__("threading").Event()
        self._thread = None
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        parent_stat = self.path.parent.stat()
        if parent_stat.st_uid != os.geteuid() or (parent_stat.st_mode & 0o077):
            raise PermissionError("Diretório do estado MCP Events não é privado para o usuário da ponte.")
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.close(fd)
        except FileExistsError:
            pass
        file_stat = self.path.lstat()
        if not self.path.is_file() or self.path.is_symlink() or file_stat.st_uid != os.geteuid() or (file_stat.st_mode & 0o077):
            raise PermissionError("Arquivo de estado MCP Events não é regular e privado.")
        with self._db() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS subscriptions(
                id TEXT PRIMARY KEY, principal TEXT NOT NULL, name TEXT NOT NULL,
                run_id TEXT NOT NULL, callback TEXT NOT NULL, secret TEXT NOT NULL,
                expires REAL NOT NULL, active INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt REAL NOT NULL DEFAULT 0, created REAL NOT NULL,
                UNIQUE(principal,name,run_id,callback));
              CREATE TABLE IF NOT EXISTS event_outbox(
                event_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, body BLOB NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending', created REAL NOT NULL,
                FOREIGN KEY(subscription_id) REFERENCES subscriptions(id));
              CREATE TABLE IF NOT EXISTS callback_verifications(
                principal TEXT NOT NULL, callback TEXT NOT NULL, secret_hash TEXT NOT NULL,
                expires REAL NOT NULL, PRIMARY KEY(principal,callback,secret_hash));
            """)

    def _db(self):
        db = sqlite3.connect(self.path, timeout=3)
        db.row_factory = sqlite3.Row
        return db

    def _id(self, principal, callback, name, args):
        digest = hashlib.sha256(_canonical([principal, callback, name, args]).encode()).hexdigest()
        return "sub_" + digest[:40]

    def list_events(self):
        return {"events": [{
            "name": EVENT_NAME,
            "description": "Notifica estado terminal de uma execução da rotina dedicada do Boss, filtrada por run_id.",
            "delivery": ["webhook"],
            "inputSchema": {"type":"object","properties":{"run_id":{"type":"string","minLength":1,"maxLength":128}},"required":["run_id"],"additionalProperties":False},
            "payloadSchema": {"type":"object","properties":{"run_id":{"type":"string"},"status":{"type":"string","enum":sorted(TERMINAL)},"summary":{"type":"string"},"reference":{"type":"string"}},"required":["run_id","status","summary","reference"],"additionalProperties":False}
        }]}

    def subscribe(self, params):
        if not isinstance(params, dict) or params.get("name") != EVENT_NAME:
            raise ValueError("invalid_event")
        args = params.get("arguments")
        delivery = params.get("delivery")
        if not isinstance(args, dict) or set(args) != {"run_id"}:
            raise ValueError("invalid_arguments")
        run_id = args["run_id"]
        # Ensures the run belongs to this bridge's configured Boss inbox.
        self.run_row(run_id)
        if not isinstance(delivery, dict) or delivery.get("mode") != "webhook":
            raise ValueError("webhook_delivery_required")
        callback = delivery.get("url")
        secret = delivery.get("secret")
        key = _secret_bytes(secret)
        _public_callback(callback)
        ttl = params.get("ttlMs", DEFAULT_TTL_MS)
        if ttl is None:
            ttl = DEFAULT_TTL_MS
        if not isinstance(ttl, int) or isinstance(ttl, bool) or ttl <= 0:
            raise ValueError("invalid_ttl")
        ttl = min(ttl, DEFAULT_TTL_MS)
        sub_id = self._id(self.principal_id, callback, EVENT_NAME, args)
        secret_hash = hashlib.sha256(secret.encode()).hexdigest()
        with self._db() as db:
            verified = db.execute("SELECT 1 FROM callback_verifications WHERE principal=? AND callback=? AND secret_hash=? AND expires>?",
                                  (self.principal_id,callback,secret_hash,time.time())).fetchone()
        if not verified:
            challenge = secrets.token_urlsafe(24)
            event_id = "msg_verification_" + uuid.uuid4().hex
            payload = _canonical({"type":"verification","challenge":challenge}).encode()
            timestamp = str(int(time.time()))
            headers = self._signed_headers(event_id, timestamp, payload, key, sub_id)
            try:
                code, raw = self.post_hook(callback, payload, headers)
                echoed = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception as exc:
                if isinstance(exc, TimeoutError) or isinstance(getattr(exc, "__cause__", None), TimeoutError):
                    raise ValueError("callback_endpoint_error: timeout") from None
                raise ValueError("callback_endpoint_error: challenge_failed") from None
            if not 200 <= code < 300 or not isinstance(echoed, dict) or not hmac.compare_digest(str(echoed.get("challenge", "")), challenge):
                raise ValueError("callback_endpoint_error: challenge_failed")
            with self._db() as db:
                db.execute("INSERT OR REPLACE INTO callback_verifications VALUES(?,?,?,?)",
                           (self.principal_id,callback,secret_hash,time.time()+3600))
        expires = time.time() + ttl / 1000
        with self._lock, self._db() as db:
            db.execute("""INSERT INTO subscriptions(id,principal,name,run_id,callback,secret,expires,active,status,attempts,next_attempt,created)
                VALUES(?,?,?,?,?,?,?,1,'pending',0,0,?) ON CONFLICT(id) DO UPDATE SET
                callback=excluded.callback, secret=excluded.secret, expires=excluded.expires, active=1, status='pending', attempts=0, next_attempt=0""",
                (sub_id,self.principal_id,EVENT_NAME,run_id,callback,secret,expires,time.time()))
        return {"id":sub_id,"refreshBefore":datetime.fromtimestamp(expires,timezone.utc).isoformat().replace("+00:00","Z"),"cursor":None,"truncated":False}

    def unsubscribe(self, params):
        if not isinstance(params, dict) or params.get("name") != EVENT_NAME:
            raise ValueError("invalid_event")
        args, delivery = params.get("arguments"), params.get("delivery")
        if not isinstance(args, dict) or set(args) != {"run_id"} or not isinstance(delivery, dict):
            raise ValueError("invalid_arguments")
        callback = delivery.get("url")
        sub_id = self._id(self.principal_id, callback, EVENT_NAME, args)
        with self._lock, self._db() as db:
            db.execute("UPDATE subscriptions SET active=0,status='unsubscribed',secret='' WHERE id=? AND principal=?",(sub_id,self.principal_id))
        return {}

    @staticmethod
    def _signed_headers(event_id, timestamp, body, key, sub_id):
        signed = event_id.encode() + b"." + timestamp.encode() + b"." + body
        sig = base64.b64encode(hmac.new(key,signed,hashlib.sha256).digest()).decode()
        return {"Content-Type":"application/json","webhook-id":event_id,"webhook-timestamp":timestamp,
                "webhook-signature":"v1,"+sig,"X-MCP-Subscription-Id":sub_id}

    def _queue_terminal(self, sub):
        with self._db() as db:
            existing = db.execute("SELECT * FROM event_outbox WHERE subscription_id=? AND status IN ('pending','retrying') AND next_attempt<=? ORDER BY created LIMIT 1",(sub["id"],time.time())).fetchone()
        if existing:
            self._deliver(sub, existing["event_id"], bytes(existing["body"]))
            return
        row = self.run_row(sub["run_id"])
        status = row.get("status")
        if status not in TERMINAL:
            return
        # Only emit after result tool can read a terminal representation. Payload never contains user-authored task/result text.
        result = self.run_result({"run_id":sub["run_id"]})
        if result.get("status") != status or (not result.get("result_available") and not row.get("error")):
            return
        event_id = "evt_" + hashlib.sha256((sub["id"] + ":" + sub["run_id"] + ":" + status).encode()).hexdigest()[:40]
        data = {"run_id":sub["run_id"],"status":status,"summary":"Execução terminal; consulte obter_resultado para o conteúdo autorizado.","reference":"obter_resultado:"+sub["run_id"]}
        stamp = row.get("updated_at")
        try:
            occurred = datetime.fromisoformat(stamp.replace("Z", "+00:00")) if isinstance(stamp, str) else datetime.fromtimestamp(float(stamp or time.time()),timezone.utc)
            if occurred.tzinfo is None:
                occurred = occurred.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError, OverflowError):
            occurred = datetime.now(timezone.utc)
        event = {"eventId":event_id,"name":EVENT_NAME,"timestamp":occurred.astimezone(timezone.utc).isoformat().replace("+00:00","Z"),"data":data,"cursor":None}
        body = json.dumps(event,ensure_ascii=False,separators=(",",":")).encode()
        if len(body) > MAX_CALLBACK_BYTES:
            return
        with self._db() as db:
            db.execute("INSERT OR IGNORE INTO event_outbox(event_id,subscription_id,body,created) VALUES(?,?,?,?)",(event_id,sub["id"],body,time.time()))
            db.commit()
        self._deliver(sub,event_id,body)

    def _deliver(self, sub, event_id, body):
        try:
            key = _secret_bytes(sub["secret"])
            timestamp = str(int(time.time()))
            headers = self._signed_headers(event_id,timestamp,body,key,sub["id"])
            code, _ = self.post_hook(sub["callback"],body,headers)
            if 200 <= code < 300:
                with self._db() as db:
                    db.execute("UPDATE subscriptions SET status='delivered',active=0,secret='' WHERE id=?",(sub["id"],))
                    db.execute("UPDATE event_outbox SET status='delivered' WHERE event_id=?",(event_id,)); db.commit()
            elif code in (410,413):
                with self._db() as db:
                    db.execute("UPDATE subscriptions SET status='failed_permanent',active=0,secret='' WHERE id=?",(sub["id"],)); db.commit()
                    db.execute("UPDATE event_outbox SET status='failed_permanent' WHERE event_id=?",(event_id,)); db.commit()
            else:
                self._retry(sub,event_id)
        except Exception:
            self._retry(sub,event_id)

    def _retry(self, sub, event_id=None):
        attempts = int(sub["attempts"]) + 1
        with self._db() as db:
            if attempts >= MAX_ATTEMPTS:
                db.execute("UPDATE subscriptions SET attempts=?,status='failed',active=0,secret='' WHERE id=?",(attempts,sub["id"]))
                if event_id:
                    db.execute("UPDATE event_outbox SET attempts=?,status='failed' WHERE event_id=?",(attempts,event_id))
            else:
                delay = min(3600, 15 * (2 ** (attempts-1)))
                db.execute("UPDATE subscriptions SET attempts=?,next_attempt=?,status='retrying' WHERE id=?",(attempts,time.time()+delay,sub["id"]))
                if event_id:
                    db.execute("UPDATE event_outbox SET attempts=?,next_attempt=?,status='retrying' WHERE event_id=?",(attempts,time.time()+delay,event_id))
            db.commit()

    def scan_once(self):
        now = time.time()
        with self._db() as db:
            db.execute("DELETE FROM callback_verifications WHERE expires<=?",(now,))
            db.execute("UPDATE subscriptions SET active=0,status='expired',secret='' WHERE expires<=? AND active=1",(now,))
            rows = db.execute("SELECT * FROM subscriptions WHERE principal=? AND active=1 AND expires>? AND next_attempt<=?",(self.principal_id,now,now)).fetchall()
        for sub in rows:
            try:
                self._queue_terminal(dict(sub))
            except Exception:
                # No payloads or errors are logged; next monitor cycle can retry.
                pass

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        def work():
            while not self._stop.wait(self.interval):
                self.scan_once()
        self._thread = __import__("threading").Thread(target=work,name="mcp-events-monitor",daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
