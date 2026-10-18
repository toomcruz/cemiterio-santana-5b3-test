#!/usr/bin/env python3
"""Local interactive review gate for fixture simulations; never calls W-API."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys

from audit_store import from_environment
from fixture_provider import CONTACTS


def _preview(kind: str, payload: dict) -> dict:
    if kind == "text":
        return {"text": payload.get("text", "")}
    if kind == "image":
        return {"mime_type": payload.get("mime_type"), "caption": payload.get("caption", ""),
                "bytes": len(payload.get("content_base64", "")) * 3 // 4}
    return {"file_name": payload.get("file_name"), "extension": payload.get("extension"),
            "caption": payload.get("caption", ""), "bytes": len(payload.get("content_base64", "")) * 3 // 4}


def _fixture_name(phone: str) -> str | None:
    for contact in CONTACTS.values():
        digits = "".join(ch for ch in contact["phone"] if ch.isdigit())
        if digits == phone:
            return contact["name"]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Review and approve one fictional message for simulation")
    parser.add_argument("approval_id", help="ID returned by whatsapp_prepare_message")
    args = parser.parse_args()
    if os.getenv("SANTANA_DATA_SOURCE", "fixture") != "fixture":
        print("Bloqueado: esta aprovação local só funciona com dados fictícios.", file=sys.stderr)
        return 2
    if not sys.stdin.isatty():
        print("Bloqueado: a revisão exige terminal interativo; stdin/redirecionamento não vale como aprovação humana.", file=sys.stderr)
        return 2
    operator = getpass.getuser()
    authorized_operators = {name.strip() for name in os.getenv("SANTANA_OPERATOR_USERS", "").split(",") if name.strip()}
    if not authorized_operators or operator not in authorized_operators:
        print("Bloqueado: usuário do sistema não está em SANTANA_OPERATOR_USERS.", file=sys.stderr)
        return 2
    store = from_environment()
    row = store.get_any(args.approval_id)
    if not row or row["state"] != "prepared":
        print("Preparação inexistente, vencida, já processada ou não disponível para revisão.", file=sys.stderr)
        return 2
    if row["kind"] != "text":
        print("Bloqueado: este CLI só aprova texto. Anexos exigem visualização dedicada que ainda não existe.", file=sys.stderr)
        return 2
    recipient_name = _fixture_name(row["phone"])
    if recipient_name is None:
        print("Bloqueado: destinatário fictício não foi reconhecido.", file=sys.stderr)
        return 2
    payload = json.loads(row["payload_json"])
    print("REVISÃO HUMANA LOCAL — SIMULAÇÃO FICTÍCIA; NÃO ENVIA WHATSAPP")
    print(json.dumps({
        "destinatario": recipient_name,
        "telefone": "+" + row["phone"],
        "tipo": row["kind"],
        "conteudo_revisado": _preview(row["kind"], payload),
        "codigo": "APROVAR " + row["approval_id"][-8:],
    }, ensure_ascii=False, indent=2))
    typed = input("Digite o código após revisar o destinatário e conteúdo: ").strip()
    if typed != "APROVAR " + row["approval_id"][-8:]:
        print("Negado; nada foi aprovado ou enviado.", file=sys.stderr)
        return 1
    approved = store.record_operator_approval(row["approval_id"], operator)
    if not approved:
        print("A preparação venceu ou mudou durante a revisão; nada foi aprovado.", file=sys.stderr)
        return 1
    print(json.dumps({"status": "human_approved_for_fixture_simulation", "approval_id": approved["approval_id"],
                      "operator": approved["human_approved_by"], "external_request_attempted": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
