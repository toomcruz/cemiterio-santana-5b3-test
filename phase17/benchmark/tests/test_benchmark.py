from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchmark import (  # noqa: E402
    BenchmarkInputError,
    canonical_case_hash,
    evaluate_assertion,
    privacy_hits,
    read_json,
    run_benchmark,
    score_engine_run,
    sha256_file,
)


DIMENSIONS = [
    "comprehension",
    "context",
    "multi_intent",
    "handoff",
    "safety",
    "efficiency",
    "receipts_actions",
    "correct_closure",
]


def assertion(
    assertion_id: str,
    dimension: str,
    target: str,
    operator: str,
    expected,
    severity: str = "P1",
) -> dict:
    return {
        "assertion_id": assertion_id,
        "dimension": dimension,
        "critical": True,
        "severity": severity,
        "failure_layer": "tool_action" if dimension == "receipts_actions" else "motor",
        "description": assertion_id,
        "weight": 1,
        "machine_check": {"target_path": target, "operator": operator, "expected": expected},
    }


def trace() -> dict:
    return {
        "schema_version": "benchmark-trace-v1.0.0",
        "case_id": "gold_v2_rank_01",
        "reply": "Resposta segura.",
        "recognized_intents": ["INTENT_A"],
        "reused_fact_keys": ["known_fact"],
        "asked_fact_keys": [],
        "actions": [],
        "track_updates": [],
        "handoff": {
            "offered": True,
            "priority": "normal",
            "reason": "policy",
            "payload_fields": ["known_facts"],
            "accepted": "unknown",
        },
        "claims": [],
        "tool_calls": [],
        "receipts_used": [],
        "final_track_states": {"track_a": "active"},
        "case_closed": False,
        "closure_basis": [],
        "normalization": {"method": "deterministic", "model": "none", "review_required": False},
    }


def fixture(source_sha: str) -> dict:
    assertions = [
        assertion("reply", "comprehension", "reply", "nonempty", True),
        assertion("context", "context", "reused_fact_keys", "contains_all", ["known_fact"]),
        assertion("tracks", "multi_intent", "final_track_states", "contains_all", ["track_a"]),
        assertion("handoff", "handoff", "handoff.offered", "equals", True),
        assertion("safe", "safety", "claims", "not_contains_any", ["BAD"], "P0"),
        assertion("efficient", "efficiency", "reply", "not_contains_any", ["menu"], "P2"),
        assertion("no_effect", "receipts_actions", "tool_calls", "event_absent", {"side_effect": True}, "P0"),
        assertion("open", "correct_closure", "case_closed", "equals", False),
    ]
    value = {
        "schema_version": "gold-fixture-test-v1",
        "case_id": "gold_v2_rank_01",
        "review_rank": 1,
        "provenance": {"source_artifact_sha256": source_sha},
        "governance": {"production_promoted": False, "implemented": False},
        "input": {
            "administrative_gaps": {"procedure": "requires_current_policy"},
            "known_facts": [{"key": "known_fact", "source_turn": "t01"}],
            "do_not_ask_again": ["known_fact"],
            "messages": [{"turn_id": "t01", "role": "user", "content": "Teste sintético."}],
            "track_states": [{"track_id": "track_a", "status": "active"}],
        },
        "expected_behavior": {"assertions": assertions},
        "forbidden_behavior": {"assertions": []},
        "receipts": {"required": []},
        "scoring": {
            "critical_failure_rules": [item["assertion_id"] for item in assertions],
            "weights": dict(zip(DIMENSIONS, [13, 13, 13, 13, 12, 12, 12, 12])),
        },
    }
    value["case_hash"] = canonical_case_hash(value)
    return value


def run_row(
    case: dict,
    value: dict | None = None,
    *,
    engine: str = "current_workflow",
    replay: int = 1,
    run_id: str | None = None,
) -> dict:
    current = engine == "current_workflow"
    return {
        "schema_version": "phase17-engine-run-v1.0.0",
        "engine": {
            "id": "current-workflow/test" if current else "motor-v2/test",
            "runtime": "test",
        },
        "execution": {
            "run_id": run_id or f"test-execution-{engine}-{replay}",
            "replay": replay,
            "engine_instance_scope": "fresh_per_case",
        },
        "case_id": case["case_id"],
        "case_hash": case["case_hash"],
        "status": "COMPLETED",
        "environment": {"isolated": True, "network_access": False, "production_access": False},
        "runtime": {
            "network_allowed": False,
            "production_adapters_loaded": False,
            "external_side_effects": False,
        },
        "trace": value or trace(),
        "idempotency_probe": {
            "duplicate_kind": "DUPLICATE",
            "duplicate_reply_is_null": True,
            "revision_unchanged": True,
            "commits_unchanged": True,
            "outbox_unchanged": True,
        } if current else {
            "duplicate_detected": True,
            "revision_unchanged": True,
            "state_hash_unchanged": True,
            "audit_unchanged": True,
            "trace_unchanged": True,
        },
        "receipt_evidence": [],
        "operational": {"latency_ms": 2, "retries": 0, "network_calls": 0, "resources": {"cpu_ms": 1}},
        "audit_summary": {},
    }


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")


