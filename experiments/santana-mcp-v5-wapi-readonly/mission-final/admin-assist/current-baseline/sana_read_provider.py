"""MCP client for a dedicated read-only Sana snapshot Edge Function.

The Edge Function reuses the Panel's sana_panel_fast_snapshot RPC. This
provider never connects to PostgreSQL and never sends operator/admin tokens.
"""
from __future__ import annotations

import json
import re
import inspect
from datetime import datetime
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

MAX_PAGE_SIZE = 50
MAX_MESSAGES = 100
READ_ENDPOINT_PATH = "/functions/v1/sana-mcp-read"


class OAuthAuthenticationError(PermissionError):
    """The upstream Auth gateway rejected or expired the caller's OAuth JWT."""


def _validate_endpoint(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co")
            or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path.rstrip("/") != READ_ENDPOINT_PATH):
        raise ValueError("SANA_READ_ENDPOINT deve ser HTTPS e apontar somente para /functions/v1/sana-mcp-read.")
    return endpoint.rstrip("/")


def _validate_phone(phone: str) -> str:
    if not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone.strip()):
        raise ValueError("Informe o telefone em formato internacional E.164.")
    return phone.strip()


def _validate_uuid(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", value):
        raise ValueError("conversation_id inválido.")
    return value


def _validate_cursor(before: str | None, before_key: str | None) -> tuple[str | None, str | None]:
    if before is None and before_key is None:
        return None, None
    if not isinstance(before, str) or not isinstance(before_key, str) or not before_key or len(before_key) > 200:
        raise ValueError("Cursor de mensagens inválido.")
    try:
        datetime.fromisoformat(before.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Cursor de mensagens inválido.") from None
    return before, before_key


def _http_transport(endpoint: str, token: str, body: dict[str, Any], timeout: float,
                    *, forward_bearer: bool = False) -> tuple[int, dict[str, Any]]:
    # The static header is retained only for the legacy private adapter. The HOMOLOG
    # path forwards the caller's short-lived Supabase JWT in Authorization so the
    # Edge Function can validate the individual operator and OAuth client.
    auth_header = {"Authorization": "Bearer " + token} if forward_bearer else {"X-Sana-MCP-Read-Token": token}
    request = Request(endpoint, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        **auth_header,
    })
    maximum=3_000_000 if body.get('mode')=='attachment' else 2_000_000
    if body.get('mode')=='attachment':
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):return None
        opener=build_opener(NoRedirect()).open
        timeout=35
    else:opener=urlopen
    try:
        with opener(request, timeout=timeout) as response:
            status, raw = response.status, response.read(maximum+1)
    except HTTPError as exc:
        status, raw = exc.code, exc.read(maximum+1)
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("A leitura do snapshot Sana falhou; nenhuma credencial foi enviada além do token MCP de leitura.") from None
    if len(raw) > maximum:
        raise RuntimeError("Resposta do snapshot excedeu o limite permitido.")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError("Resposta inválida do snapshot Sana.") from None
    if not isinstance(data, dict):
        raise RuntimeError("Resposta inválida do snapshot Sana.")
    return status, data


