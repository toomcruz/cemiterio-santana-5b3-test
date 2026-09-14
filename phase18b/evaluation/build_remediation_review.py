#!/usr/bin/env python3
"""Build the bounded blind review for Phase 18C from the preserved package."""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

TARGETS = [
    ("review_03_b45bdf4e29", "problematic_both_inadequate"),
    ("review_04_a4518158ca", "problematic_both_inadequate"),
    ("review_10_7f58f98455", "problematic_both_inadequate"),
    ("review_12_f61f664a03", "problematic_both_inadequate"),
    ("review_14_df7da59c46", "context_may_be_insufficient"),
    ("review_20_b66f3232db", "context_may_be_insufficient"),
    ("review_01_4a88ccfc74", "sentinel_prior_a_better"),
    ("review_06_7e2683d573", "sentinel_prior_b_better"),
    ("review_09_0a5515db29", "sentinel_prior_a_better"),
    ("review_17_9ca43fae60", "sentinel_prior_b_better"),
]


def read_cases(source: Path) -> dict[str, dict]:
    with zipfile.ZipFile(source) as archive:
        rows = [json.loads(line) for line in archive.read("block_a_real_shadow_cases.jsonl").splitlines()]
    return {row["case_ref"]: row for row in rows}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cases = read_cases(args.source)
    missing = [case_ref for case_ref, _ in TARGETS if case_ref not in cases]
    if missing:
        raise SystemExit(f"missing preserved cases: {','.join(missing)}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        for case_ref, reason in TARGETS:
            row = dict(cases[case_ref])
            row.pop("review", None)
            row.pop("selection_reasons", None)
            row["sample_type"] = "phase18c_remediation_blind_review"
            row["remediation_reason"] = reason
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    manifest = {
        "schema_version": "phase18c-remediation-blind-review/1.0.0",
        "case_count": len(TARGETS),
        "source_package_preserved": True,
        "provider_changed": False,
        "gold_changed": False,
        "p0_changed": False,
        "systems_blinded": True,
        "context_insufficient_cases": [case_ref for case_ref, reason in TARGETS if reason == "context_may_be_insufficient"],
        "cases_sha256": digest,
    }
    (args.output.parent / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
