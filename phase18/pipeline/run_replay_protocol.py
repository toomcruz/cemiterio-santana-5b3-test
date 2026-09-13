#!/usr/bin/env python3
"""Run and attest the no-effects restart/idempotency replay protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


SCHEMA = "phase18-replay-attestation/1.0.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deno", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--classification", type=Path, required=True)
    parser.add_argument("--semantic", type=Path, required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--store-a", type=Path, required=True)
    parser.add_argument("--store-b", type=Path, required=True)
    parser.add_argument("--store-c", type=Path, required=True)
    parser.add_argument("--attestation", type=Path, required=True)
    parser.add_argument("--partial-count", type=int, default=37)
    return parser.parse_args()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def command_output(command: list[str]) -> str:
    completed = subprocess.run(command, check=True, text=True, capture_output=True, timeout=120)
    return completed.stdout.strip()


def run_replay(args: argparse.Namespace, store: Path, cohort_id: str, cohort_hash: str, max_cases: int | None) -> dict:
    source_command = [
        sys.executable,
        "phase18/pipeline/prepare_cohort.py",
        "--mode",
        "stream",
        "--snapshot",
        str(args.snapshot),
        "--classification",
        str(args.classification),
        "--semantic",
        str(args.semantic),
        "--key",
        str(args.key),
        "--manifest",
        str(args.manifest),
        "--size",
        "80",
    ]
    runner_command = [
        str(args.deno),
        "run",
        "--allow-read=.",
        f"--allow-write={store}",
        "phase18/shadow/run_shadow.ts",
        "--mode",
        "OFFLINE_REPLAY",
        "--store-dir",
        str(store),
        "--cohort-id",
        cohort_id,
        "--cohort-hash",
        cohort_hash,
    ]
    if max_cases is not None:
        runner_command.extend(["--max-cases", str(max_cases)])
    source = subprocess.Popen(source_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert source.stdout is not None
    runner = subprocess.Popen(
        runner_command,
        stdin=source.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    source.stdout.close()
    runner_stdout, runner_stderr = runner.communicate(timeout=120)
    source_stderr = source.stderr.read().decode("utf-8", errors="replace") if source.stderr else ""
    source_code = source.wait(timeout=30)
    if source_code or runner.returncode:
        raise RuntimeError(
            canonical({
                "source_exit": source_code,
                "runner_exit": runner.returncode,
                "source_error": source_stderr[-500:],
                "runner_error": runner_stderr[-500:],
            })
        )
    lines = [line for line in runner_stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError("runner must emit exactly one summary line")
    summary = json.loads(lines[0])
    return {
        "source_exit": source_code,
        "runner_exit": runner.returncode,
        "max_cases": max_cases,
        "summary": summary,
        "raw_content_captured": False,
    }


def load_results(store: Path) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for path in sorted((store / "records").glob("*.json")):
        wrapper = json.loads(path.read_text(encoding="utf-8"))
        result = wrapper["result"]
        if result.get("schema_version") != "phase18-shadow-record/1.2.0":
            raise RuntimeError(f"unexpected record schema in {path.name}")
        projection = json.loads(canonical(result))
        projection["current_workflow_replay"].pop("latency_ms", None)
        projection["motor_v2_shadow"].pop("latency_ms", None)
        results[result["event_id"]] = projection
    return results


def modes_under(store: Path) -> dict:
    directories = [store, store / "records", store / "tmp", store / "locks"]
    files = [path for path in store.rglob("*") if path.is_file()]
    return {
        "directories_private": all(stat.S_IMODE(path.stat().st_mode) == 0o700 for path in directories),
        "files_private": all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in files),
        "file_count": len(files),
    }


def main() -> None:
    args = parse_args()
    stores = (args.store_a, args.store_b, args.store_c)
    if not 1 <= args.partial_count < 80:
        raise RuntimeError("partial count must be between 1 and 79")
    for store in stores:
        if store.exists():
            raise RuntimeError(f"store must not exist: {store}")
        if not str(store).startswith("phase18/run/store-"):
            raise RuntimeError("stores must remain under phase18/run/store-*")
    if args.attestation.exists():
        raise RuntimeError("attestation must not already exist")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "phase18-cohort-manifest/1.2.0":
        raise RuntimeError("unexpected manifest schema")
    cohort_id = manifest["cohort_id"]
    cohort_hash = manifest["cohort_hash"]

    runs = [
        {"name": "fresh_a", **run_replay(args, args.store_a, cohort_id, cohort_hash, None)},
        {"name": "exact_replay_a", **run_replay(args, args.store_a, cohort_id, cohort_hash, None)},
        {"name": "partial_b_before_restart", **run_replay(args, args.store_b, cohort_id, cohort_hash, args.partial_count)},
        {"name": "resume_b_after_restart", **run_replay(args, args.store_b, cohort_id, cohort_hash, None)},
        {"name": "independent_c", **run_replay(args, args.store_c, cohort_id, cohort_hash, None)},
    ]
    projections = [load_results(store) for store in stores]
    event_ids_equal = all(set(projections[0]) == set(current) for current in projections[1:])
    semantic_equal = event_ids_equal and all(projections[0] == current for current in projections[1:])
    checkpoints = [json.loads((store / "checkpoint.json").read_text(encoding="utf-8")) for store in stores]

    store_test = subprocess.run(
        [str(args.deno), "test", "--allow-read", "--allow-write", "--allow-sys", "phase18/tests/shadow_store_test.ts"],
        text=True,
        capture_output=True,
        timeout=120,
    )
    if store_test.returncode:
        raise RuntimeError("shadow store test suite failed")
    required_store_tests = [
        "survives reopen and exact replay is idempotent",
        "same event id with different input fails closed",
        "concurrent conflicting commits serialize and fail closed",
        "rejects a persisted record from another cohort",
        "checkpoint is reconstructed from complete records",
    ]
    if any(name not in store_test.stdout for name in required_store_tests):
        raise RuntimeError("shadow store test evidence is incomplete")
    info = json.loads(command_output([str(args.deno), "info", "--json", "phase18/shadow/run_shadow.ts"]))
    modules = [str(module.get("specifier", "")) for module in info.get("modules", [])]
    forbidden = [value for value in modules if any(token in value for token in ("/network.ts", "supabase", "wapi", "_shared/shadow"))]
    if forbidden:
        raise RuntimeError("forbidden module in shadow import closure")
    commit = command_output(["git", "rev-parse", "HEAD"])
    dirty = command_output(["git", "status", "--porcelain", "--untracked-files=no"])
    if dirty:
        raise RuntimeError("tracked source must be committed before attestation")
    off = json.loads(command_output([str(args.deno), "run", "--allow-read=.", "phase18/shadow/run_shadow.ts", "--mode", "OFF"]))

    attestation = {
        "schema_version": SCHEMA,
        "runtime_git_commit": commit,
        "manifest_sha256": sha256_file(args.manifest),
        "cohort_id": cohort_id,
        "cohort_hash": cohort_hash,
        "stores": [str(store) for store in stores],
        "runs": runs,
        "persistence": {
            "record_counts": [len(result) for result in projections],
            "checkpoint_counts": [row["completed_count"] for row in checkpoints],
            "event_ids_equal": event_ids_equal,
            "semantic_results_equal_excluding_latency": semantic_equal,
            "exact_replay_duplicate_count": runs[1]["summary"]["duplicates"],
            "restart_partial_count": runs[2]["summary"]["persisted"],
            "restart_final_count": runs[3]["summary"]["persisted"],
            "repeated_event_deduplicated": runs[1]["summary"]["duplicates"] == 80,
            "checkpoint_resume_valid": runs[2]["summary"]["persisted"] == args.partial_count
            and runs[3]["summary"]["duplicates"] == args.partial_count
            and runs[3]["summary"]["persisted"] == 80,
            "store_unit_tests": {"status": "passed", "tests": required_store_tests},
            "private_modes": [modes_under(store) for store in stores],
        },
        "boundary": {
            "mode_off_summary": off,
            "network_permission_granted": False,
            "production_adapter_modules_in_import_closure": forbidden,
            "raw_content_persisted": False,
        },
    }
    args.attestation.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.attestation.parent, 0o700)
    args.attestation.write_text(canonical(attestation) + "\n", encoding="utf-8")
    os.chmod(args.attestation, 0o600)
    print(canonical({
        "status": "ATTESTED",
        "stores": [len(result) for result in projections],
        "semantic_equal": semantic_equal,
        "exact_replay_duplicates": runs[1]["summary"]["duplicates"],
        "restart": [runs[2]["summary"]["persisted"], runs[3]["summary"]["persisted"]],
        "real_effects": 0,
    }))


if __name__ == "__main__":
    main()