class SanaReadProvider:
    """A narrow client for the dedicated MCP read endpoint."""

    def __init__(self, endpoint: str, token: str,
                 transport: Callable[[str, str, dict[str, Any], float], tuple[int, dict[str, Any]]] | None = None,
                 timeout: float = 12.0, *, forward_bearer: bool = False):
        self.endpoint = _validate_endpoint(endpoint)
        if not isinstance(token, str) or (token and len(token) < 32):
            raise ValueError("A credencial está vazia ou é curta demais.")
        if not token and not forward_bearer:
            raise ValueError("Informe credencial de leitura ou habilite o pass-through OAuth.")
        self.token = token
        self._transport = transport or _http_transport
        self.timeout = timeout
        self.forward_bearer = forward_bearer
        try:
            self._transport_supports_bearer_kw = transport is None or "forward_bearer" in inspect.signature(transport).parameters
        except (TypeError, ValueError):
            self._transport_supports_bearer_kw = False

    def _call(self, body: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
        token = access_token if self.forward_bearer else self.token
        if not isinstance(token, str) or len(token) < 16 or len(token) > 16_384:
            raise PermissionError("É necessário um token individual Supabase Auth válido.")
        if self.forward_bearer and not _looks_like_jwt(token):
            raise PermissionError("A credencial individual não tem formato JWT.")
        if self._transport_supports_bearer_kw:
            status, result = self._transport(self.endpoint, token, body, self.timeout,
                                             forward_bearer=self.forward_bearer)
        else:
            status, result = self._transport(self.endpoint, token, body, self.timeout)
        if status == 401 and self.forward_bearer:
            raise OAuthAuthenticationError("A sessão OAuth expirou ou não foi aceita; autentique-se novamente.")
        if status == 403 and result.get("status") == "read_access_denied":
            raise PermissionError("A leitura exige identidade individual verificada e o escopo correspondente; include_content=true sozinho não autoriza.")
        if status==403 and re.fullmatch(r'MCP_ADMIN_[A-Z_]+',str(result.get('status',''))):raise PermissionError(result['status'])
        if status != 200 or result.get("status") != "ready":
            # Do not forward upstream diagnostics, SQL errors, or payload fragments.
            raise RuntimeError("Consulta ao snapshot Sana indisponível.")
        return result

    def list_conversations(self, per_page: int = 20, page: int = 1, access_token: str | None = None) -> dict[str, Any]:
        if not isinstance(per_page, int) or isinstance(per_page, bool) or not 1 <= per_page <= MAX_PAGE_SIZE:
            raise ValueError(f"per_page deve estar entre 1 e {MAX_PAGE_SIZE}.")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 10:
            raise ValueError("page deve estar entre 1 e 10; o snapshot do Painel limita a 500 conversas.")
        result = self._call({"mode": "conversations", "page": page, "per_page": per_page}, access_token)
        return {key: result[key] for key in ("source", "page", "per_page", "items", "has_more", "truncated_at_provider_limit") if key in result}

    def get_conversation(self, phone: str, access_token: str | None = None) -> dict[str, Any]:
        if self.forward_bearer:
            conversation_id = _validate_uuid(phone)
            result = self._call({"mode": "contact", "conversation_id": conversation_id}, access_token)
            return {"source": result.get("source", "synthetic_homolog"), "conversation": result.get("contact")}
        phone = _validate_phone(phone)
        result = self._call({"mode": "contact", "phone": phone}, access_token)
        return {"source": result.get("source", "sana_panel_fast_snapshot"), "conversation": result.get("conversation")}

    def list_contacts(self, per_page: int = 20, page: int = 1, access_token: str | None = None) -> dict[str, Any]:
        conversations = self.list_conversations(per_page, page, access_token)
        items = [{"conversation_id": row["conversation_id"],
                  "contact_key": row["contact_key"],
                  "name_available": bool(row.get("name_available"))}
                 for row in conversations.get("items", [])]
        return {**{k: v for k, v in conversations.items() if k != "items"}, "items": items}

    def get_contact(self, contact_id: str | None = None, phone: str | None = None,
                    access_token: str | None = None) -> dict[str, Any]:
        if bool(contact_id) == bool(phone):
            raise ValueError("Informe somente contact_id ou phone.")
        body: dict[str, Any] = {"mode": "contact"}
        if phone:
            body["phone"] = _validate_phone(phone)
        else:
            body["conversation_id"] = _validate_uuid(contact_id or "")
        result = self._call(body, access_token)
        return {"source": result.get("source", "sana_panel_fast_snapshot"), "contact": result.get("contact")}

    def get_messages(self, conversation_id: str, limit: int = 50, include_content: bool = False,
                     before: str | None = None, before_key: str | None = None,
                     access_token: str | None = None) -> dict[str, Any]:
        conversation_id = _validate_uuid(conversation_id)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_MESSAGES:
            raise ValueError(f"limit deve estar entre 1 e {MAX_MESSAGES}.")
        if not isinstance(include_content, bool):
            raise ValueError("include_content deve ser booleano.")
        if include_content and limit > 20:
            raise ValueError("A leitura autorizada de conteúdo limita cada página a 20 mensagens.")
        before, before_key = _validate_cursor(before, before_key)
        body: dict[str, Any] = {"mode": "messages", "conversation_id": conversation_id,
                                "limit": limit, "include_content": include_content}
        if before is not None:
            body["before"], body["before_key"] = before, before_key
        return self._call(body, access_token)

    def list_files(self, conversation_id: str, limit: int = 100,
                   before: str | None = None, before_key: str | None = None,
                   access_token: str | None = None) -> dict[str, Any]:
        conversation_id = _validate_uuid(conversation_id)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_MESSAGES:
            raise ValueError(f"limit deve estar entre 1 e {MAX_MESSAGES}; limita mensagens examinadas nesta página.")
        before, before_key = _validate_cursor(before, before_key)
        body: dict[str, Any] = {"mode": "files", "conversation_id": conversation_id, "limit": limit}
        if before is not None:
            body["before"], body["before_key"] = before, before_key
        result = self._call(body, access_token)
        return {key: result[key] for key in ("source", "conversation_id", "items", "count", "has_more", "next_cursor", "continuation_required") if key in result}


def _looks_like_jwt(token: str) -> bool:
    # Shape check only; signature/issuer/audience/expiry are verified by Supabase
    # Auth in Edge, never trusted from the MCP process.
    pieces = token.split(".")
    return len(pieces) == 3 and all(pieces)


def from_environment() -> SanaReadProvider:
    import os
    endpoint = os.getenv("SANA_READ_ENDPOINT", "")
    # HOMOLOG requires a user-scoped Supabase Auth JWT on each request. No service
    # role, anon key, or long-lived adapter secret is stored in this process.
    return SanaReadProvider(endpoint, "", forward_bearer=True)
