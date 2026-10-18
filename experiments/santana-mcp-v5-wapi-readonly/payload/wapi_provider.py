"""Narrow read-only adapter for documented W-API GET endpoints.

No live W-API calls are made unless SANTANA_DATA_SOURCE=wapi is explicitly set.
Tests inject a fake transport and never contact the W-API service.
"""
from __future__ import annotations

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request
from secure_http import urlopen
from send_provider import normalize_phone
from security_utils import validate_secret
from provider_catalog import WAPI_CAPABILITIES


API_ORIGIN = "https://api.w-api.app"
MAX_RESPONSE_BYTES = 1_000_000
READ_ENDPOINTS = {
    "/v1/instance/status-instance",
    "/v1/instance/fetch-instance",
    "/v1/chats/fetch-chats",
    "/v1/chats/chat",
    "/v1/contacts/fetch-contacts",
}


class WapiHTTPError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f'W-API retornou HTTP {status}.')


class WapiCapabilityError(RuntimeError):
    pass


class WapiPayloadError(RuntimeError):
    pass


class WapiReadProvider:
    def __init__(self, instance_id: str, token: str, transport=None, *, plan: str | None = None):
        if not isinstance(instance_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', instance_id):
            raise RuntimeError("WAPI_INSTANCE_ID não configurado.")
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError("WAPI_API_TOKEN não configurado.")
        validate_secret("WAPI_API_TOKEN", token)
        self.instance_id = instance_id.strip()
        self._token = token
        self._transport = transport or self._get_json
        if plan not in (None, 'LITE', 'PRO'):
            raise ValueError('WAPI_PLAN deve ser LITE ou PRO.')
        self.plan = plan

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
            raise WapiHTTPError(exc.code) from None
        except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            raise RuntimeError("Falha ao consultar a W-API; nenhum dado foi alterado.") from None

    def _request(self, endpoint: str, params: dict):
        if endpoint not in READ_ENDPOINTS:
            raise RuntimeError("Endpoint não pertence à lista de leitura permitida.")
        capability = next(c for c in WAPI_CAPABILITIES.values() if c['path'] == endpoint)
        if self.plan is not None and self.plan not in capability['plans']:
            raise WapiCapabilityError('Rota indisponível no plano configurado; use a fonte Sana autorizada.')
        if 'instanceId' in params:
            raise ValueError('A instância não pode ser substituída por parâmetros de consulta.')
        url = API_ORIGIN + endpoint + "?" + urlencode({"instanceId": self.instance_id, **params})
        result = self._transport(url, self._token)
        if not isinstance(result, tuple) or len(result) != 2:
            raise RuntimeError("Resposta da W-API inválida.")
        status, payload = result
        if status != 200:
            raise WapiHTTPError(status)
        if not isinstance(payload, (dict, list)):
            raise RuntimeError("A W-API não retornou JSON de objeto/lista.")
        if isinstance(payload, dict) and (payload.get('error') not in (None, False, '') or payload.get('success') is False):
            raise WapiPayloadError('A W-API recusou a operação; nenhum conteúdo do erro foi divulgado.')
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
        phone = normalize_phone(phone)
        return {"source": "w-api", "data": self._request("/v1/chats/chat", {"phoneNumber": phone.strip()})}

    def list_contacts(self, per_page=20, page=1):
        self._page(per_page, page)
        return {"source": "w-api", "page": page, "per_page": per_page,
                "data": self._request("/v1/contacts/fetch-contacts", {"perPage": per_page, "page": page})}

    def status(self):
        data = self._request('/v1/instance/status-instance', {})
        inner = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
        if not isinstance(inner, dict) or not isinstance(inner.get('connected'), bool):
            raise RuntimeError('Status W-API não comprovado.')
        return {'source':'w-api', 'connected':inner['connected']}

    def instance_metadata(self):
        # fetch-instance includes credentials and webhook URLs. Never expose it raw.
        data = self._request('/v1/instance/fetch-instance', {})
        inner = data.get('data') if isinstance(data, dict) and isinstance(data.get('data'), dict) else data
        if not isinstance(inner, dict):
            raise WapiPayloadError('Metadados W-API inválidos.')
        result = {'source': 'w-api', 'configured_plan': self.plan}
        if isinstance(inner.get('connected'), bool):
            result['connected'] = inner['connected']
        for key in ('type', 'instanceType', 'plan', 'planType'):
            if str(inner.get(key, '')).upper() in ('LITE', 'PRO'):
                result['observed_plan'] = str(inner[key]).upper()
        return result


def from_environment():
    return WapiReadProvider(
        instance_id=os.getenv("WAPI_INSTANCE_ID", ""),
        token=os.getenv("WAPI_API_TOKEN") or os.getenv("WAPI_TOKEN", ""),
        plan=os.getenv('WAPI_PLAN', 'LITE'),
    )
