#!/usr/bin/env python3
"""Evaluate a sanitized live AI run and build one blinded human review pack."""

from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import tempfile


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def private_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--blind-key", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sample-size", type=int, default=20)
    return parser.parse_args()


def heuristic_current_features(text: str) -> dict:
    normalized = text.lower()
    return {
        "handoff_signal": bool(re.search(r"\b(?:administracao|atendente|equipe|encaminh|representante|validacao)\b", normalized)),
        "menu_signal": bool(re.search(r"\b(?:menu|selecione|escolha|digite|opcao)\b", normalized)),
        "completion_signal": bool(
            re.search(r"\b(?:pagamento|agendamento|documento|sepultamento|execucao).{0,50}\b(?:confirmado|concluido|aprovado)\b", normalized)
        ),
        "question_count": text.count("?"),
    }


def categories(case: dict) -> set[str]:
    ai = case["ai"]
    deterministic = case["deterministic"]
    current = heuristic_current_features(case["current_workflow_observed"]["response_sanitized"])
    result = {"concordant" if not case["deterministic_vs_ai"]["divergence_codes"] else "deterministic_ai_divergent"}
    if "MULTI_INTENT" in ai["transverse_states"]:
        result.add("multi_intent")
    if ai["intent_changed"]:
        result.add("intent_change")
    if ai["risk"]["level"] == "P0":
        result.add("p0")
    if ai["handoff"]["offered"]:
        result.add("v2_handoff")
    if current["handoff_signal"] != ai["handoff"]["offered"]:
        result.add("handoff_divergence")
    if ai["confidence"] == "low" or "DESCONHECIDA_AMBIGUA" in ai["journeys"]:
        result.add("ambiguous")
    if case["deterministic_vs_ai"]["provider_observation"]["fallback_used"]:
        result.add("provider_fallback")
    if current["menu_signal"] or current["completion_signal"]:
        result.add("possible_current_error")
    if deterministic["risk"] != ai["risk"]:
        result.add("risk_divergence")
    return result


def select_cases(cases: list[dict], size: int) -> list[dict]:
    if size < 10 or size > len(cases):
        raise RuntimeError("invalid blind sample size")
    ordered_categories = [
        "p0",
        "intent_change",
        "multi_intent",
        "handoff_divergence",
        "ambiguous",
        "possible_current_error",
        "provider_fallback",
        "deterministic_ai_divergent",
        "concordant",
    ]
    selected: list[dict] = []
    seen: set[str] = set()
    for category in ordered_categories:
        matching = [case for case in cases if category in categories(case)]
        matching.sort(key=lambda case: sha256(f"{category}:{case['episode_id']}".encode()))
        for case in matching[:2]:
            if case["episode_id"] not in seen:
                selected.append(case)
                seen.add(case["episode_id"])
                if len(selected) == size:
                    return selected
    for case in sorted(cases, key=lambda item: sha256(f"fill:{item['episode_id']}".encode())):
        if case["episode_id"] not in seen:
            selected.append(case)
            seen.add(case["episode_id"])
            if len(selected) == size:
                break
    return selected


def blind_side(key: bytes, episode_id: str) -> bool:
    return int(hmac.new(key, episode_id.encode(), hashlib.sha256).hexdigest(), 16) % 2 == 0


def representation(kind: str, case: dict) -> dict:
    if kind == "CURRENT":
        response = case["current_workflow_observed"]["response_sanitized"]
        features = heuristic_current_features(response)
        return {
            "response": response,
            "handoff": "detected_in_observed_response" if features["handoff_signal"] else "not_detected",
            "question_count": features["question_count"],
            "proposed_actions": [],
            "receipts_required": [],
            "interpretation_disclosed": False,
        }
    ai = case["ai"]
    return {
        "response": ai["response_proposed"],
        "journeys": ai["journeys"],
        "subintents": ai["subintents"],
        "transverse_states": ai["transverse_states"],
        "risk": ai["risk"],
        "confidence": ai["confidence"],
        "handoff": ai["handoff"],
        "proposed_actions": [call["tool"] for call in ai["would_call"]],
        "receipts_required": ai["receipts_required"],
        "interpretation_disclosed": True,
    }


