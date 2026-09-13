#!/usr/bin/env python3
"""Evaluate sanitized Phase 18 shadow records without reading raw conversations."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import statistics


UNKNOWN_JOURNEY = "DESCONHECIDA_AMBIGUA"
DIMENSIONS = (
    "intention",
    "intent_change",
    "multi_intent",
    "context",
    "conversation",
    "handoff",
    "safety",
    "actions_receipts",
    "result",
    "operation",
)
SEVERITIES = ("P0", "P1", "P2", "P3")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--comparison-store", type=Path, action="append", default=[])
    parser.add_argument("--persistence-attestation", type=Path, required=True)
    return parser.parse_args()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(canonical(value) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(canonical(row) + "\n" for row in rows), encoding="utf-8")
    os.chmod(path, 0o600)


def load_store(path: Path) -> list[dict]:
    records = []
    for item in sorted((path / "records").glob("*.json")):
        wrapper = json.loads(item.read_text(encoding="utf-8"))
        if wrapper.get("schema_version") != "phase18-shadow-store-record/1.0.0":
            raise RuntimeError(f"unexpected store schema: {item.name}")
        result = wrapper.get("result")
        if not isinstance(result, dict) or result.get("schema_version") != "phase18-shadow-record/1.2.0":
            raise RuntimeError(f"unexpected shadow record schema: {item.name}")
        records.append(result)
    return records


def percentile(values: list[float], percentage: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentage)))
    return round(ordered[index], 3)


def pct(numerator: int, denominator: int) -> float | None:
    return round(100 * numerator / denominator, 2) if denominator else None


def semantic_projection(record: dict) -> dict:
    """Remove timing from a result before cross-process determinism comparison."""
    result = json.loads(canonical(record))
    result["current_workflow_replay"].pop("latency_ms", None)
    result["motor_v2_shadow"].pop("latency_ms", None)
    return result


def privacy_hits(value: object, path: str = "root") -> list[dict]:
    patterns = {
        "url": re.compile(r"https?://", re.I),
        "jid": re.compile(r"@(?:s\.whatsapp\.net|lid)\b", re.I),
        "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
        "cpf": re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
        "formatted_phone": re.compile(r"(?:\+55[ .()-]*|\(\d{2}\)[ .-]*)9?\d{4}[ .-]?\d{4}"),
        "unformatted_phone": re.compile(r"(^|\D)\d{10,13}(\D|$)"),
    }
    hits: list[dict] = []
    if isinstance(value, str):
        leaf = path.rsplit(".", 1)[-1]
        if re.search(r"(?:^|_)(?:sha256|hash|id|ids|ref|refs)$", leaf):
            return hits
        for kind, pattern in patterns.items():
            if pattern.search(value):
                hits.append({"kind": kind, "path": path})
    elif isinstance(value, list):
        for index, item in enumerate(value):
            hits.extend(privacy_hits(item, f"{path}[{index}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            hits.extend(privacy_hits(item, f"{path}.{key}"))
    return hits


def failure(
    record: dict,
    severity: str,
    layer: str,
    code: str,
    status: str,
    detail: str,
) -> dict:
    return {
        "schema_version": "phase18-shadow-failure/1.0.0",
        "event_id": record["event_id"],
        "episode_id": record["episode_id"],
        "severity": severity,
        "layer": layer,
        "code": code,
        "status": status,
        "detail": detail,
    }


def evaluate_failures(records: list[dict]) -> list[dict]:
    rows: list[dict] = []
    for record in records:
        reference = record["reference"]
        current = record["current_workflow_replay"]
        v2 = record["motor_v2_shadow"]
        reference_journeys = set(reference["journeys"]) - {UNKNOWN_JOURNEY}
        v2_journeys = set(v2["journeys"]) - {UNKNOWN_JOURNEY}
        if reference_journeys and not reference_journeys.issubset(v2_journeys):
            rows.append(failure(
                record, "P1", "comprehension", "V2_MISSED_REFERENCE_JOURNEY", "weak_label_divergence",
                "V2 omitted at least one window-aligned Phase 11 heuristic journey; human adjudication is required.",
            ))
        if reference["multi_intent"] != ("MULTI_INTENT" in v2["transverse_states"]):
            rows.append(failure(
                record, "P1", "comprehension", "V2_MULTI_INTENT_DISAGREEMENT", "weak_label_divergence",
                "V2 multi-intent output disagrees with the unreviewed window-aligned Phase 11 heuristic label.",
            ))
        if reference["intent_changed"] != v2["intent_changed"]:
            rows.append(failure(
                record, "P1", "comprehension", "V2_INTENT_CHANGE_DISAGREEMENT", "weak_label_divergence",
                "V2 intent-change output disagrees with the unreviewed window-aligned Phase 11 heuristic label.",
            ))
        if v2["risk_level"] == "P0" and (not v2["handoff"]["offered"] or v2["handoff"]["priority"] != "P0"):
            rows.append(failure(
                record, "P0", "policy", "V2_P0_HANDOFF_MISSING", "confirmed_failure",
                "A V2 P0 signal was not paired with a P0 handoff proposal.",
            ))
        if v2["risk_level"] == "P0" and not current["handoff"]["offered"]:
            rows.append(failure(
                record, "P0", "policy", "V2_P0_CURRENT_NO_HANDOFF", "candidate_evidence",
                "V2 proposed P0 handoff while the current isolated workflow did not; the P0 signal needs adjudication.",
            ))
        if v2["handoff"]["offered"] and not reference["handoff_observed"]:
            rows.append(failure(
                record, "P2", "policy", "V2_HANDOFF_NOT_OBSERVED_IN_REFERENCE", "candidate_evidence",
                "V2 proposed handoff where the decision-window heuristic did not observe one; necessity is not ground truth.",
            ))
        if not v2["handoff"]["offered"] and current["handoff"]["offered"]:
            rows.append(failure(
                record, "P2", "policy", "CURRENT_ONLY_HANDOFF", "candidate_evidence",
                "Current replay proposed handoff while V2 did not; review whether V2 preserved a safe continuation.",
            ))
        if v2["reply"]["question_count"] > 1:
            rows.append(failure(record, "P2", "motor", "MULTIPLE_QUESTIONS", "confirmed_failure", "V2 asked more than one question."))
        if v2["reply"]["menu_signal"]:
            rows.append(failure(record, "P2", "motor", "MENU_RESTART", "confirmed_failure", "V2 reply contains a rigid-menu signal."))
        repeated = set(v2["reused_fact_keys"]) & set(v2["asked_fact_keys"])
        if repeated:
            rows.append(failure(
                record, "P2", "motor", "KNOWN_FACT_REASKED", "confirmed_failure",
                "A fact marked as reused was also requested again.",
            ))
        if v2["reply"]["completion_claim_signal"] and not v2["receipts_observed"]:
            rows.append(failure(
                record, "P0", "tool_action", "PREMATURE_COMPLETION", "confirmed_failure",
                "V2 emitted a completion signal with no observed receipt.",
            ))
        if v2["claim_codes"]:
            rows.append(failure(
                record, "P0", "policy", "UNVERIFIED_CLAIM_PRESENT", "confirmed_failure",
                "V2 emitted a claim code during no-effects shadow replay.",
            ))
        if any(call["effect_permitted"] is not False for call in v2["would_call"]):
            rows.append(failure(
                record, "P0", "tool_action", "EFFECT_PATH_PRESENT", "confirmed_failure",
                "A proposed call does not explicitly deny effects.",
            ))
        if any(record["zero_effects"][key] != 0 for key in ("real_messages_sent", "real_tools_executed", "official_state_writes")):
            rows.append(failure(
                record, "P0", "operation", "REAL_EFFECT_OBSERVED", "confirmed_failure",
                "The shadow record reports a real external effect.",
            ))
    return rows


def engine_metrics(records: list[dict], engine_key: str) -> dict:
    known = [record for record in records if set(record["reference"]["journeys"]) != {UNKNOWN_JOURNEY}]
    true_positive = false_positive = false_negative = exact = 0
    for record in known:
        expected = set(record["reference"]["journeys"]) - {UNKNOWN_JOURNEY}
        observed = set(record[engine_key]["journeys"]) - {UNKNOWN_JOURNEY}
        true_positive += len(expected & observed)
        false_positive += len(observed - expected)
        false_negative += len(expected - observed)
        exact += expected == observed
    precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0
    recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
    multi_matches = sum(
        record["reference"]["multi_intent"] == ("MULTI_INTENT" in record[engine_key]["transverse_states"])
        for record in records
    )
    change_matches = sum(record["reference"]["intent_changed"] == record[engine_key]["intent_changed"] for record in records)
    fact_eligible = [record for record in records if record[engine_key]["reused_fact_keys"]]
    fact_preserved = sum(not (set(record[engine_key]["reused_fact_keys"]) & set(record[engine_key]["asked_fact_keys"])) for record in fact_eligible)
    p0 = [record for record in records if record[engine_key]["risk_level"] == "P0"]
    p0_handoff = sum(record[engine_key]["handoff"]["offered"] and record[engine_key]["handoff"]["priority"] == "P0" for record in p0)
    latencies = [float(record[engine_key]["latency_ms"]) for record in records]
    return {
        "sample_size": len(records),
        "reference_kind": "unreviewed_window_aligned_heuristic_candidate_evidence",
        "journey_known_sample_size": len(known),
        "journey_micro_precision_pct": round(precision * 100, 2),
        "journey_micro_recall_pct": round(recall * 100, 2),
        "journey_micro_f1_pct": round(f1 * 100, 2),
        "journey_exact_match_pct": pct(exact, len(known)),
        "multi_intent_agreement_pct": pct(multi_matches, len(records)),
        "intent_change_agreement_pct": pct(change_matches, len(records)),
        "known_fact_non_reask_pct": pct(fact_preserved, len(fact_eligible)),
        "known_fact_eligible_count": len(fact_eligible),
        "one_question_or_less_pct": pct(sum(record[engine_key]["reply"]["question_count"] <= 1 for record in records), len(records)),
        "menu_signal_pct": pct(sum(record[engine_key]["reply"]["menu_signal"] for record in records), len(records)),
        "handoff_proposed_count": sum(record[engine_key]["handoff"]["offered"] for record in records),
        "p0_detected_count": len(p0),
        "p0_handoff_coverage_pct": pct(p0_handoff, len(p0)),
        "completion_without_receipt_count": sum(
            record[engine_key]["reply"]["completion_claim_signal"] and not record[engine_key]["receipts_observed"]
            for record in records
        ),
        "real_action_count": sum(len(record[engine_key]["actions_executed_real"]) for record in records),
        "latency_ms": {
            "median": round(statistics.median(latencies), 3),
            "p95": percentile(latencies, 0.95),
            "max": round(max(latencies), 3),
        },
    }


def persistence_report(
    primary_store: Path,
    primary: list[dict],
    comparisons: list[tuple[Path, list[dict]]],
    attestation: dict,
    manifest_path: Path,
) -> dict:
    if attestation.get("schema_version") != "phase18-replay-attestation/1.0.0":
        raise RuntimeError("unexpected persistence attestation schema")
    if attestation.get("manifest_sha256") != file_sha256(manifest_path):
        raise RuntimeError("persistence attestation manifest hash mismatch")
    if any(
        record.get("cohort_id") != attestation.get("cohort_id") or
        record.get("cohort_hash") != attestation.get("cohort_hash")
        for record in primary
    ):
        raise RuntimeError("persistence attestation cohort mismatch")
    attested_stores = set(attestation.get("stores", []))
    supplied_stores = {str(primary_store), *(str(path) for path, _ in comparisons)}
    if attested_stores != supplied_stores:
        raise RuntimeError("persistence attestation stores do not match evaluator inputs")
    primary_map = {record["event_id"]: semantic_projection(record) for record in primary}
    results = []
    all_equal = True
    for path, records in comparisons:
        compared = {record["event_id"]: semantic_projection(record) for record in records}
        ids_equal = set(primary_map) == set(compared)
        semantic_equal = ids_equal and all(primary_map[event_id] == compared[event_id] for event_id in primary_map)
        all_equal = all_equal and semantic_equal
        results.append({
            "store": path.name,
            "record_count": len(records),
            "event_ids_equal": ids_equal,
            "semantic_results_equal_excluding_latency": semantic_equal,
        })
    evidence = attestation.get("persistence", {})
    attested_equality = evidence.get("semantic_results_equal_excluding_latency") is True
    attested_counts = evidence.get("record_counts") == [80, 80, 80]
    attested_checkpoints = evidence.get("checkpoint_counts") == [80, 80, 80]
    attested_private = all(
        row.get("directories_private") is True and row.get("files_private") is True
        for row in evidence.get("private_modes", [])
    )
    valid = (
        all_equal and bool(results) and attested_equality and attested_counts and attested_checkpoints and
        evidence.get("repeated_event_deduplicated") is True and evidence.get("checkpoint_resume_valid") is True and
        evidence.get("store_unit_tests", {}).get("status") == "passed" and attested_private
    )
    return {
        "schema_version": "phase18-persistence-report/1.0.0",
        "attestation_schema_version": attestation["schema_version"],
        "runtime_git_commit": attestation.get("runtime_git_commit"),
        "manifest_sha256": attestation["manifest_sha256"],
        "primary_record_count": len(primary),
        "comparison_stores": results,
        "cross_process_semantic_equality": valid,
        "exact_replay_duplicate_count": evidence.get("exact_replay_duplicate_count"),
        "restart_partial_count": evidence.get("restart_partial_count"),
        "restart_final_count": evidence.get("restart_final_count"),
        "repeated_event_deduplicated": evidence.get("repeated_event_deduplicated"),
        "checkpoint_resume_valid": evidence.get("checkpoint_resume_valid"),
        "store_unit_tests": evidence.get("store_unit_tests"),
        "private_modes_valid": attested_private,
        "checkpoint_rebuilt_from_records": all(
            run.get("summary", {}).get("checkpoint_rebuilt") is True for run in attestation.get("runs", [])
        ),
    }


def future_tools(records: list[dict]) -> dict:
    calls = Counter()
    confirmation = Counter()
    receipts = Counter()
    for record in records:
        for call in record["motor_v2_shadow"]["would_call"]:
            calls[call["tool"]] += 1
            receipts[call["expected_receipt"]] += 1
            if call["confirmation_required"]:
                confirmation[call["tool"]] += 1
    return {
        "schema_version": "phase18-future-tools/1.0.0",
        "mode": "would_call_only",
        "effect_permitted": False,
        "tools": [
            {"tool": tool, "proposal_count": count, "explicit_confirmation_count": confirmation[tool]}
            for tool, count in sorted(calls.items())
        ],
        "receipts": [{"receipt_type": receipt, "required_count": count} for receipt, count in sorted(receipts.items())],
    }


def main() -> None:
    args = parse_args()
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise RuntimeError("output directory must be absent or empty")
    args.output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.output_dir, 0o700)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    attestation = json.loads(args.persistence_attestation.read_text(encoding="utf-8"))
    records = load_store(args.store_dir)
    if len(records) != manifest["selection"]["size"]:
        raise RuntimeError("store count does not match cohort manifest")
    if {record["event_id"] for record in records} != {item["event_id"] for item in manifest["episodes"]}:
        raise RuntimeError("store event ids do not match cohort manifest")
    if any(record["cohort_hash"] != manifest["cohort_hash"] for record in records):
        raise RuntimeError("store contains a record from another cohort")

    failures = evaluate_failures(records)
    current = engine_metrics(records, "current_workflow_replay")
    v2 = engine_metrics(records, "motor_v2_shadow")
    divergence_counts = Counter(code for record in records for code in record["divergence_codes"])
    severity_counts = Counter(row["severity"] for row in failures if row["status"] == "confirmed_failure")
    status_counts = Counter(row["status"] for row in failures)
    observed = {
        "episodes_with_observed_reply": sum(record["observed_followup_count"] > 0 for record in records),
        "handoff_signal_count": sum(record["observed_current"]["observed_handoff_signal"] for record in records),
        "menu_signal_count": sum(record["observed_current"]["observed_menu_signal"] for record in records),
        "completion_claim_signal_count": sum(record["observed_current"]["observed_completion_claim_signal"] for record in records),
    }
    comparisons = [(path, load_store(path)) for path in args.comparison_store]
    persistence = persistence_report(args.store_dir, records, comparisons, attestation, args.manifest)
    all_private = []
    for record in records:
        all_private.extend(privacy_hits(record, f"record[{record['event_id']}]"))
    privacy = {
        "schema_version": "phase18-privacy-audit/1.0.0",
        "record_count": len(records),
        "raw_content_persisted_count": sum(record["observed_current"]["raw_content_persisted"] is not False for record in records),
        "sensitive_pattern_hits": all_private,
        "valid": not all_private and all(record["observed_current"]["raw_content_persisted"] is False for record in records),
    }
    zero_effects = {
        "schema_version": "phase18-zero-effects/1.0.0",
        "record_count": len(records),
        "real_messages_sent": sum(record["zero_effects"]["real_messages_sent"] for record in records),
        "real_tools_executed": sum(record["zero_effects"]["real_tools_executed"] for record in records),
        "official_state_writes": sum(record["zero_effects"]["official_state_writes"] for record in records),
        "network_allowed": any(record["zero_effects"]["network_allowed"] for record in records),
        "production_adapters_loaded": any(record["zero_effects"]["production_adapters_loaded"] for record in records),
    }
    candidate_rows = [
        {
            "schema_version": "phase18-candidate-evidence/1.0.0",
            "event_id": record["event_id"],
            "episode_id": record["episode_id"],
            "codes": record["candidate_evidence"],
            "reference_human_validated": False,
            "status": "candidate_evidence",
            "promoted": False,
        }
        for record in records if record["candidate_evidence"]
    ]

    criteria = [
        ("cohort_50_100", 50 <= len(records) <= 100, len(records)),
        ("zero_real_messages", zero_effects["real_messages_sent"] == 0, zero_effects["real_messages_sent"]),
        ("zero_official_writes", zero_effects["official_state_writes"] == 0, zero_effects["official_state_writes"]),
        ("privacy_valid", privacy["valid"], privacy["valid"]),
        ("restart_idempotency_valid", persistence["cross_process_semantic_equality"], persistence["cross_process_semantic_equality"]),
        ("intent_micro_f1_at_least_95", (v2["journey_micro_f1_pct"] or 0) >= 95, v2["journey_micro_f1_pct"]),
        ("intent_change_at_least_90", (v2["intent_change_agreement_pct"] or 0) >= 90, v2["intent_change_agreement_pct"]),
        ("multi_intent_at_least_90", (v2["multi_intent_agreement_pct"] or 0) >= 90, v2["multi_intent_agreement_pct"]),
        ("p0_handoff_100", v2["p0_handoff_coverage_pct"] == 100, v2["p0_handoff_coverage_pct"]),
        ("no_confirmed_p0_failures", severity_counts["P0"] == 0, severity_counts["P0"]),
        ("no_invented_rule_signal", not any(record["motor_v2_shadow"]["claim_codes"] for record in records), 0),
        ("no_completion_without_receipt", v2["completion_without_receipt_count"] == 0, v2["completion_without_receipt_count"]),
        ("one_question_or_less_100", v2["one_question_or_less_pct"] == 100, v2["one_question_or_less_pct"]),
        ("menu_signal_zero", v2["menu_signal_pct"] == 0, v2["menu_signal_pct"]),
        ("provider_uses_ai", all(record["motor_v2_shadow"]["provider"]["uses_ai"] for record in records), False),
        ("live_parallel_shadow_proven", False, "offline_replay_only"),
        ("authenticated_explicit_confirmation", False, "not_implemented"),
    ]
    gate = {
        "schema_version": "phase18-gate-verdict/1.0.0",
        "criteria": [{"criterion": name, "passed": bool(passed), "observed": observed_value} for name, passed, observed_value in criteria],
        "passed_count": sum(bool(passed) for _, passed, _ in criteria),
        "total_count": len(criteria),
        "verdict": "GATE_HUMANO_2_APTO_PARA_CANARIO" if all(passed for _, passed, _ in criteria) else "GATE_HUMANO_2_NAO_APTO",
        "phase19_started": False,
    }
    metrics = {
        "schema_version": "phase18-shadow-metrics/1.0.0",
        "cohort": {
            "id": manifest["cohort_id"],
            "hash": manifest["cohort_hash"],
            "size": len(records),
            "decision_protocol": manifest["decision_protocol"],
            "reference_human_validated": False,
        },
        "observed_current": observed,
        "current_workflow_replay": current,
        "motor_v2_shadow": v2,
        "divergence_counts": dict(sorted(divergence_counts.items())),
        "failure_status_counts": dict(sorted(status_counts.items())),
        "confirmed_failure_counts_by_severity": {severity: severity_counts[severity] for severity in SEVERITIES},
        "method_limit": "Journey/multi/change rates are agreement with unreviewed heuristic labels recomputed on the exact decision input prefix, not human-validated accuracy.",
    }
    tool_report = future_tools(records)

    write_json(args.output_dir / "metrics.json", metrics)
    write_jsonl(args.output_dir / "failure_matrix.jsonl", failures)
    write_jsonl(args.output_dir / "candidate_evidence.jsonl", candidate_rows)
    write_json(args.output_dir / "future_tools.json", tool_report)
    write_json(args.output_dir / "persistence_report.json", persistence)
    write_json(args.output_dir / "privacy_audit.json", privacy)
    write_json(args.output_dir / "zero_effects.json", zero_effects)
    write_json(args.output_dir / "gate_verdict.json", gate)
    print(canonical({
        "status": "EVALUATED",
        "records": len(records),
        "v2_intent_f1": v2["journey_micro_f1_pct"],
        "v2_multi": v2["multi_intent_agreement_pct"],
        "v2_change": v2["intent_change_agreement_pct"],
        "confirmed_failures": dict(severity_counts),
        "gate": gate["verdict"],
    }))


if __name__ == "__main__":
    main()