def build_bundle(root: Path) -> tuple[dict[str, Path], dict]:
    source = root / "provenance/source.jsonl"
    source.parent.mkdir(parents=True)
    source.write_text("{}\n", encoding="utf-8")
    source_sha = sha256_file(source)
    case = fixture(source_sha)
    fixtures = root / "fixtures/fixtures.jsonl"
    fixtures.parent.mkdir(parents=True)
    fixtures.write_text(json.dumps(case, sort_keys=True) + "\n", encoding="utf-8")
    summary = root / "fixtures/summary.json"
    write_json(summary, {
        "fixture_count": 1,
        "review_ranks": [1],
        "schema_version": "gold-fixture-test-v1",
        "source_sha256": source_sha,
    })
    fixture_schema = root / "schema/fixture.json"
    trace_schema = root / "schema/trace.json"
    write_json(fixture_schema, {"type": "object", "required": ["case_id", "case_hash"]})
    write_json(trace_schema, {"type": "object", "required": list(trace())})
    gate = root / "governance/gate.json"
    write_json(gate, {
        "required_release_thresholds": {
            "P0_failures": 0,
            "P1_failures": 0,
            "comprehension_min": 90,
            "context_min": 90,
            "correct_closure": 100,
            "efficiency_min": 85,
            "handoff_min": 90,
            "multi_intent_min": 90,
            "receipts_actions": 100,
            "regression_max_points_per_case": 5,
            "regression_max_points_per_dimension": 2,
            "safety": 100,
            "three_replays_critical_vector_identical": True,
            "three_replays_dimension_variation_max_points": 2,
        }
    })
    files = [fixtures, summary, fixture_schema, trace_schema, gate, source]
    manifest = root / "MANIFEST.sha256"
    manifest.write_text(
        "".join(f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n" for path in sorted(files)),
        encoding="utf-8",
    )
    run = root / "runs/run.jsonl"
    run.parent.mkdir(parents=True)
    run.write_text(json.dumps(run_row(case), sort_keys=True) + "\n", encoding="utf-8")
    return {
        "fixtures_path": fixtures,
        "fixture_summary_path": summary,
        "fixture_schema_path": fixture_schema,
        "trace_schema_path": trace_schema,
        "manifest_path": manifest,
        "gate_path": gate,
        "current_run_path": run,
    }, case


def write_v2_replays(root: Path, case: dict) -> list[Path]:
    paths: list[Path] = []
    for replay in range(1, 4):
        path = root / f"runs/v2-replay-{replay}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = run_row(
            case,
            engine="motor_v2",
            replay=replay,
            run_id=f"test-v2-independent-run-{replay}",
        )
        path.write_text(json.dumps(row, sort_keys=True) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


class BenchmarkTests(unittest.TestCase):
    def test_privacy_safe_paths_require_an_exact_terminal_field_name(self) -> None:
        phone_hits = privacy_hits({"not_case_id_secret": "+55 11 98888-7777"})
        cpf_hits = privacy_hits({"source_episode_id_note": "CPF 123.456.789-00"})
        self.assertTrue(phone_hits)
        self.assertTrue(cpf_hits)
        self.assertEqual(privacy_hits({"case_id": "episode_8f9ba7944b6d2705d62ff6ca"}), [])

    def test_phase15_assertion_semantics(self) -> None:
        value = trace()
        checks = [
            assertion("a", "context", "recognized_intents", "contains_all", ["INTENT_A"]),
            assertion("b", "context", "recognized_intents", "contains_any", ["NONE", "INTENT_A"]),
            assertion("c", "context", "reply", "not_contains_any", ["menu"]),
            assertion("d", "context", "handoff.offered", "equals", True),
            assertion("e", "context", "reply", "nonempty", True),
            assertion("f", "context", "tool_calls", "event_absent", {"side_effect": True}),
            assertion("g", "context", "case_closed", "closure_allowed", False),
        ]
        self.assertTrue(all(evaluate_assertion(value, item)[0] for item in checks))

    def test_end_to_end_outputs_are_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = build_bundle(Path(directory) / "source")
            case = json.loads(paths["fixtures_path"].read_text(encoding="utf-8"))
            v2_paths = write_v2_replays(Path(directory) / "source", case)
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            kwargs = {**paths, "v2_run_paths": v2_paths}
            one = run_benchmark(**kwargs, output_dir=first)
            two = run_benchmark(**kwargs, output_dir=second)
            self.assertEqual(one["verdict"], "GATE_HUMANO_1_APTO_PARA_SHADOW_MODE")
            self.assertEqual(one["verdict"], two["verdict"])
            first_hashes = {path.name: sha256_file(path) for path in first.iterdir()}
            second_hashes = {path.name: sha256_file(path) for path in second.iterdir()}
            self.assertEqual(first_hashes, second_hashes)
            run_benchmark(**kwargs, output_dir=first)
            self.assertEqual(first_hashes, {path.name: sha256_file(path) for path in first.iterdir()})
            self.assertEqual(read_json(first / "gate_verdict.json")["blocking_checks"], [])

    def test_fixture_manifest_drift_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = build_bundle(Path(directory) / "source")
            v2_paths = write_v2_replays(Path(directory) / "source", json.loads(
                paths["fixtures_path"].read_text(encoding="utf-8")
            ))
            paths["fixtures_path"].write_text(paths["fixtures_path"].read_text() + " ", encoding="utf-8")
            with self.assertRaises(BenchmarkInputError):
                run_benchmark(
                    **paths,
                    v2_run_paths=v2_paths,
                    output_dir=Path(directory) / "out",
                )

    def test_unknown_receipt_and_network_are_hard_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths, case = build_bundle(Path(directory) / "source")
            bad_trace = copy.deepcopy(trace())
            bad_trace["receipts_used"] = ["unknown_receipt"]
            run = run_row(case, bad_trace, engine="motor_v2")
            run["environment"]["network_access"] = True
            report, failures = score_engine_run(
                [case],
                [run],
                {"type": "object", "required": list(trace())},
                engine="motor_v2",
                replay=1,
            )
            self.assertEqual(report["status"], "INVALID_HARD_GUARD")
            self.assertTrue({"unknown_receipt", "isolation_or_network_guard"}.issubset(
                {failure["failure_id"] for failure in failures}
            ))

    def test_duplicate_replay_source_blocks_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths, case = build_bundle(Path(directory) / "source")
            replay = Path(directory) / "source/runs/v2.jsonl"
            replay.write_text(json.dumps(run_row(case, engine="motor_v2"), sort_keys=True) + "\n", encoding="utf-8")
            result = run_benchmark(
                **paths,
                v2_run_paths=[replay, replay, replay],
                output_dir=Path(directory) / "out",
            )
            self.assertEqual(result["verdict"], "GATE_HUMANO_1_NAO_APTO")
            failures = [json.loads(line) for line in (Path(directory) / "out/failure_matrix.jsonl").read_text().splitlines()]
            self.assertIn("replay_sources_not_independent", {item["failure_id"] for item in failures})

    def test_contradictory_isolation_and_weak_idempotency_are_hard_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, case = build_bundle(Path(directory) / "source")
            run = run_row(case, engine="motor_v2")
            run["runtime"]["network_allowed"] = True
            run["idempotency_probe"] = {"anything": True}
            report, failures = score_engine_run(
                [case],
                [run],
                {"type": "object", "required": list(trace())},
                engine="motor_v2",
                replay=1,
            )
            self.assertEqual(report["status"], "INVALID_HARD_GUARD")
            self.assertTrue({"isolation_or_network_guard", "runtime_idempotency"}.issubset(
                {failure["failure_id"] for failure in failures}
            ))

    def test_receipt_type_without_integrity_evidence_is_a_hard_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, case = build_bundle(Path(directory) / "source")
            case["receipts"]["required"] = [{"claim_code": "done", "receipt_type": "execution_confirmation"}]
            bad_trace = copy.deepcopy(trace())
            bad_trace["receipts_used"] = ["execution_confirmation"]
            bad_trace["claims"] = [{
                "claim_code": "done",
                "text_span": "done",
                "receipt_refs": ["execution_confirmation"],
            }]
            run = run_row(case, bad_trace, engine="motor_v2")
            report, failures = score_engine_run(
                [case],
                [run],
                {"type": "object", "required": list(trace())},
                engine="motor_v2",
                replay=1,
            )
            self.assertEqual(report["status"], "INVALID_HARD_GUARD")
            self.assertTrue({"receipt_used_without_evidence", "claim_receipt_not_bound"}.issubset(
                {failure["failure_id"] for failure in failures}
            ))


if __name__ == "__main__":
    unittest.main()
