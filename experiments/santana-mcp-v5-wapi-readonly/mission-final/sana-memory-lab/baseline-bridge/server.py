#!/usr/bin/env python3
"""Tiny, stateless MCP-over-HTTP adapter for OpenBot 0.33 local scripts and read-only run history.

External access must go through an authenticated TLS reverse proxy after review.
Runs as the unprivileged 'openbot' user, binds to loopback, never runs shell commands.
"""
import hmac
import json
from contextlib import closing
import os
import re
import sqlite3
import sys
import time
import hashlib
import logging
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
# python -I intentionally removes the script directory; add only this root-owned
# sibling module location so the service can load its reviewed companion module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from events import EventStore, EVENT_NAME
from task_queue import TaskQueue, LIMIT as DISPATCH_LIMIT_PER_HOUR, DISPATCH_INTERVAL as DISPATCH_INTERVAL_SECONDS
from agent_messages import AgentMessageStore, MAX_MESSAGE_CHARS

logger = logging.getLogger("openbot_bridge")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _bridge_handler = logging.StreamHandler()
    _bridge_handler.setLevel(logging.INFO)
    _bridge_handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"
    ))
    logger.addHandler(_bridge_handler)
logger.propagate = False

VERSION = "0.4.2-direct-agent-messages-candidate"
MCP_VERSION = "2026-07-28"
PORT = int(os.getenv("BRIDGE_PORT", "8768"))
TOKEN = os.getenv("BRIDGE_AUTH_TOKEN", "")
BOSS_ID = os.getenv("BRIDGE_BOSS_AGENT_ID", "")
TASK_ROUTINE_ID = os.getenv("BRIDGE_TASK_ROUTINE_ID", "")
DISPATCH = os.getenv("BRIDGE_DISPATCH_ENABLED", "0") == "1"
DIRECT_AGENT_MESSAGES = os.getenv("BRIDGE_DIRECT_AGENT_MESSAGES_ENABLED", "0") == "1"
AUTOMATION = Path(os.getenv("BRIDGE_AUTOMATION_DIR", "/var/lib/openbot/.config/OpenBot/automation"))
MAX_TASK_CHARS = 3800
MAX_REQUEST_BYTES = 16000
MAX_RUNS = 50
MAX_RESULT_CHARS = 12000
RUN_DB = Path(os.getenv("BRIDGE_RUN_DB", "/var/lib/openbot/.config/OpenBot/openbot.db"))
EVENT_DB = Path(os.getenv("BRIDGE_EVENT_DB", str(AUTOMATION / "mcp-events.sqlite")))
EVENT_POLL_INTERVAL = int(os.getenv("BRIDGE_EVENT_POLL_SECONDS", "60"))
REQUEST_TIMEOUT = 6
_opener = build_opener(ProxyHandler({}))
_event_store = None
_task_queue = None
_agent_messages = None

