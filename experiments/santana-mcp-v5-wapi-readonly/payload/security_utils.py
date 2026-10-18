"""Shared secret validation and minimal W-API output projection."""
from __future__ import annotations

import re


PLACEHOLDER_MARKERS = (
    "replace", "example", "changeme", "change-me", "placeholder", "dummy",
    "sample", "your-token", "your_token", "test-token", "test_token",
)


def validate_secret(name: str, value: str, minimum: int = 32) -> str:
    if not isinstance(value, str) or len(value) < minimum:
        raise RuntimeError(f"{name} deve ter pelo menos {minimum} caracteres.")
    lowered = value.lower()
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        raise RuntimeError(f"{name} ainda parece uma credencial de exemplo; configure um segredo aleatório real.")
    if len(set(value)) < 12:
        raise RuntimeError(f"{name} tem pouca variedade; gere um segredo aleatório novo.")
    return value


# Only bounded identifiers and operational metadata are exposed. Phone values are
# masked; message bodies, addresses, email, profile data, media, and unknown keys
# are intentionally discarded, including nested provider-specific fields.
SAFE_WAPI_KEYS = {
    "id", "chatid", "contactid", "name", "phone", "phonenumber", "remotejid",
    "status", "unreadcount", "isgroup", "archived", "pinned", "total",
    "page", "perpage", "per_page", "hasmore", "count", "createdat", "updatedat",
    "source", "data", "contacts", "chats", "chat", "items", "connected",
}
PHONE_KEYS = {"phone", "phonenumber", "remotejid"}


def _mask_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) < 7:
        return "[masked]"
    return "+" + digits[:4] + "•••••" + digits[-3:]


def sanitize_wapi(value):
    if isinstance(value, list):
        return [sanitize_wapi(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if normalized not in SAFE_WAPI_KEYS:
                continue
            if normalized in PHONE_KEYS:
                result[key] = _mask_phone(item) if isinstance(item, str) else None
            elif normalized == "id" and isinstance(item, (str, int)) and not isinstance(item, bool) and len(re.sub(r"\D", "", str(item))) >= 10:
                result[key] = _mask_phone(str(item))
            elif isinstance(item, (dict, list)):
                result[key] = sanitize_wapi(item)
            elif isinstance(item, (str, int, float, bool)) or item is None:
                result[key] = item
        return result
    return value