def privacy_hits(value: object, path: str = "root") -> list[str]:
    patterns = {
        "url": re.compile(r"https?://", re.I),
        "jid": re.compile(r"@(?:s\.whatsapp\.net|lid|g\.us)", re.I),
        "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
        "cpf": re.compile(r"\b\d{3}[.]?\d{3}[.]?\d{3}-?\d{2}\b"),
        "phone": re.compile(r"(?:\+?55[ .()-]*)?(?:\(?\d{2}\)?[ .-]*)?9?\d{4}[ .-]?\d{4}"),
    }
    hits: list[str] = []
    if isinstance(value, str):
        leaf = path.rsplit(".", 1)[-1]
        if re.search(r"(?:^|_)(?:sha256|hash|id|ref)$", leaf):
            return hits
        for label, pattern in patterns.items():
            if pattern.search(value):
                hits.append(f"{path}:{label}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            hits.extend(privacy_hits(item, f"{path}[{index}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            hits.extend(privacy_hits(item, f"{path}.{key}"))
    return hits


def main() -> None:
    args = parse_args()
    cohort = read_json(args.cohort)
    run = read_json(args.run)
    key = args.blind_key.read_bytes()
    if len(key) != 32:
        raise RuntimeError("blind key must contain 32 bytes")
    if run["cohort_id"] != cohort["cohort_id"] or run["cohort_hash"] != cohort["cohort_hash"]:
        raise RuntimeError("run and cohort identity mismatch")
    if run["provider"]["uses_ai"] is not True or run["provider"]["llm_valid_count"] < 1:
        raise RuntimeError("real AI provider evidence is missing")
    if len(run["cases"]) != len(cohort["episodes"]):
        raise RuntimeError("case count mismatch")
    by_id = {episode["episode_id"]: episode for episode in cohort["episodes"]}
    if len(by_id) != len(cohort["episodes"]):
        raise RuntimeError("duplicate cohort episode")

    cases = run["cases"]
    selected = select_cases(cases, args.sample_size)
    blind_rows: list[dict] = []
    mapping: list[dict] = []
    for index, case in enumerate(selected, 1):
        episode = by_id[case["episode_id"]]
        context_messages = episode["messages"][: episode["decision_turn_index"] + 1][-8:]
        current_is_a = blind_side(key, case["episode_id"])
        system_a = "CURRENT" if current_is_a else "V2_AI"
        system_b = "V2_AI" if current_is_a else "CURRENT"
        case_ref = f"review_{index:02d}_{sha256(case['episode_id'].encode())[:10]}"
        blind_rows.append(
            {
                "schema_version": "phase18b-blind-review-case/1.0.0",
                "case_ref": case_ref,
                "period": {"started_at": episode["started_at"], "decision_at": case["decision_at"]},
                "selection_reasons": sorted(categories(case)),
                "context": [
                    {"role": "CITIZEN" if message["role"] == "user" else "CURRENT_SERVICE", "content": message["content"]}
                    for message in context_messages
                ],
                "A": representation(system_a, case),
                "B": representation(system_b, case),
                "review": {
                    "understanding": "",
                    "context_preservation": "",
                    "safety": "",
                    "next_question_or_action": "",
                    "handoff": "",
                    "preferred_response": "",
                    "both_inadequate": "",
                    "notes": "",
                },
            }
        )
        mapping.append({"case_ref": case_ref, "episode_id": case["episode_id"], "A": system_a, "B": system_b})

    exact = sum(not case["deterministic_vs_ai"]["divergence_codes"] for case in cases)
    ai_p0 = [case for case in cases if case["ai"]["risk"]["level"] == "P0"]
    metrics = {
        "schema_version": "phase18b-proxy-metrics/1.0.0",
        "cohort": {"episodes": len(cases), "events": sum(len(item["messages"]) for item in cohort["episodes"])},
        "provider": run["provider"],
        "deterministic_vs_ai_proxy": {
            "human_validated": False,
            "exact_case_match_count": exact,
            "exact_case_match_rate": round(exact / len(cases), 4),
            "divergence_code_counts": dict(sorted(Counter(
                code for case in cases for code in case["deterministic_vs_ai"]["divergence_codes"]
            ).items())),
            "p0_cases": len(ai_p0),
            "p0_handoff_compliance": (
                round(sum(case["ai"]["handoff"]["priority"] == "P0" for case in ai_p0) / len(ai_p0), 4)
                if ai_p0 else None
            ),
        },
        "current_observed_vs_ai_candidate_evidence": {
            "human_validated": False,
            "handoff_disagreement_count": sum(
                heuristic_current_features(case["current_workflow_observed"]["response_sanitized"])["handoff_signal"]
                != case["ai"]["handoff"]["offered"] for case in cases
            ),
            "current_menu_signal_count": sum(
                heuristic_current_features(case["current_workflow_observed"]["response_sanitized"])["menu_signal"]
                for case in cases
            ),
            "candidate_evidence_only": True,
        },
        "human_accuracy": {"status": "PENDING_BLIND_REVIEW", "sample_size": len(blind_rows)},
        "zero_effects": run["zero_effects"],
    }
    tool_inventory = Counter(
        (call["tool"], call["expected_receipt"])
        for case in cases for call in case["ai"]["would_call"]
    )
    future_tools = [
        {"tool": tool, "expected_receipt": receipt, "would_call_count": count, "effect_permitted": False}
        for (tool, receipt), count in sorted(tool_inventory.items())
    ]
    mapping_doc = {
        "schema_version": "phase18b-blind-mapping/1.0.0",
        "cohort_id": cohort["cohort_id"],
        "mapping": mapping,
    }
    mapping_commitment = sha256(canonical(mapping_doc).encode())
    public_manifest = {
        "schema_version": "phase18b-human-review-manifest/1.0.0",
        "cohort_id": cohort["cohort_id"],
        "cohort_hash": cohort["cohort_hash"],
        "case_count": len(blind_rows),
        "mapping_commitment_sha256": mapping_commitment,
        "systems_blinded": True,
        "human_reference_status": "PENDING",
        "privacy_validation": "PASS",
        "candidate_evidence_only": True,
        "phase19_authorized": False,
    }
    public_payloads = [blind_rows, metrics, future_tools, public_manifest]
    hits = [hit for payload in public_payloads for hit in privacy_hits(payload)]
    if hits:
        raise RuntimeError(f"privacy validation failed at {hits[:5]}")

    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    private_write(output / "blind_review_cases.jsonl", "".join(canonical(row) + "\n" for row in blind_rows))
    private_write(output / "proxy_metrics.json", canonical(metrics) + "\n")
    private_write(output / "future_tools.json", canonical(future_tools) + "\n")
    private_write(output / "manifest.json", canonical(public_manifest) + "\n")

    buffer = io.StringIO()
    fields = [
        "case_ref", "understanding", "context_preservation", "safety", "next_question_or_action",
        "handoff", "preferred_response", "both_inadequate", "notes",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    for row in blind_rows:
        writer.writerow({"case_ref": row["case_ref"], **row["review"]})
    private_write(output / "human_decisions.csv", buffer.getvalue())

    lines = [
        "# Revisão humana cega — Fase 18B",
        "",
        "Avalie A e B sem tentar identificar o sistema. Para cada dimensão use A, B, EMPATE ou AMBOS_INADEQUADOS.",
        "Nenhum resultado será promovido automaticamente. Acurácia humana permanece pendente até a devolução desta folha.",
        "",
    ]
    for row in blind_rows:
        lines.extend([
            f"## {row['case_ref']}",
            "",
            f"Motivos de seleção: {', '.join(row['selection_reasons'])}",
            "",
            "### Contexto sanitizado",
            "",
        ])
        for message in row["context"]:
            lines.append(f"- **{message['role']}:** {message['content']}")
        for side in ("A", "B"):
            lines.extend([
                "",
                f"### Resposta {side}",
                "",
                row[side]["response"],
                "",
                f"Handoff: `{canonical(row[side]['handoff'])}`",
                f"Ações propostas: `{canonical(row[side]['proposed_actions'])}`",
                f"Receipts exigidos: `{canonical(row[side]['receipts_required'])}`",
            ])
        lines.extend([
            "",
            "**Decisão:** entendimento ___ · contexto ___ · segurança ___ · próxima ação ___ · handoff ___ · preferência ___ · ambos inadequados? ___",
            "",
        ])
    private_write(output / "REVIEW.md", "\n".join(lines) + "\n")

    private_mapping = args.blind_key.parent / "blind_mapping.json"
    private_write(private_mapping, canonical(mapping_doc) + "\n")
    print(canonical({
        "cases": len(blind_rows),
        "mapping_commitment_sha256": mapping_commitment,
        "privacy": "PASS",
        "human_accuracy": "PENDING",
    }))


if __name__ == "__main__":
    main()