TOOLS = [
    {
        "name": "bridge_status",
        "description": "Verifica a saúde da ponte e se Local Scripts está ativo. Apenas leitura; não mostra segredos.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "list_openbot_agents",
        "description": "Lista SOMENTE agentes do OpenBot com Local Scripts ativado e suas rotinas. Apenas leitura.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "enviar_mensagem_agente",
        "description": (
            "Envia uma mensagem diretamente ao agente selecionado, somente se ele aparecer na lista autorizada do Local Scripts. "
            "Exige autorização explícita do usuário para cada envio e idempotency_key estável. "
            "O recibo HTTP 202 não significa conclusão; use consultar_execucao_agente e obter_resposta_agente."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,128}$"},
                "message": {"type": "string", "minLength": 1, "maxLength": MAX_MESSAGE_CHARS},
                "idempotency_key": {"type": "string", "pattern": "^[A-Za-z0-9_-]{8,128}$"},
            },
            "required": ["agent_id", "message", "idempotency_key"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "consultar_execucao_agente",
        "description": "Consulta somente o estado de uma mensagem direta pelo request_id persistido; não reenvia.",
        "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string", "pattern": "^[a-f0-9]{32}$"}}, "required": ["request_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "obter_resposta_agente",
        "description": "Recupera resposta final e erro correlacionados por delivery_id em modo somente leitura. Nunca reenvia.",
        "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string", "pattern": "^[a-f0-9]{32}$"}}, "required": ["request_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "enviar_tarefa",
        "description": (
            "Enfileira uma tarefa em uma rotina do Boss autorizada na VPS. "
            "Exige autorização explícita do usuário para cada tarefa; NÃO informa conclusão. "
            "Não executa comandos shell diretamente nem publica código."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string", "maxLength": MAX_TASK_CHARS, "description": "Tarefa autorizada pelo usuário."},
                "idempotency_key": {"type": "string", "pattern": "^[A-Za-z0-9_-]{8,128}$", "description": "Chave opcional para tornar repetições da mesma solicitação idempotentes."},
            },
            "required": ["task"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "consultar_tarefa",
        "description": "Consulta estado persistido de uma solicitação da fila pelo task_id.",
        "inputSchema": {"type":"object","properties":{"task_id":{"type":"string","pattern":"^[a-f0-9]{32}$"}},"required":["task_id"],"additionalProperties":False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "obter_resultado_tarefa",
        "description": "Obtém resultado persistido de uma solicitação concluída pelo task_id.",
        "inputSchema": {"type":"object","properties":{"task_id":{"type":"string","pattern":"^[a-f0-9]{32}$"}},"required":["task_id"],"additionalProperties":False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "reconciliar_tarefa",
        "description": "Reconsulta somente leitura o run_id já associado ao task_id e atualiza o resultado se estiver disponível. Nunca reenvia a tarefa.",
        "inputSchema": {"type":"object","properties":{"task_id":{"type":"string","pattern":"^[a-f0-9]{32}$"}},"required":["task_id"],"additionalProperties":False},
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False},
    },
    {
        "name": "consultar_status",
        "description": "Consulta somente o estado atual de uma execução identificada. Apenas leitura.",
        "inputSchema": {"type": "object", "properties": {"run_id": {"type": "string"}}, "required": ["run_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "obter_resultado",
        "description": "Obtém o resultado final limitado de uma execução identificada. Apenas leitura.",
        "inputSchema": {"type": "object", "properties": {"run_id": {"type": "string"}}, "required": ["run_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]


def _automation_connection():
    """Read local user-owned OpenBot auth files without emitting them to the client/log."""
    url_file = AUTOMATION / "url"
    headers_file = AUTOMATION / "headers"
    for file in (url_file, headers_file):
        st = file.stat()
        if st.st_uid != os.geteuid() or (st.st_mode & 0o077):
            raise RuntimeError("Permissões inseguras nos arquivos do OpenBot Local Scripts.")
    url = url_file.read_text(encoding="utf-8").strip().rstrip("/")
    header = headers_file.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{2,5}", url):
        raise RuntimeError("URL local do OpenBot inválida.")
    port = int(url.rsplit(":", 1)[-1])
    if not 1 <= port <= 65535:
        raise RuntimeError("Porta local do OpenBot inválida.")
    if not header.startswith("Authorization: Bearer ") or "\n" in header or "\r" in header:
        raise RuntimeError("Header de autenticação do OpenBot inválido.")
    return url, header.split(": ", 1)[1].split(" ", 1)[1]


def _openbot_request(method, suffix, body=None):
    url, token = _automation_connection()
    allowed_route = suffix == "/v1/agents" or bool(re.fullmatch(r"/v1/agents/[A-Za-z0-9_-]+/messages", suffix)) or bool(re.fullmatch(r"/v1/agents/[A-Za-z0-9_-]+/routines/[A-Za-z0-9_-]+/(?:run|runs)", suffix))
    if not allowed_route:
        raise ValueError("Rota do OpenBot inválida")
    if (suffix == "/v1/agents" and method != "GET") or (suffix.endswith("/messages") and method != "POST") or ("/routines/" in suffix and method != ("POST" if suffix.endswith("/run") else "GET")):
        raise ValueError("Método não permitido para a rota do OpenBot.")
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = Request(
        url + suffix,
        data=payload,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with _opener.open(request, timeout=REQUEST_TIMEOUT) as response:
            data = response.read(32000)
            return json.loads(data.decode("utf-8")) if data else {}
    except HTTPError as err:
        if err.code == 429:
            failure = RuntimeError("OpenBot aplicou limite (HTTP 429).")
            failure.status_code = 429
            raise failure from None
        raise RuntimeError(f"OpenBot recusou a chamada (HTTP {err.code}).") from None
    except URLError:
        raise RuntimeError("OpenBot Local Scripts não respondeu.") from None


def _run_row(run_id):
    """Fetch one run from the configured Boss routine in OpenBot's SQLite projection, read-only."""
    if not BOSS_ID or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", BOSS_ID):
        raise RuntimeError("Boss não está configurado para leitura.")
    if not TASK_ROUTINE_ID or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", TASK_ROUTINE_ID):
        raise RuntimeError("Rotina dedicada não está configurada para leitura.")
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", run_id):
        raise ValueError("ID de execução inválido.")
    try:
        st = RUN_DB.stat()
    except FileNotFoundError:
        raise RuntimeError("Banco local de histórico do OpenBot não foi encontrado.") from None
    if st.st_uid != os.geteuid() or (st.st_mode & 0o077):
        raise RuntimeError("Permissões inseguras no banco local de histórico.")
    uri = RUN_DB.resolve().as_uri() + "?mode=ro"
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(
                "SELECT r.run_id, r.routine_id, r.agent_id, r.status, r.error, r.created_at, r.updated_at, "
                "r.delivery_id, d.turn_id, t.thread_id "
                "FROM projection_routine_runs r "
                "LEFT JOIN projection_deliveries d ON d.delivery_id = r.delivery_id "
                "LEFT JOIN projection_turns t ON t.turn_id = d.turn_id "
                "WHERE r.run_id = ? AND r.routine_id = ? AND r.agent_id = ? LIMIT 1",
                (run_id, TASK_ROUTINE_ID, BOSS_ID),
            ).fetchone()
            if row is None:
                raise LookupError("Execução não encontrada nessa rotina do Boss.")
            return dict(row)
    except sqlite3.Error:
        raise RuntimeError("Não foi possível ler o histórico local do OpenBot em modo somente leitura.") from None


def _validated_run_args(args):
    if not isinstance(args, dict) or set(args) != {"run_id"}:
        raise ValueError("Informe apenas run_id.")
    return args["run_id"]


def _legacy_run_or_task_id(args):
    """Keep the legacy run_id schema while safely accepting an existing queue task_id."""
    value = _validated_run_args(args)
    if not isinstance(value, str):
        raise ValueError("ID inválido.")
    if re.fullmatch(r"[a-f0-9]{32}", value):
        try:
            row = _task_queue.get(value)
        except LookupError:
            row = None
        if row is not None:
            return "task", row
    return "run", value


def _run_status(args):
    kind, value = _legacy_run_or_task_id(args)
    if kind == "task":
        row = value
        return {"task_id": row["task_id"], "run_id": row["run_id"], "state": row["state"], "delivery_id": row["delivery_id"], "error": row["error"], "created_at": row["created"], "updated_at": row["updated"]}
    run_id = value
    row = _run_row(run_id)
    return {"run_id": row["run_id"], "routine_id": row["routine_id"], "status": row["status"], "created_at": row["created_at"], "updated_at": row["updated_at"], "error": row["error"]}


def _run_result(args):
    started = time.monotonic()
    kind, value = _legacy_run_or_task_id(args)
    if kind == "task":
        row = value
        logger.info("task_result_read task_id=%s run_id=%s state=%s result_available=%s duration_ms=%.3f", row["task_id"], row["run_id"] or "-", row["state"], row["result"] is not None, (time.monotonic() - started) * 1000)
        return {"task_id": row["task_id"], "run_id": row["run_id"], "status": row["state"], "result_available": row["result"] is not None, "result": row["result"], "error": row["error"]}
    run_id = value
    row = _run_row(run_id)
    status = row["status"]
    if status not in ("succeeded", "failed", "interrupted", "cancelled", "needs-attention"):
        logger.info("run_result_read run_id=%s state=%s result_available=false duration_ms=%.3f", row["run_id"], status, (time.monotonic() - started) * 1000)
        return {"run_id": row["run_id"], "status": status, "result_available": False, "message": "A execução ainda não terminou."}
    if not row["turn_id"] or not row["thread_id"]:
        logger.info("run_result_read run_id=%s state=%s result_available=false reason=no_turn_link duration_ms=%.3f", row["run_id"], status, (time.monotonic() - started) * 1000)
        return {"run_id": row["run_id"], "status": status, "result_available": False, "error": row["error"], "message": "A execução terminou sem um turno associado para recuperar a resposta."}
    try:
        uri = RUN_DB.resolve().as_uri() + "?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
            rows = db.execute(
                "SELECT author, status, item_type, message_json FROM projection_thread_messages "
                "WHERE thread_id = ? AND turn_id = ? ORDER BY ordinal LIMIT 100",
                (row["thread_id"], row["turn_id"]),
            ).fetchall()
        texts = []
        for author, message_status, item_type, raw in rows:
            if author != "assistant" or message_status != "completed" or item_type != "final_answer":
                continue
            try:
                message = json.loads(raw)
            except (TypeError, ValueError):
                continue
            value = message.get("text") if isinstance(message, dict) else None
            if isinstance(value, str) and value.strip():
                texts.append(value.strip())
        output = "\n\n".join(texts)[-MAX_RESULT_CHARS:]
        logger.info("run_result_read run_id=%s state=%s result_available=%s duration_ms=%.3f", row["run_id"], status, bool(output), (time.monotonic() - started) * 1000)
        return {"run_id": row["run_id"], "status": status, "result_available": bool(output), "result": output or None, "error": row["error"], "truncated": sum(map(len, texts)) > MAX_RESULT_CHARS}
    except sqlite3.Error:
        logger.warning("run_result_read run_id=%s error_class=sqlite3.Error duration_ms=%.3f", row["run_id"], (time.monotonic() - started) * 1000)
        raise RuntimeError("Não foi possível ler a resposta local do OpenBot em modo somente leitura.") from None


def _agent_list():
    try:
        items = _openbot_request("GET", "/v1/agents")
        if not isinstance(items, list):
            raise RuntimeError("Resposta inesperada da API local do OpenBot")
        return items
    except FileNotFoundError:
        raise RuntimeError("Ative Local Scripts no Boss para disponibilizar a API local.") from None


def _authorized_agent(agent_id):
    return any(isinstance(item, dict) and item.get("id") == agent_id for item in _agent_list())


def _dispatch_agent_message(agent_id, text, client_message_id):
    return _openbot_request("POST", f"/v1/agents/{agent_id}/messages", {"text": text, "clientMessageId": client_message_id})


def _agent_message_store():
    if _agent_messages is None:
        raise PermissionError("Envio direto a agentes não está inicializado ou permanece desabilitado.")
    return _agent_messages


def _send_agent_message(args):
    if not isinstance(args, dict) or set(args) != {"agent_id", "message", "idempotency_key"}:
        raise ValueError("Informe agent_id, message e idempotency_key.")
    return _agent_message_store().submit(args["agent_id"], args["message"], args["idempotency_key"])


def _agent_message_status(args):
    if not isinstance(args, dict) or set(args) != {"request_id"}:
        raise ValueError("Informe apenas request_id.")
    return _agent_message_store().status(args["request_id"], with_result=False)


def _agent_message_result(args):
    if not isinstance(args, dict) or set(args) != {"request_id"}:
        raise ValueError("Informe apenas request_id.")
    return _agent_message_store().status(args["request_id"], with_result=True)


def _status():
    alive = False
    reason = "Local Scripts ainda não está ativo."
    try:
        agents = _agent_list()
        alive = True
        reason = f"{len(agents)} agente(s) habilitado(s)."
    except Exception as exc:
        reason = str(exc)
    return {
        "bridge": "online",
        "version": VERSION,
        "openbot_local_scripts": "online" if alive else "offline",
        "details": reason,
        "boss_id_configured": bool(BOSS_ID),
        "dispatch_enabled": DISPATCH and bool(BOSS_ID),
        "dispatch_limit_per_hour": DISPATCH_LIMIT_PER_HOUR,
        "dispatch_interval_seconds": DISPATCH_INTERVAL_SECONDS,
        "direct_agent_messages_enabled": DIRECT_AGENT_MESSAGES,
        "note": "Recebimento não significa conclusão; consulte as execuções no OpenBot.",
    }


def _submit(args):
    if not isinstance(args, dict) or not set(args).issubset({"task", "idempotency_key"}) or "task" not in args:
        raise ValueError("Informe task e, opcionalmente, idempotency_key.")
    routine_id, task = TASK_ROUTINE_ID, args["task"]
    if not routine_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", routine_id):
        raise PermissionError("Rotina dedicada não configurada; envio permanece indisponível.")
    if not isinstance(task, str) or not task.strip() or len(task) > MAX_TASK_CHARS:
        raise ValueError("Tarefa vazia ou maior que o limite permitido.")
    key = args.get("idempotency_key")
    if key is not None and (not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key)):
        raise ValueError("idempotency_key inválida.")
    if not DISPATCH or not BOSS_ID or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", BOSS_ID):
        raise PermissionError("Envio de tarefas desabilitado. Configure o Boss após testar o modo leitura.")
    agents = _agent_list()
    boss = next((x for x in agents if isinstance(x, dict) and x.get("id") == BOSS_ID), None)
    if not boss:
        raise PermissionError("Boss não encontrado entre agentes que permitem Local Scripts.")
    routines = boss.get("routines") or []
    if not any(isinstance(r, dict) and r.get("id") == routine_id for r in routines):
        raise PermissionError("A rotina não pertence ao Boss configurado.")
    row, created = _task_queue.enqueue(task.strip(), key)
    logger.info("task_accepted task_id=%s state=%s created=%s", row["task_id"], row["state"], created)
    return {
        "accepted": True, "created": created, "task_id": row["task_id"],
        "state": row["state"], "run_id": row["run_id"],
        "message": "Solicitação persistida; consulte consultar_tarefa/obter_resultado_tarefa pelo task_id.",
    }


def _task_status(args):
    if not isinstance(args, dict) or set(args) != {"task_id"} or not isinstance(args["task_id"], str) or not re.fullmatch(r"[a-f0-9]{32}", args["task_id"]):
        raise ValueError("Informe task_id válido.")
    row = _task_queue.get(args["task_id"])
    logger.info("task_status_read task_id=%s run_id=%s delivery_id=%s state=%s", row["task_id"], row["run_id"] or "-", row["delivery_id"] or "-", row["state"])
    return {k: row[k] for k in ("task_id", "state", "run_id", "delivery_id", "attempts", "error", "created", "updated")}


def _task_result(args):
    _task_status(args)
    row = _task_queue.get(args["task_id"])
    logger.info("task_result_read task_id=%s run_id=%s state=%s result_available=%s", row["task_id"], row["run_id"] or "-", row["state"], row["result"] is not None)
    return {"task_id": row["task_id"], "state": row["state"], "result_available": row["result"] is not None,
            "result": row["result"], "error": row["error"]}


def _task_reconcile(args):
    _task_status(args)
    task_id = args["task_id"]
    started = time.monotonic()
    _task_queue._sync_running(task_id)
    result = _task_result({"task_id": task_id})
    logger.info("task_reconcile_complete task_id=%s run_id=%s state=%s result_available=%s duration_ms=%.3f", task_id, result["run_id"] or "-", result["state"], result["result_available"], (time.monotonic() - started) * 1000)
    return result


def _dispatch_queued(task, task_id):
    # The marker gives operators a recovery clue if OpenBot accepts but the HTTP reply is lost.
    payload = f"{task}\n\n[bridge-task-id:{task_id}]"
    return _openbot_request("POST", f"/v1/agents/{BOSS_ID}/routines/{TASK_ROUTINE_ID}/run", {"payload": payload})


def _queue_enabled():
    return DISPATCH and bool(BOSS_ID) and bool(TASK_ROUTINE_ID)


def _lookup_for_queue(run_id):
    return _run_row(run_id)


def _queue_result(run_id):
    result = _run_result({"run_id": run_id})
    return result.get("result") if result.get("result_available") else None


_lookup_for_queue.result = _queue_result


def _tool_response(result=None, error=None):
    payload = result if error is None else {"error": error}
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}], "isError": error is not None}


def _rpc_log_labels(message):
    method = message.get("method") if isinstance(message, dict) else None
    methods = {"initialize", "server/discover", "ping", "tools/list", "tools/call", "events/list", "events/subscribe", "events/unsubscribe"}
    if method not in methods:
        method = "other"
    params = message.get("params") if isinstance(message, dict) else None
    tool = params.get("name") if method == "tools/call" and isinstance(params, dict) else None
    allowed_tools = {item["name"] for item in TOOLS}
    return method, tool if tool in allowed_tools else "other"


def rpc(message):
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid JSON-RPC request"}}
    if "id" not in message:  # MCP client notifications, including initialized
        return None
    identifier = message["id"]
    method = message.get("method")
    try:
        if method == "initialize":
            requested = (message.get("params") or {}).get("protocolVersion")
            negotiated = requested if requested in ("2025-06-18", MCP_VERSION) else MCP_VERSION
            capabilities = {"tools": {"listChanged": False}}
            if negotiated == MCP_VERSION:
                capabilities["events"] = {}
            result = {
                "protocolVersion": negotiated,
                "capabilities": capabilities,
                "serverInfo": {"name": "OpenBot Bridge", "version": VERSION},
            }
        elif method == "server/discover":
            result = {"resultType":"complete","supportedVersions":[MCP_VERSION],"capabilities":{"tools":{},"events":{}}}
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "events/list":
            if _event_store is None:
                raise RuntimeError("MCP Events indisponível")
            result = _event_store.list_events()
        elif method == "events/subscribe":
            if _event_store is None:
                raise RuntimeError("MCP Events indisponível")
            result = _event_store.subscribe(message.get("params"))
        elif method == "events/unsubscribe":
            if _event_store is None:
                raise RuntimeError("MCP Events indisponível")
            result = _event_store.unsubscribe(message.get("params"))
        elif method == "tools/call":
            params = message.get("params")
            if not isinstance(params, dict):
                raise ValueError("Params inválidos.")
            tool = params.get("name")
            args = params.get("arguments") or {}
            if tool == "bridge_status":
                result = _tool_response(_status())
            elif tool == "list_openbot_agents":
                result = _tool_response({"agents": _agent_list()})
            elif tool == "enviar_mensagem_agente":
                result = _tool_response(_send_agent_message(args))
            elif tool == "consultar_execucao_agente":
                result = _tool_response(_agent_message_status(args))
            elif tool == "obter_resposta_agente":
                result = _tool_response(_agent_message_result(args))
            elif tool == "enviar_tarefa":
                result = _tool_response(_submit(args))
            elif tool == "consultar_tarefa":
                result = _tool_response(_task_status(args))
            elif tool == "obter_resultado_tarefa":
                result = _tool_response(_task_result(args))
            elif tool == "reconciliar_tarefa":
                result = _tool_response(_task_reconcile(args))
            elif tool == "consultar_status":
                result = _tool_response(_run_status(args))
            elif tool == "obter_resultado":
                result = _tool_response(_run_result(args))
            else:
                raise KeyError("Ferramenta desconhecida")
        else:
            raise KeyError("Método não encontrado")
        return {"jsonrpc": "2.0", "id": identifier, "result": result}
    except LookupError as exc:
        method_label, tool_label = _rpc_log_labels(message)
        logger.warning("bridge_rpc_error method=%s tool=%s rpc_code=-32602 error_class=%s", method_label, tool_label, type(exc).__name__)
        if method == "tools/call":
            return {"jsonrpc": "2.0", "id": identifier, "result": _tool_response(error=str(exc))}
        return {"jsonrpc": "2.0", "id": identifier, "error": {"code": -32602, "message": str(exc)}}
    except KeyError as exc:
        method_label, tool_label = _rpc_log_labels(message)
        logger.warning("bridge_rpc_error method=%s tool=%s rpc_code=-32601 error_class=%s", method_label, tool_label, type(exc).__name__)
        return {"jsonrpc": "2.0", "id": identifier, "error": {"code": -32601, "message": str(exc)}}
    except (ValueError, PermissionError, RuntimeError, OSError) as exc:
        method_label, tool_label = _rpc_log_labels(message)
        logger.warning("bridge_rpc_error method=%s tool=%s rpc_code=-32602 error_class=%s", method_label, tool_label, type(exc).__name__)
        if method == "events/subscribe" and "callback_endpoint_error:" in str(exc):
            reason = str(exc).split("callback_endpoint_error:",1)[1].strip().split()[0]
            allowed = {"https_required","invalid_url","nonstandard_port","dns_failed","dns_empty","non_public_address","invalid_signing_secret","challenge_failed","timeout"}
            if reason not in allowed:
                reason = "challenge_failed"
            return {"jsonrpc":"2.0","id":identifier,"error":{"code":-32015,"message":"Callback endpoint verification failed","data":{"reason":reason}}}
        # Use MCP tool-level isError for execution errors so callers can retry safely.
        if method == "tools/call":
            return {"jsonrpc": "2.0", "id": identifier, "result": _tool_response(error=str(exc))}
        return {"jsonrpc": "2.0", "id": identifier, "error": {"code": -32602, "message": str(exc)}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OpenBotBridge/0.1"

    def log_message(self, fmt, *args):
        # Never log bodies, tokens, prompts, query parameters, headers, or arbitrary paths.
        path = self.path.split("?", 1)[0]
        path_label = path if path in ("/mcp", "/health") else "other"
        sys.stderr.write("bridge-request %s %s\n" % (self.command, path_label))

    def send_response(self, code, message=None):
        path = self.path.split("?", 1)[0]
        path_label = path if path in ("/mcp", "/health") else "other"
        logger.info("bridge_http_response method=%s path=%s status=%s", self.command, path_label, code)
        return super().send_response(code, message)

    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {"service": "openbot-bridge", "ready": True, "bound_to_localhost": True})
        self.send_json(405 if self.path == "/mcp" else 404, {"error": "method_not_allowed"})

    def do_POST(self):
        started = time.monotonic()
        if self.path != "/mcp":
            return self.send_json(404, {"error": "not_found"})
        if self.headers.get("Origin") is not None:
            return self.send_json(403, {"error": "browser_requests_disallowed"})
        bearer = self.headers.get("Authorization", "")
        if not TOKEN or not hmac.compare_digest(bearer, "Bearer " + TOKEN):
            return self.send_json(401, {"error": "unauthorized"})
        if "application/json" not in self.headers.get("Content-Type", ""):
            return self.send_json(415, {"error": "json_required"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"error": "invalid_length"})
        if not 0 < size <= MAX_REQUEST_BYTES:
            return self.send_json(413, {"error": "request_too_large_or_empty"})
        try:
            doc = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "invalid_json"})
        if isinstance(doc, list):
            return self.send_json(400, {"error": "batch_not_supported"})
        response = rpc(doc)
        if response is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
            method = doc.get("method") if isinstance(doc, dict) else None
            if method not in {"initialize", "server/discover", "ping", "tools/list", "tools/call", "events/list", "events/subscribe", "events/unsubscribe"}:
                method = "other"
            logger.info("bridge_rpc_http method=%s outcome=notification status=202 duration_ms=%.3f", method, (time.monotonic() - started) * 1000)
            return
        rpc_method = doc.get("method") if isinstance(doc, dict) else None
        if rpc_method not in {"initialize", "server/discover", "ping", "tools/list", "tools/call", "events/list", "events/subscribe", "events/unsubscribe"}:
            rpc_method = "other"
        if isinstance(response, dict) and "error" in response:
            outcome = "rpc_error"
        elif isinstance(response, dict) and isinstance(response.get("result"), dict) and response["result"].get("isError"):
            outcome = "tool_error"
        else:
            outcome = "ok"
        logger.info("bridge_rpc_http method=%s outcome=%s status=200 duration_ms=%.3f", rpc_method, outcome, (time.monotonic() - started) * 1000)
        self.send_json(200, response)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    if not TOKEN or len(TOKEN) < 32:
        raise SystemExit("A chave BRIDGE_AUTH_TOKEN não foi configurada corretamente.")
    _event_store = EventStore(
        EVENT_DB,
        _run_row,
        _run_result,
        hashlib.sha256(TOKEN.encode("utf-8")).hexdigest(),
        interval=EVENT_POLL_INTERVAL,
    )
    _event_store.start()
    _task_queue = TaskQueue(EVENT_DB, _dispatch_queued, _lookup_for_queue, _queue_enabled)
    _task_queue.start()
    if DIRECT_AGENT_MESSAGES:
        _agent_messages = AgentMessageStore(EVENT_DB, RUN_DB, _dispatch_agent_message, _authorized_agent, enabled=True)
    with BridgeServer(("127.0.0.1", PORT), Handler) as server:
        print(f"OpenBot Bridge {VERSION} listening on 127.0.0.1:{PORT}", flush=True)
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            _task_queue.stop()
            _event_store.stop()
