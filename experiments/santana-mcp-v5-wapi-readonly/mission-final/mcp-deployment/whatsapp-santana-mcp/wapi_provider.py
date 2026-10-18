"""Narrow read-only adapter for documented W-API GET endpoints.

No live W-API calls are made unless SANTANA_DATA_SOURCE=wapi is explicitly set.
Tests inject a fake transport and never contact the W-API service.
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from security_utils import validate_secret


API_ORIGIN = "https://api.w-api.app"
MAX_RESPONSE_BYTES = 1_000_000
READ_ENDPOINTS = {
    "/v1/chats/fetch-chats",
    "/v1/chats/chat",
    "/v1/contacts/fetch-contacts",
}


class WapiReadProvider:
    def __init__(self, instance_id: str, token: str, transport=None):
        if not isinstance(instance_id, str) or not instance_id.strip():
            raise RuntimeError("WAPI_INSTANCE_ID não configurado.")
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError("WAPI_API_TOKEN não configurado.")
        validate_secret("WAPI_API_TOKEN", token)
        self.instance_id = instance_id.strip()
        self._token = token
        self._transport = transport or self._get_json

    @staticmethod
    def _get_json(url: str, token: str):
        request = Request(url, method="GET", headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=8) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ValueError("Resposta W-API excedeu o limite permitido.")
                return response.status, json.loads(raw.decode("utf-8"))
        except HTTPError as exc:
            raise RuntimeError(f"W-API retornou HTTP {exc.code}.") from None
        except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            raise RuntimeError("Falha ao consultar a W-API; nenhum dado foi alterado.") from None

    def _request(self, endpoint: str, params: dict):
        if endpoint not in READ_ENDPOINTS:
            raise RuntimeError("Endpoint não pertence à lista de leitura permitida.")
        url = API_ORIGIN + endpoint + "?" + urlencode({"instanceId": self.instance_id, **params})
        result = self._transport(url, self._token)
        if not isinstance(result, tuple) or len(result) != 2:
            raise RuntimeError("Resposta da W-API inválida.")
        status, payload = result
        if status != 200:
            raise RuntimeError(f"W-API retornou HTTP {status}.")
        if not isinstance(payload, (dict, list)):
            raise RuntimeError("A W-API não retornou JSON de objeto/lista.")
        return payload

    @staticmethod
    def _page(per_page, page):
        if not isinstance(per_page, int) or isinstance(per_page, bool) or not 1 <= per_page <= 50:
            raise ValueError("per_page deve estar entre 1 e 50.")
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 10000:
            raise ValueError("page deve estar entre 1 e 10000.")

    def list_conversations(self, per_page=20, page=1):
        self._page(per_page, page)
        return {"source": "w-api", "page": page, "per_page": per_page,
                "data": self._request("/v1/chats/fetch-chats", {"perPage": per_page, "page": page})}

    def get_conversation(self, phone):
        if not isinstance(phone, str) or not phone.strip() or len(phone) > 128:
            raise ValueError("phone obrigatório e limitado a 128 caracteres.")
        return {"source": "w-api", "data": self._request("/v1/chats/chat", {"phoneNumber": phone.strip()})}

    def list_contacts(self, per_page=20, page=1):
        self._page(per_page, page)
        return {"source": "w-api", "page": page, "per_page": per_page,
                "data": self._request("/v1/contacts/fetch-contacts", {"perPage": per_page, "page": page})}


def from_environment():
    return WapiReadProvider(
        instance_id=os.getenv("WAPI_INSTANCE_ID", ""),
        token=os.getenv("WAPI_API_TOKEN", ""),
    )
