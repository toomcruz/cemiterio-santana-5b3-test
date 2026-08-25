#!/usr/bin/env python3
"""Preflight curto da Omniroute local — sem imprimir chave.

Exige LITELLM_PROVIDER_BASE_URL / _API_KEY / _MODEL_NAME.
Recusa generativelanguage.googleapis.com.
Exit 0 se /models + 1 chat com nonce OK.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid


def main() -> int:
    base = os.environ.get("LITELLM_PROVIDER_BASE_URL", "").strip().rstrip("/")
    model_raw = os.environ.get("LITELLM_PROVIDER_MODEL_NAME", "").strip()
    api_key = os.environ.get("LITELLM_PROVIDER_API_KEY", "").strip()

    if not base or not model_raw or not api_key:
        print("LITELLM_PROVIDER_BASE_URL/MODEL_NAME/API_KEY ausentes", file=sys.stderr)
        return 2

    if base.startswith("https://generativelanguage.googleapis.com"):
        print("Recusado: BASE_URL aponta para Google direto.", file=sys.stderr)
        return 1

    if not (base.startswith("http://127.0.0.1:") or base.startswith("http://localhost:")):
        print(f"Aviso: BASE_URL nao e loopback ({base}). Self-hosted lab espera 127.0.0.1.", file=sys.stderr)

    # LiteLLM usa prefixo openai/; Omniroute espera o id sem o prefixo.
    model = model_raw[len("openai/") :] if model_raw.startswith("openai/") else model_raw

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "fase4-omniroute-preflight",
    }

    models_url = f"{base}/models"
    print(f"preflight models: GET {models_url}")
    try:
        req = urllib.request.Request(models_url, headers={k: v for k, v in headers.items() if k != "Content-Type"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            models_body = json.loads(resp.read().decode())
            print(f"models_http={resp.status}")
    except urllib.error.HTTPError as err:
        print(f"models_http={err.code}")
        print("Falha /v1/models", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"models_error={type(err).__name__}", file=sys.stderr)
        return 1

    ids = [m.get("id") for m in models_body.get("data", [])]
    print("models_count", len(ids))
    print("target", model, "in_catalog", model in ids)
    if model not in ids:
        return 2

    nonce = uuid.uuid4().hex[:8]
    chat_url = f"{base}/chat/completions"
    print(f"preflight chat: POST {chat_url} model={model} nonce={nonce}")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": f"Responda exatamente: OK [{nonce}]"}],
        "max_tokens": 32,
        "temperature": 0,
        "stream": False,
    }
    data = json.dumps(payload).encode()
    try:
        req = urllib.request.Request(chat_url, data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            chat_body = json.loads(resp.read().decode())
            print(f"chat_http={resp.status}")
    except urllib.error.HTTPError as err:
        print(f"chat_http={err.code}")
        try:
            detail = err.read().decode()[:300]
            print("chat_error_body_len", len(detail))
        except Exception:  # noqa: BLE001
            pass
        print("Falha chat/completions", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"chat_error={type(err).__name__}", file=sys.stderr)
        return 1

    content = ((chat_body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    print("content", repr(content)[:120])
    print("model_returned", chat_body.get("model"))
    if nonce not in content:
        print("nonce_mismatch")
        return 3

    print("preflight_ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
