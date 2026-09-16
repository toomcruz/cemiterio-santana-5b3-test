#!/usr/bin/env python3
"""Wrap the immutable audited Phase 18 release with post-release evidence."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


SOURCE_NAME = "fase-18-shadow-mode-sem-efeitos-coorte-1.zip"
OUTPUT_NAME = "fase-18-shadow-mode-sem-efeitos-coorte-1-reconciliado.zip"
EXPECTED_SHA256 = "87e21791a3a5524a1495ce61894423e7fd6554f7df8a1e3ef94b260b1b9597a4"
EXPECTED_SIZE = 427405
ROOT = "fase-18-shadow-mode-sem-efeitos-coorte-1-reconciliado"
ZIP_TIME = (2026, 9, 13, 16, 21, 42)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def member(name: str, data: bytes) -> tuple[ZipInfo, bytes]:
    info = ZipInfo(f"{ROOT}/{name}", ZIP_TIME)
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100600 << 16
    return info, data


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    exports = Path("/data/.openclaw/workspace/exports")
    source = exports / SOURCE_NAME
    output = exports / OUTPUT_NAME
    evidence_path = repo / "phase18/post-release/reconciliation.json"

    if output.exists():
        raise SystemExit(f"refusing to overwrite {output}")

    source_bytes = source.read_bytes()
    if len(source_bytes) != EXPECTED_SIZE or digest(source_bytes) != EXPECTED_SHA256:
        raise SystemExit("audited Phase 18 package changed")
    if source.stat().st_mode & 0o777 != 0o600:
        raise SystemExit("audited package must remain mode 0600")

    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if evidence["independent_audit"]["audited_package"]["sha256"] != EXPECTED_SHA256:
        raise SystemExit("audit evidence does not reference the immutable payload")

    readme = (
        "# Fase 18 — pacote reconciliado\n\n"
        "Este envelope preserva, byte por byte, o pacote validado pela auditoria "
        "independente `phase18_shadow_boundary`. O relatório de reconciliação registra "
        "separadamente um lifecycle órfão; o worker cancelado não é contado como auditoria.\n\n"
        f"- Payload auditado: `{SOURCE_NAME}`\n"
        f"- SHA-256 do payload: `{EXPECTED_SHA256}`\n"
        "- Auditoria válida: `PASS_RELEASE_READY`\n"
        "- Fase 19: não iniciada\n"
    ).encode("utf-8")
    evidence_bytes = (json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")

    payloads = {
        "README.md": readme,
        f"payload/{SOURCE_NAME}": source_bytes,
        "evidence/independent-audit-and-lifecycle.json": evidence_bytes,
    }
    manifest = "".join(
        f"{digest(data)}  {name}\n" for name, data in sorted(payloads.items())
    ).encode("utf-8")
    payloads["MANIFEST.sha256"] = manifest

    temporary = output.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w") as archive:
        for name, data in sorted(payloads.items()):
            info, body = member(name, data)
            archive.writestr(info, body)
    os.chmod(temporary, 0o600)

    with ZipFile(temporary) as archive:
        if archive.testzip() is not None:
            raise SystemExit("invalid output ZIP")
        for line in archive.read(f"{ROOT}/MANIFEST.sha256").decode().splitlines():
            expected, name = line.split("  ", 1)
            if digest(archive.read(f"{ROOT}/{name}")) != expected:
                raise SystemExit(f"manifest mismatch: {name}")

    os.replace(temporary, output)
    os.chmod(output, 0o600)
    print(json.dumps({
        "output": str(output),
        "size_bytes": output.stat().st_size,
        "sha256": digest(output.read_bytes()),
        "mode": oct(output.stat().st_mode & 0o777),
        "audited_payload_sha256": EXPECTED_SHA256,
    }, indent=2))


if __name__ == "__main__":
    main()
