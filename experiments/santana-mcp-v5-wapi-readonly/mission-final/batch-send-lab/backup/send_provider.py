"""W-API outbound contract and validation helpers. No request runs at import time."""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from security_utils import validate_secret

API_ORIGIN = "https://api.w-api.app"
MAX_MEDIA_BYTES = 8 * 1024 * 1024
SEND_ENDPOINTS = {
    "text": "/v1/message/send-text",
    "image": "/v1/message/send-image",
    "document": "/v1/message/send-document",
}
DOCUMENT_EXTENSIONS = {"pdf", "docx", "xlsx", "csv", "txt"}


def normalize_phone(phone: str) -> str:
    if not isinstance(phone, str):
        raise ValueError("Informe o telefone do destinatário.")
    digits = re.sub(r"[\s()+.\-]", "", phone)
    if not digits.isdigit() or not digits.startswith("55") or len(digits) not in {12, 13}:
        raise ValueError("Use o telefone brasileiro completo no formato +55, DDD e número (12 ou 13 dígitos).")
    if digits[2:4] in {"00", "01", "02", "03"} or digits[4:] == "0" * len(digits[4:]):
        raise ValueError("O telefone informado não parece válido.")
    return digits


def validate_payload(kind: str, phone: str, payload: dict) -> tuple[str, dict]:
    number = normalize_phone(phone)
    if kind == "text":
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("A mensagem deve ter de 1 a 4000 caracteres.")
        return number, {"text": text.strip()}
    if kind == "image":
        raw = payload.get("content_base64")
        caption = payload.get("caption", "")
        mime = payload.get("mime_type", "")
        if not isinstance(raw, str) or not raw or len(raw) > (MAX_MEDIA_BYTES * 4 // 3 + 16):
            raise ValueError("Imagem Base64 ausente ou acima do limite de 8 MiB.")
        if mime not in {"image/png", "image/jpeg"}:
            raise ValueError("A imagem deve ser PNG ou JPEG.")
        data = _decode_base64(raw)
        if len(data) > MAX_MEDIA_BYTES or not _matches_image(data, mime):
            raise ValueError("O conteúdo não corresponde a uma imagem PNG/JPEG válida ou excede 8 MiB.")
        if not isinstance(caption, str) or len(caption) > 1000:
            raise ValueError("A legenda deve ter no máximo 1000 caracteres.")
        return number, {"content_base64": raw, "caption": caption.strip(), "mime_type": mime}
    if kind == "document":
        raw = payload.get("content_base64")
        extension = str(payload.get("extension", "")).lower().lstrip(".")
        file_name = payload.get("file_name", "")
        caption = payload.get("caption", "")
        if not isinstance(raw, str) or not raw or len(raw) > (MAX_MEDIA_BYTES * 4 // 3 + 16):
            raise ValueError("Documento Base64 ausente ou acima do limite de 8 MiB.")
        data = _decode_base64(raw)
        if not data or len(data) > MAX_MEDIA_BYTES:
            raise ValueError("Documento vazio ou acima do limite de 8 MiB.")
        if extension not in DOCUMENT_EXTENSIONS:
            raise ValueError("Extensão não permitida. Use PDF, DOCX, XLSX, CSV ou TXT.")
        if not isinstance(file_name, str) or len(file_name) > 180 or "/" in file_name or "\\" in file_name:
            raise ValueError("Nome de arquivo inválido.")
        if not isinstance(caption, str) or len(caption) > 1000:
            raise ValueError("A legenda deve ter no máximo 1000 caracteres.")
        return number, {"content_base64": raw, "extension": extension, "file_name": file_name.strip(), "caption": caption.strip()}
    raise ValueError("Tipo de mensagem não suportado.")


def _decode_base64(raw: str) -> bytes:
    try:
        return base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("O anexo deve ser enviado em Base64 válido.") from None


def _matches_image(data: bytes, mime: str) -> bool:
    return data.startswith(b"\x89PNG\r\n\x1a\n") if mime == "image/png" else data.startswith(b"\xff\xd8\xff")


class WapiWriteProvider:
    """Documented write adapter; only call this after all guards and approvals pass."""
    def __init__(self, instance_id: str, token: str, transport=None):
        if not instance_id or not token:
            raise RuntimeError("Credenciais W-API ausentes.")
        validate_secret("WAPI_API_TOKEN", token)
        self.instance_id = instance_id
        self._token = token
        self._transport = transport or self._post_json

    @staticmethod
    def _post_json(url: str, token: str, body: dict):
        request = Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), method="POST", headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=12) as response:
                raw = response.read(256_000)
                payload = json.loads(raw.decode("utf-8")) if raw else {}
                return response.status, payload
        except HTTPError as exc:
            # 4xx is an explicit API rejection; 5xx can be ambiguous after enqueueing.
            return exc.code, {}
        except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None, None

    def send(self, kind: str, phone: str, payload: dict):
        if kind not in SEND_ENDPOINTS:
            raise ValueError("Tipo de mensagem não permitido.")
        body = {"phone": phone}
        if kind == "text":
            body["message"] = payload["text"]
        elif kind == "image":
            body["image"] = payload["content_base64"]
            body["caption"] = payload.get("caption", "")
        else:
            body["document"] = payload["content_base64"]
            body["extension"] = payload["extension"]
            if payload.get("file_name"):
                body["fileName"] = payload["file_name"]
            if payload.get("caption"):
                body["caption"] = payload["caption"]
        url = API_ORIGIN + SEND_ENDPOINTS[kind] + "?" + urlencode({"instanceId": self.instance_id})
        result = self._transport(url, self._token, body)
        if not isinstance(result, tuple) or len(result) != 2:
            return {"state": "outcome_unknown", "error_code": "invalid_transport_result"}
        status, response = result
        if status is None or status >= 500:
            return {"state": "outcome_unknown", "error_code": "network_or_server_ambiguous"}
        if not isinstance(status, int) or status < 200 or status >= 300:
            return {"state": "rejected_by_api", "error_code": f"http_{status}"}
        if not isinstance(response, dict):
            return {"state": "outcome_unknown", "error_code": "invalid_api_response"}
        if not response.get("messageId") or not response.get("insertedId"):
            return {"state": "outcome_unknown", "error_code": "missing_acceptance_ids"}
        return {"state": "accepted_by_api", "messageId": response["messageId"], "insertedId": response["insertedId"]}


def from_environment():
    return WapiWriteProvider(os.getenv("WAPI_INSTANCE_ID", ""), os.getenv("WAPI_API_TOKEN", ""))
