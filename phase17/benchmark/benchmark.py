#!/usr/bin/env python3
"""Deterministic Phase 17 scorer for immutable Gold V2 fixtures.

The engines produce normalized ``benchmark-trace-v1`` rows.  This module never
runs an engine, reads production state, or mutates the fixture set.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import re
import statistics
import sys
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


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
SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
ALLOWED_GAP_VALUES = {"unknown", "requires_current_policy", "human_validation_required"}
REQUIRED_GATE_KEYS = {
    "P0_failures",
    "P1_failures",
    "comprehension_min",
    "context_min",
    "correct_closure",
    "efficiency_min",
    "handoff_min",
    "multi_intent_min",
    "receipts_actions",
    "regression_max_points_per_case",
    "regression_max_points_per_dimension",
    "safety",
    "three_replays_critical_vector_identical",
    "three_replays_dimension_variation_max_points",
}
SAFE_ID_PATHS = (
    "case_id",
    "case_hash",
    "source_gold_case_id",
    "source_episode_id",
    "source_artifact_sha256",
    "source_period_sao_paulo",
)
ENGINE_RUN_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas/engine-run-v1.schema.json"


class BenchmarkInputError(ValueError):
    """Raised when immutable inputs cannot be trusted or parsed."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_case_hash(fixture: dict[str, Any]) -> str:
    clone = copy.deepcopy(fixture)
    clone.pop("case_hash", None)
    return hashlib.sha256(canonical_bytes(clone)).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkInputError(f"invalid JSON input {path.name}: {exc}") from exc


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise BenchmarkInputError(f"{path.name}:{line_number}: row must be an object")
            rows.append(value)
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkInputError(f"invalid JSONL input {path.name}: {exc}") from exc
    return rows


def parse_manifest(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  ([^\r\n]+)", line)
        if not match:
            raise BenchmarkInputError(f"{path.name}:{line_number}: invalid manifest entry")
        relative = match.group(2)
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or relative in entries:
            raise BenchmarkInputError(f"{path.name}:{line_number}: unsafe or duplicate path")
        entries[relative] = match.group(1)
    if not entries:
        raise BenchmarkInputError(f"{path.name}: empty manifest")
    return entries


def verify_manifest(path: Path) -> dict[str, Any]:
    entries = parse_manifest(path)
    base = path.parent.resolve()
    mismatches: list[dict[str, str]] = []
    for relative, expected in sorted(entries.items()):
        target = (base / relative).resolve()
        try:
            target.relative_to(base)
        except ValueError as exc:
            raise BenchmarkInputError(f"manifest path escapes source root: {relative}") from exc
        if not target.is_file():
            mismatches.append({"path": relative, "error": "missing"})
            continue
        actual = sha256_file(target)
        if actual != expected:
            mismatches.append({"path": relative, "error": "sha256_mismatch"})
    return {
        "status": "PASS" if not mismatches else "FAIL",
        "entry_count": len(entries),
        "manifest_sha256": sha256_file(path),
        "mismatches": mismatches,
        "entries": entries,
    }


def manifest_entry_for(path: Path, manifest: Path, entries: dict[str, str]) -> tuple[str, str]:
    base = manifest.parent.resolve()
    try:
        relative = path.resolve().relative_to(base).as_posix()
    except ValueError as exc:
        raise BenchmarkInputError(f"{path.name} is outside manifest root") from exc
    if relative not in entries:
        raise BenchmarkInputError(f"{relative} is absent from {manifest.name}")
    actual = sha256_file(path)
    if actual != entries[relative]:
        raise BenchmarkInputError(f"manifest hash mismatch for {relative}")
    return relative, actual


def resolve_ref(root_schema: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise BenchmarkInputError(f"external JSON Schema ref unsupported: {ref}")
    node: Any = root_schema
    for part in ref[2:].split("/"):
        node = node[part.replace("~1", "/").replace("~0", "~")]
    if not isinstance(node, dict):
        raise BenchmarkInputError(f"JSON Schema ref is not an object: {ref}")
    return node


def validate_schema(
    value: Any,
    schema: dict[str, Any],
    root_schema: dict[str, Any],
    path: str = "$",
) -> list[str]:
    """Small stdlib validator matching the Phase 15 schema feature set."""
    errors: list[str] = []
    if "$ref" in schema:
        return validate_schema(value, resolve_ref(root_schema, schema["$ref"]), root_schema, path)
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: value outside enum")
    expected_type = schema.get("type")
    if expected_type is not None:
        candidates = expected_type if isinstance(expected_type, list) else [expected_type]
        checks = {
            "object": lambda item: isinstance(item, dict),
            "array": lambda item: isinstance(item, list),
            "string": lambda item: isinstance(item, str),
            "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
            "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
            "boolean": lambda item: isinstance(item, bool),
            "null": lambda item: item is None,
        }
        try:
            valid_type = any(checks[candidate](value) for candidate in candidates)
        except KeyError as exc:
            raise BenchmarkInputError(f"unsupported JSON Schema type: {exc.args[0]}") from exc
        if not valid_type:
            return errors + [f"{path}: expected type {candidates}"]
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{path}: missing required key {key}")
        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, item in value.items():
            child_path = f"{path}.{key}"
            if key in properties:
                errors.extend(validate_schema(item, properties[key], root_schema, child_path))
            elif additional is False:
                errors.append(f"{child_path}: additional property not allowed")
            elif isinstance(additional, dict):
                errors.extend(validate_schema(item, additional, root_schema, child_path))
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append(f"{path}: too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: too many items")
        if schema.get("uniqueItems"):
            tokens = [json.dumps(item, ensure_ascii=False, sort_keys=True) for item in value]
            if len(tokens) != len(set(tokens)):
                errors.append(f"{path}: items not unique")
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                errors.extend(validate_schema(item, schema["items"], root_schema, f"{path}[{index}]"))
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append(f"{path}: string too short")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: pattern mismatch")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above maximum")
    return errors


def normalize(text: str) -> str:
    value = text
    for _ in range(2):
        value = urllib.parse.unquote(html.unescape(value))
    value = unicodedata.normalize("NFKC", value)
    return re.sub(r"[\u200b-\u200f\u2060\ufeff]", "", value)


DETECTORS = {
    "jid": re.compile(r"\b\d{6,20}@(s\.whatsapp\.net|lid|g\.us)\b", re.I),
    "email": re.compile(r"(?<![\w.-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I),
    "cpf": re.compile(r"(?<!\d)\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}(?!\d)"),
    "phone_country": re.compile(r"(?<!\w)\+?55[\s().-]*(?:\d[\s().-]*){10,11}(?!\w)"),
    "phone_context": re.compile(r"\b(?:telefone|celular|whatsapp)\b[^\n]{0,20}(?:\d[\s().-]*){8,11}", re.I),
    "sensitive_link": re.compile(r"(?:https?://|www\.|mailto:|tel:|wa\.me/|whatsapp\.com/)", re.I),
    "document_identifier": re.compile(
        r"\b(?:rg|cnh|cpf|cnpj|ctps|passaporte|matr[ií]cula|protocolo|inscri[cç][aã]o)\b"
        r"\s*[:#-]?\s*[A-Z0-9][A-Z0-9./-]{4,}",
        re.I,
    ),
    "full_name_context": re.compile(
        r"\b(?:nome|titular|falecido|falecida)\b\s*[:=-]?\s*"
        r"[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+"
        r"(?:\s+(?:da|de|do|das|dos))?\s+"
        r"[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+"
    ),
    "long_base64": re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{256,}={0,2}(?![A-Za-z0-9+/])"),
}
FORBIDDEN_KEYS = re.compile(
    r"^(?:phone|telefone|celular|remote_?jid|jid|cpf|email|full_?name|nome_?completo|"
    r"document_?content|attachment|media_?url|signed_?url)$",
    re.I,
)
KEY_ALLOWLIST = {"contains_source_media"}


def iter_leaves(value: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield from iter_leaves(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from iter_leaves(item, f"{path}[{index}]")
    elif isinstance(value, str):
        yield path, value


def privacy_hits(payload: Any) -> list[dict[str, str]]:
    """Return locations and detector names only; never echo matched content."""
    hits: list[dict[str, str]] = []

    def inspect_keys(value: Any, path: str = "$") -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                child = f"{path}.{key}"
                if key not in KEY_ALLOWLIST and FORBIDDEN_KEYS.search(key):
                    hits.append({"path": child, "detector": "forbidden_key"})
                inspect_keys(item, child)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                inspect_keys(item, f"{path}[{index}]")

    inspect_keys(payload)
    for path, original in iter_leaves(payload):
        variants = {original, normalize(original)}
        terminal_key = re.sub(r"\[\d+\]$", "", path.rsplit(".", 1)[-1])
        safe_id_path = terminal_key in SAFE_ID_PATHS
        for detector, pattern in DETECTORS.items():
            hash_value = bool(re.fullmatch(r"[0-9a-f]{64}", original, re.I)) and any(
                token in terminal_key.casefold() for token in ("hash", "sha256")
            )
            if detector in {
                "phone_country",
                "phone_context",
                "cpf",
                "document_identifier",
                "full_name_context",
            } and (safe_id_path or hash_value):
                continue
            if any(pattern.search(value) for value in variants):
                hits.append({"path": path, "detector": detector})
    return sorted(hits, key=lambda item: (item["path"], item["detector"]))


def run_privacy_canaries() -> dict[str, Any]:
    canaries = {
        "phone": {"text": "telefone: +55 11 98888-7777", "expect": {"phone_country", "phone_context"}},
        "jid": {"text": "5511988887777@s.whatsapp.net", "expect": {"jid"}},
        "cpf": {"text": "CPF 123.456.789-00", "expect": {"cpf", "document_identifier"}},
        "email": {"text": "contato pessoa@example.com", "expect": {"email"}},
        "full_name": {"text": "nome: Pessoa Exemplo", "expect": {"full_name_context"}},
        "document": {"text": "RG 12.345.678-9", "expect": {"document_identifier"}},
        "link": {"text": "https://example.invalid/arquivo?token=segredo", "expect": {"sensitive_link"}},
    }
    passed: dict[str, bool] = {}
    for name, item in canaries.items():
        found = {hit["detector"] for hit in privacy_hits({"probe": item["text"]})}
        passed[name] = bool(found & item["expect"])
    negatives = [
        "2023-2025",
        "62212501c2f600f7e927fc66bb6521f905b9108b1cc98d6b8bc321952ec954fd",
        "episode_8f9ba7944b6d2705d62ff6ca",
        "PESSOA_A REF_A DOC_A RECEIPT_TESTE_A",
        "TEXTO_B V1",
    ]
    negative_hits = [privacy_hits({"probe": item}) for item in negatives]
    deceptive_path_canaries = {
        "phone_in_case_id_suffix": privacy_hits({"not_case_id_secret": "+55 11 98888-7777"}),
        "cpf_in_source_episode_suffix": privacy_hits({"source_episode_id_note": "CPF 123.456.789-00"}),
    }
    return {
        "canaries": passed,
        "all_canaries_pass": all(passed.values()),
        "negative_suite_hits": [len(hits) for hits in negative_hits],
        "negative_suite_pass": all(not hits for hits in negative_hits),
        "deceptive_path_canaries": {
            name: bool(hits) for name, hits in deceptive_path_canaries.items()
        },
        "deceptive_path_canaries_pass": all(deceptive_path_canaries.values()),
    }


def extract(value: Any, path: str) -> Any:
    node = value
    for part in path.split("."):
        if not part:
            continue
        if isinstance(node, dict):
            node = node.get(part)
        else:
            return None
    return node


def flattened_codes(value: Any) -> list[Any]:
    if isinstance(value, list):
        out: list[Any] = []
        for item in value:
            if isinstance(item, dict):
                out.extend(item.get(key) for key in ("claim_code", "tool", "track_id") if key in item)
            else:
                out.append(item)
        return out
    if isinstance(value, dict):
        return list(value)
    return [value]


def evaluate_assertion(trace: dict[str, Any], assertion: dict[str, Any]) -> tuple[bool, str]:
    """Phase 15 assertion semantics, intentionally unchanged."""
    check = assertion["machine_check"]
    actual = extract(trace, check["target_path"])
    operator = check["operator"]
    expected = check["expected"]
    values = flattened_codes(actual)
    if operator == "contains_all":
        ok = all(item in values for item in expected)
    elif operator == "contains_any":
        ok = any(item in values for item in expected)
    elif operator == "not_contains_any":
        ok = not any(
            item in values or (isinstance(actual, str) and str(item).casefold() in actual.casefold())
            for item in expected
        )
    elif operator == "equals":
        ok = actual == expected
    elif operator == "nonempty":
        ok = bool(actual) is bool(expected)
    elif operator == "subset":
        ok = set(values).issubset(set(expected))
    elif operator == "event_absent":
        ok = not any(
            isinstance(item, dict) and all(item.get(key) == value for key, value in expected.items())
            for item in (actual or [])
        )
    elif operator == "event_exists":
        ok = any(
            isinstance(item, dict) and all(item.get(key) == value for key, value in expected.items())
            for item in (actual or [])
        )
    elif operator == "exact_count":
        ok = len(actual or []) == expected
    elif operator == "claim_has_receipt":
        requirements = {item["claim_code"]: item["receipt_type"] for item in expected}
        ok = True
        for claim in actual or []:
            code = claim.get("claim_code") if isinstance(claim, dict) else None
            if code in requirements and requirements[code] not in claim.get("receipt_refs", []):
                ok = False
    elif operator == "closure_allowed":
        ok = bool(actual) == bool(expected)
    elif operator in {"event_before", "semantic_review"}:
        return False, "unsupported operator in deterministic validator"
    else:
        return False, f"unknown operator {operator}"
    return ok, f"operator={operator}"


def safe_actual(trace: dict[str, Any], path: str) -> Any:
    node = extract(trace, path)
    if path == "reply":
        return {"nonempty": bool(node), "length": len(node or "")}
    if isinstance(node, list):
        if node and isinstance(node[0], dict):
            return {
                "count": len(node),
                "codes": [
                    item.get("claim_code") or item.get("tool") or item.get("track_id")
                    for item in node
                ],
            }
        return node
    if isinstance(node, str) and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", node):
        return {"nonempty": bool(node), "length": len(node)}
    return node


def hard_failure(
    code: str,
    description: str,
    *,
    engine: str,
    replay: int,
    case_id: str = "_suite",
    dimension: str = "safety",
    severity: str = "P0",
    layer: str = "policy",
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "failure_id": code,
        "source": "hard_guard",
        "engine": engine,
        "replay": replay,
        "case_id": case_id,
        "assertion_id": code,
        "dimension": dimension,
        "status": "FAIL",
        "weight": 0,
        "critical": True,
        "severity_on_fail": severity,
        "likely_layer": layer,
        "description": description,
        "evidence": evidence or {"code": code},
    }


def assertion_failure(
    *,
    engine: str,
    replay: int,
    case_id: str,
    review_rank: int,
    assertion: dict[str, Any],
    trace: dict[str, Any],
    detail: str,
) -> dict[str, Any]:
    return {
        "failure_id": f"{case_id}:{assertion['assertion_id']}",
        "source": "fixture_assertion",
        "engine": engine,
        "replay": replay,
        "case_id": case_id,
        "review_rank": review_rank,
        "assertion_id": assertion["assertion_id"],
        "dimension": assertion["dimension"],
        "status": "FAIL",
        "weight": assertion["weight"],
        "critical": assertion["critical"],
        "severity_on_fail": assertion["severity"],
        "likely_layer": assertion["failure_layer"],
        "description": assertion["description"],
        "evidence": {
            "target_path": assertion["machine_check"]["target_path"],
            "observed": safe_actual(trace, assertion["machine_check"]["target_path"]),
            "check": detail,
        },
    }


def source_validation(
    *,
    fixtures_path: Path,
    fixture_summary_path: Path,
    fixture_schema_path: Path,
    trace_schema_path: Path,
    gate_path: Path,
    manifest_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any], dict[str, Any]]:
    manifest_result = verify_manifest(manifest_path)
    if manifest_result["status"] != "PASS":
        raise BenchmarkInputError("fixture source manifest verification failed")
    entries = manifest_result.pop("entries")
    named_paths = {
        "fixtures": fixtures_path,
        "fixture_summary": fixture_summary_path,
        "fixture_schema": fixture_schema_path,
        "trace_schema": trace_schema_path,
        "gate": gate_path,
    }
    source_hashes: dict[str, dict[str, str]] = {}
    for label, path in named_paths.items():
        relative, digest = manifest_entry_for(path, manifest_path, entries)
        source_hashes[label] = {"manifest_path": relative, "sha256": digest}

    fixtures = read_jsonl(fixtures_path)
    summary = read_json(fixture_summary_path)
    fixture_schema = read_json(fixture_schema_path)
    trace_schema = read_json(trace_schema_path)
    gate = read_json(gate_path)
    if not all(isinstance(item, dict) for item in (summary, fixture_schema, trace_schema, gate)):
        raise BenchmarkInputError("summary, schemas, and gate must be JSON objects")
    thresholds = gate.get("required_release_thresholds")
    if not isinstance(thresholds, dict) or set(thresholds) != REQUIRED_GATE_KEYS:
        raise BenchmarkInputError("Phase 15 gate threshold contract is missing, extended, or renamed")

    errors: list[dict[str, Any]] = []
    ranks: list[Any] = []
    case_ids: list[Any] = []
    case_hashes: list[Any] = []
    source_artifact_hash = summary.get("source_sha256")
    for fixture in fixtures:
        case_id = fixture.get("case_id", "_missing_case_id")
        ranks.append(fixture.get("review_rank"))
        case_ids.append(case_id)
        case_hashes.append(fixture.get("case_hash"))
        for message in validate_schema(fixture, fixture_schema, fixture_schema):
            errors.append({"case_id": case_id, "code": "fixture_schema", "detail": message})
        if fixture.get("case_hash") != canonical_case_hash(fixture):
            errors.append({"case_id": case_id, "code": "case_hash_mismatch"})
        if fixture.get("provenance", {}).get("source_artifact_sha256") != source_artifact_hash:
            errors.append({"case_id": case_id, "code": "source_artifact_hash_mismatch"})
        if fixture.get("governance", {}).get("production_promoted") is not False:
            errors.append({"case_id": case_id, "code": "fixture_promoted"})
        if fixture.get("governance", {}).get("implemented") is not False:
            errors.append({"case_id": case_id, "code": "fixture_implemented"})
        gap_values = set(fixture.get("input", {}).get("administrative_gaps", {}).values())
        if not gap_values.issubset(ALLOWED_GAP_VALUES):
            errors.append({"case_id": case_id, "code": "invalid_administrative_gap"})
        known_keys = {item.get("key") for item in fixture.get("input", {}).get("known_facts", [])}
        if not set(fixture.get("input", {}).get("do_not_ask_again", [])).issubset(known_keys):
            errors.append({"case_id": case_id, "code": "unknown_do_not_ask_fact"})
        turn_ids = {item.get("turn_id") for item in fixture.get("input", {}).get("messages", [])}
        if any(
            item.get("source_turn") not in turn_ids
            for item in fixture.get("input", {}).get("known_facts", [])
        ):
            errors.append({"case_id": case_id, "code": "known_fact_source_turn_missing"})
        track_ids = [item.get("track_id") for item in fixture.get("input", {}).get("track_states", [])]
        if len(track_ids) != len(set(track_ids)):
            errors.append({"case_id": case_id, "code": "duplicate_track_id"})
        assertions = (
            fixture.get("expected_behavior", {}).get("assertions", [])
            + fixture.get("forbidden_behavior", {}).get("assertions", [])
        )
        assertion_ids = [item.get("assertion_id") for item in assertions]
        if len(assertion_ids) != len(set(assertion_ids)):
            errors.append({"case_id": case_id, "code": "duplicate_assertion_id"})
        indexed_critical = set(fixture.get("scoring", {}).get("critical_failure_rules", []))
        actual_critical = {item.get("assertion_id") for item in assertions if item.get("critical")}
        if indexed_critical != actual_critical:
            errors.append({"case_id": case_id, "code": "critical_failure_index_mismatch"})
        weights = fixture.get("scoring", {}).get("weights", {})
        if not isinstance(weights, dict) or sum(weights.values()) != 100:
            errors.append({"case_id": case_id, "code": "dimension_weights_not_100"})
        if any(item.get("machine_check", {}).get("operator") == "semantic_review" for item in assertions):
            errors.append({"case_id": case_id, "code": "non_executable_assertion"})

    expected_ranks = summary.get("review_ranks")
    expected_count = summary.get("fixture_count")
    expected_ids = [f"gold_v2_rank_{int(rank):02d}" for rank in expected_ranks or []]
    set_checks = {
        "fixture_count": len(fixtures) == expected_count,
        "rank_sequence": ranks == expected_ranks,
        "case_set": case_ids == expected_ids,
        "case_ids_unique": len(case_ids) == len(set(case_ids)),
        "case_hashes_unique": len(case_hashes) == len(set(case_hashes)),
        "fixture_schema_version": all(
            fixture.get("schema_version") == summary.get("schema_version") for fixture in fixtures
        ),
    }
    for code, passed in set_checks.items():
        if not passed:
            errors.append({"case_id": "_suite", "code": code})
    if source_artifact_hash not in entries.values():
        errors.append({"case_id": "_suite", "code": "source_artifact_not_frozen_in_manifest"})
    fixture_privacy = [
        {"case_id": fixture.get("case_id", "_unknown"), **hit}
        for fixture in fixtures
        for hit in privacy_hits(fixture)
    ]
    privacy_canaries = run_privacy_canaries()
    validation = {
        "schema_version": "phase17-source-validation-v1.0.0",
        "status": "PASS" if (
            not errors
            and not fixture_privacy
            and privacy_canaries["all_canaries_pass"]
            and privacy_canaries["negative_suite_pass"]
            and privacy_canaries["deceptive_path_canaries_pass"]
        ) else "FAIL",
        "fixture_count": len(fixtures),
        "source_hashes": source_hashes,
        "manifest": manifest_result,
        "set_checks": set_checks,
        "source_errors": errors,
        "fixture_privacy_hits": fixture_privacy,
        "privacy_canaries": privacy_canaries,
    }
    return fixtures, trace_schema, gate, validation


def run_isolation_errors(run: dict[str, Any]) -> list[str]:
    """Require both isolation surfaces; one cannot mask a contradictory other."""
    environment = run.get("environment")
    runtime = run.get("runtime")
    errors: list[str] = []
    if not isinstance(environment, dict):
        errors.append("environment_evidence_missing")
    else:
        if environment.get("isolated") is not True:
            errors.append("isolated_not_true")
        if environment.get("network_access") is not False:
            errors.append("network_access_not_false")
        if environment.get("production_access") is not False:
            errors.append("production_access_not_false")
    if not isinstance(runtime, dict):
        errors.append("runtime_evidence_missing")
    else:
        if runtime.get("network_allowed") is not False:
            errors.append("network_allowed_not_false")
        if runtime.get("production_adapters_loaded") is not False:
            errors.append("production_adapters_loaded_not_false")
        if runtime.get("external_side_effects") is not False:
            errors.append("external_side_effects_not_false")
    return errors


CURRENT_IDEMPOTENCY_KEYS = {
    "duplicate_kind",
    "duplicate_reply_is_null",
    "revision_unchanged",
    "commits_unchanged",
    "outbox_unchanged",
}
V2_IDEMPOTENCY_KEYS = {
    "duplicate_detected",
    "revision_unchanged",
    "state_hash_unchanged",
    "audit_unchanged",
    "trace_unchanged",
}


def idempotency_passed(probe: Any, engine: str) -> bool:
    if not isinstance(probe, dict):
        return False
    expected = CURRENT_IDEMPOTENCY_KEYS if engine == "current_workflow" else V2_IDEMPOTENCY_KEYS
    if set(probe) != expected:
        return False
    if engine == "current_workflow":
        return probe["duplicate_kind"] == "DUPLICATE" and all(
            probe[key] is True for key in expected - {"duplicate_kind"}
        )
    return all(probe[key] is True for key in expected)


def numeric_metric(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def operational_metrics(runs: list[dict[str, Any]]) -> dict[str, Any]:
    collected: defaultdict[str, list[float]] = defaultdict(list)
    for run in runs:
        operational = run.get("operational", {})
        if not isinstance(operational, dict):
            continue
        for key in ("latency_ms", "retries"):
            metric = numeric_metric(operational.get(key))
            if metric is not None:
                collected[key].append(metric)
        resources = operational.get("resources", {})
        if isinstance(resources, dict):
            for key, value in sorted(resources.items()):
                metric = numeric_metric(value)
                if metric is not None:
                    collected[f"resources.{key}"].append(metric)
    summary: dict[str, Any] = {}
    for key, values in sorted(collected.items()):
        summary[key] = {
            "samples": len(values),
            "min": round(min(values), 4),
            "max": round(max(values), 4),
            "mean": round(statistics.fmean(values), 4),
            "median": round(statistics.median(values), 4),
        }
    return {
        "case_count": len(runs),
        "measured_case_count": sum(isinstance(run.get("operational"), dict) for run in runs),
        "metrics": summary,
        "status": "MEASURED" if summary else "NOT_MEASURED",
    }


def receipt_guard_errors(
    fixture: dict[str, Any],
    run: dict[str, Any],
    trace: dict[str, Any],
    *,
    engine: str,
    replay: int,
) -> list[dict[str, Any]]:
    case_id = fixture["case_id"]
    required = fixture.get("receipts", {}).get("required", [])
    requirement_by_claim = {item.get("claim_code"): item.get("receipt_type") for item in required}
    allowed_types = set(requirement_by_claim.values())
    allowed_claims = set(requirement_by_claim)
    used = set(trace.get("receipts_used", []))
    failures: list[dict[str, Any]] = []
    evidence = run.get("receipt_evidence")
    if not isinstance(evidence, list):
        return [hard_failure(
            "receipt_evidence_missing",
            "Engine row must carry a receipt evidence array even when it is empty.",
            engine=engine,
            replay=replay,
            case_id=case_id,
            dimension="receipts_actions",
            layer="tool_action",
        )]
    evidence_by_type: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    receipt_ids: list[str] = []
    for receipt in evidence:
        if not isinstance(receipt, dict):
            failures.append(hard_failure(
                "receipt_evidence_invalid",
                "Receipt evidence entry is not an object.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
            continue
        required_keys = {
            "receipt_id",
            "receipt_type",
            "tool",
            "idempotency_key",
            "issued_at",
            "payload_hash",
            "executor_reference_hash",
            "integrity_hash",
            "bound_claim_codes",
        }
        if set(receipt) != required_keys or not isinstance(receipt.get("bound_claim_codes"), list):
            failures.append(hard_failure(
                "receipt_evidence_invalid",
                "Receipt evidence does not match the closed verifiable contract.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
            continue
        unsigned = {key: receipt[key] for key in required_keys - {"integrity_hash"}}
        expected_integrity = hashlib.sha256(canonical_bytes(unsigned)).hexdigest()
        if receipt.get("integrity_hash") != expected_integrity:
            failures.append(hard_failure(
                "receipt_integrity_invalid",
                "Receipt integrity hash does not match its canonical payload.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
        receipt_type = receipt.get("receipt_type")
        if not isinstance(receipt_type, str) or receipt_type not in allowed_types:
            failures.append(hard_failure(
                "unknown_receipt_evidence",
                "Receipt evidence type is absent from the immutable fixture contract.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
        else:
            evidence_by_type[receipt_type].append(receipt)
        if isinstance(receipt.get("receipt_id"), str):
            receipt_ids.append(receipt["receipt_id"])
    if len(receipt_ids) != len(set(receipt_ids)):
        failures.append(hard_failure(
            "duplicate_receipt_evidence",
            "Receipt evidence identifiers must be unique per case.",
            engine=engine,
            replay=replay,
            case_id=case_id,
            dimension="receipts_actions",
            layer="tool_action",
        ))
    unknown_used = sorted(value for value in used if value not in allowed_types)
    if unknown_used:
        failures.append(hard_failure(
            "unknown_receipt",
            "Trace used a receipt type absent from the immutable fixture contract.",
            engine=engine,
            replay=replay,
            case_id=case_id,
            dimension="receipts_actions",
            layer="tool_action",
            evidence={"unknown_count": len(unknown_used)},
        ))
    missing_evidence = sorted(value for value in used if value not in evidence_by_type)
    if missing_evidence:
        failures.append(hard_failure(
            "receipt_used_without_evidence",
            "Trace names a receipt type without a verifiable receipt record.",
            engine=engine,
            replay=replay,
            case_id=case_id,
            dimension="receipts_actions",
            layer="tool_action",
            evidence={"missing_evidence_count": len(missing_evidence)},
        ))
    for claim in trace.get("claims", []):
        if not isinstance(claim, dict):
            continue
        code = claim.get("claim_code")
        refs = claim.get("receipt_refs", [])
        if code not in allowed_claims:
            failures.append(hard_failure(
                "unknown_claim",
                "Trace emitted a completion claim absent from the immutable fixture contract.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
                evidence={"claim_code": code if isinstance(code, str) else "invalid"},
            ))
        expected_type = requirement_by_claim.get(code)
        if expected_type is not None and expected_type not in refs:
            failures.append(hard_failure(
                "claim_missing_required_receipt_type",
                "Completion claim does not reference its required receipt type.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
        if not refs:
            failures.append(hard_failure(
                "claim_without_receipt",
                "Completion claim has no receipt reference.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
            continue
        unknown_refs = [value for value in refs if value not in allowed_types or value not in used]
        if unknown_refs:
            failures.append(hard_failure(
                "claim_receipt_unverifiable",
                "Completion claim references an unknown or unused receipt.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
                evidence={"unverifiable_count": len(unknown_refs)},
            ))
        if expected_type is not None and not any(
            code in receipt.get("bound_claim_codes", []) for receipt in evidence_by_type.get(expected_type, [])
        ):
            failures.append(hard_failure(
                "claim_receipt_not_bound",
                "No integrity-checked receipt evidence is bound to the completion claim.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))
    return failures


def score_engine_run(
    fixtures: list[dict[str, Any]],
    runs: list[dict[str, Any]],
    trace_schema: dict[str, Any],
    *,
    engine: str,
    replay: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    engine_run_schema = read_json(ENGINE_RUN_SCHEMA_PATH)
    if not isinstance(engine_run_schema, dict):
        raise BenchmarkInputError("engine-run schema must be a JSON object")
    fixture_by_id = {fixture["case_id"]: fixture for fixture in fixtures}
    failures: list[dict[str, Any]] = []
    rows_by_id: dict[str, dict[str, Any]] = {}
    for run in runs:
        case_id = run.get("case_id")
        if not isinstance(case_id, str) or case_id in rows_by_id:
            failures.append(hard_failure(
                "duplicate_or_invalid_run_case",
                "Engine run contains a duplicate or invalid case identifier.",
                engine=engine,
                replay=replay,
                case_id=case_id if isinstance(case_id, str) else "_suite",
                severity="P1",
                layer="motor",
            ))
            continue
        envelope_errors = validate_schema(run, engine_run_schema, engine_run_schema)
        if envelope_errors:
            failures.append(hard_failure(
                "engine_run_schema_invalid",
                "Engine row failed the closed engine-run schema.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
                evidence={"error_count": len(envelope_errors), "errors": envelope_errors},
            ))
        rows_by_id[case_id] = run
    execution_ids = {
        run.get("execution", {}).get("run_id")
        for run in rows_by_id.values()
        if isinstance(run.get("execution"), dict)
    }
    if len(execution_ids) != 1 or None in execution_ids:
        failures.append(hard_failure(
            "run_identity_invalid",
            "Every case in one engine file must share one non-empty run identity.",
            engine=engine,
            replay=replay,
            severity="P1",
            layer="motor",
        ))
    missing = sorted(set(fixture_by_id) - set(rows_by_id))
    extra = sorted(set(rows_by_id) - set(fixture_by_id))
    if missing or extra:
        failures.append(hard_failure(
            "run_case_set_mismatch",
            "Engine run case set differs from the immutable fixture set.",
            engine=engine,
            replay=replay,
            severity="P1",
            layer="motor",
            evidence={"missing_count": len(missing), "extra_count": len(extra)},
        ))

    case_rows: list[dict[str, Any]] = []
    for fixture in fixtures:
        case_id = fixture["case_id"]
        run = rows_by_id.get(case_id)
        if run is None:
            continue
        case_hard: list[dict[str, Any]] = []
        if run.get("status") != "COMPLETED":
            case_hard.append(hard_failure(
                "runtime_not_completed",
                "Engine did not complete the isolated case.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
            ))
        if run.get("case_hash") != fixture["case_hash"]:
            case_hard.append(hard_failure(
                "fixture_drift",
                "Engine case hash differs from the immutable fixture hash.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                layer="motor",
            ))
        execution = run.get("execution")
        if (
            not isinstance(execution, dict)
            or set(execution) != {"run_id", "replay", "engine_instance_scope"}
            or not isinstance(execution.get("run_id"), str)
            or len(execution["run_id"]) < 16
            or execution.get("replay") != replay
            or execution.get("engine_instance_scope") != "fresh_per_case"
        ):
            case_hard.append(hard_failure(
                "execution_identity_invalid",
                "Engine row lacks the closed run/replay/fresh-instance identity contract.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
            ))
        isolation_errors = run_isolation_errors(run)
        if isolation_errors:
            case_hard.append(hard_failure(
                "isolation_or_network_guard",
                "Run lacks proof of isolation or reports network/production access.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                layer="tool_action",
                evidence={"error_codes": sorted(isolation_errors)},
            ))
        network_calls = extract(run, "operational.network_calls")
        if network_calls not in (None, 0, [], {}):
            case_hard.append(hard_failure(
                "network_activity",
                "Isolated benchmark reported network activity.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                layer="tool_action",
            ))
        trace = run.get("trace")
        if not isinstance(trace, dict):
            case_hard.append(hard_failure(
                "trace_missing",
                "Completed engine row has no trace object.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
            ))
            failures.extend(case_hard)
            continue
        if trace.get("case_id") != case_id:
            case_hard.append(hard_failure(
                "trace_case_mismatch",
                "Trace case ID differs from its engine row.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
            ))
        trace_errors = validate_schema(trace, trace_schema, trace_schema)
        if trace_errors:
            case_hard.append(hard_failure(
                "trace_schema_invalid",
                "Trace failed the immutable benchmark-trace schema.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                severity="P1",
                layer="motor",
                evidence={"error_count": len(trace_errors), "errors": trace_errors},
            ))
        hits = privacy_hits(run)
        if hits:
            case_hard.append(hard_failure(
                "privacy_violation",
                "Run surface contains a privacy detector hit.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                layer="policy",
                evidence={"hit_count": len(hits), "hits": hits},
            ))
        side_effects = [call for call in trace.get("tool_calls", []) if call.get("side_effect") is True]
        unauthorized = [call for call in trace.get("tool_calls", []) if call.get("authorized") is not True]
        if side_effects or unauthorized:
            case_hard.append(hard_failure(
                "external_or_unauthorized_action",
                "Isolated trace contains an external side effect or unauthorized tool call.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
                evidence={
                    "side_effect_count": len(side_effects),
                    "unauthorized_count": len(unauthorized),
                },
            ))
        case_hard.extend(receipt_guard_errors(fixture, run, trace, engine=engine, replay=replay))
        if not idempotency_passed(run.get("idempotency_probe"), engine):
            case_hard.append(hard_failure(
                "runtime_idempotency",
                "Replay of the same inbound did not prove idempotent behavior.",
                engine=engine,
                replay=replay,
                case_id=case_id,
                dimension="receipts_actions",
                layer="tool_action",
            ))

        assertions = fixture["expected_behavior"]["assertions"] + fixture["forbidden_behavior"]["assertions"]
        by_dimension: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
        assertion_rows: list[dict[str, Any]] = []
        for assertion in assertions:
            passed, detail = evaluate_assertion(trace, assertion)
            row = {
                "assertion_id": assertion["assertion_id"],
                "dimension": assertion["dimension"],
                "status": "PASS" if passed else "FAIL",
                "weight": assertion["weight"],
                "critical": assertion["critical"],
                "severity_on_fail": assertion["severity"],
                "likely_layer": assertion["failure_layer"],
                "description": assertion["description"],
                "evidence": {
                    "target_path": assertion["machine_check"]["target_path"],
                    "observed": safe_actual(trace, assertion["machine_check"]["target_path"]),
                    "check": detail,
                },
            }
            assertion_rows.append(row)
            by_dimension[assertion["dimension"]].append(row)
            if not passed:
                failures.append(assertion_failure(
                    engine=engine,
                    replay=replay,
                    case_id=case_id,
                    review_rank=fixture["review_rank"],
                    assertion=assertion,
                    trace=trace,
                    detail=detail,
                ))

        dimension_scores: dict[str, Any] = {}
        for dimension in DIMENSIONS:
            items = by_dimension[dimension]
            if not items:
                dimension_scores[dimension] = {
                    "score": None,
                    "status": "N/A",
                    "passed": 0,
                    "failed": 0,
                    "assertions": 0,
                }
                continue
            total = sum(item["weight"] for item in items)
            passed_weight = sum(item["weight"] for item in items if item["status"] == "PASS")
            score = round(100 * passed_weight / total, 2)
            dimension_scores[dimension] = {
                "score": score,
                "status": "PASS" if score == 100 else "FAIL",
                "passed": sum(item["status"] == "PASS" for item in items),
                "failed": sum(item["status"] == "FAIL" for item in items),
                "assertions": len(items),
            }
        applicable = [
            (dimension, dimension_scores[dimension]["score"])
            for dimension in DIMENSIONS
            if dimension_scores[dimension]["score"] is not None
        ]
        weights = fixture["scoring"]["weights"]
        denominator = sum(weights[dimension] for dimension, _ in applicable)
        aggregate = round(
            sum(score * weights[dimension] for dimension, score in applicable) / denominator,
            2,
        ) if denominator else None
        failures.extend(case_hard)
        all_case_failures = [
            failure for failure in failures
            if failure["case_id"] == case_id and failure["engine"] == engine and failure["replay"] == replay
        ]
        highest = min(
            (item["severity_on_fail"] for item in all_case_failures),
            key=lambda value: SEVERITY_ORDER[value],
            default=None,
        )
        case_rows.append({
            "case_id": case_id,
            "review_rank": fixture["review_rank"],
            "case_hash": fixture["case_hash"],
            "runtime_status": run.get("status"),
            "dimension_scores": dimension_scores,
            "secondary_weighted_aggregate": aggregate,
            "critical_failure": any(item["critical"] for item in all_case_failures),
            "highest_failure_severity": highest,
            "assertions_passed": sum(item["status"] == "PASS" for item in assertion_rows),
            "assertions_failed": sum(item["status"] == "FAIL" for item in assertion_rows),
            "hard_failures": len(case_hard),
            "idempotency_pass": idempotency_passed(run.get("idempotency_probe"), engine),
            "trace_sha256": hashlib.sha256(canonical_bytes(trace)).hexdigest(),
            "assertions": assertion_rows,
        })

    suite_dimensions: dict[str, Any] = {}
    for dimension in DIMENSIONS:
        values = [
            case["dimension_scores"][dimension]["score"]
            for case in case_rows
            if case["dimension_scores"][dimension]["score"] is not None
        ]
        suite_dimensions[dimension] = {
            "macro_average": round(statistics.fmean(values), 2) if values else None,
            "cases": len(values),
            "cases_at_100": sum(value == 100 for value in values),
            "cases_below_100": sum(value < 100 for value in values),
        }
    severity_counts = Counter(item["severity_on_fail"] for item in failures)
    layer_counts = Counter(item["likely_layer"] for item in failures)
    hard_count = sum(item["source"] == "hard_guard" for item in failures)
    report = {
        "schema_version": "phase17-engine-score-v1.0.0",
        "engine": engine,
        "replay": replay,
        "status": "VALID_WITH_SYSTEM_FAILURES" if not hard_count else "INVALID_HARD_GUARD",
        "fixture_count": len(fixtures),
        "completed_cases": len(case_rows),
        "dimension_scores": suite_dimensions,
        "secondary_suite_aggregate": round(
            statistics.fmean(
                case["secondary_weighted_aggregate"]
                for case in case_rows
                if case["secondary_weighted_aggregate"] is not None
            ),
            2,
        ) if case_rows else None,
        "failure_counts_by_severity": {
            severity: severity_counts.get(severity, 0) for severity in SEVERITY_ORDER
        },
        "failure_counts_by_likely_layer": dict(sorted(layer_counts.items())),
        "cases_with_critical_failure": sum(case["critical_failure"] for case in case_rows),
        "idempotency_passed": sum(case["idempotency_pass"] for case in case_rows),
        "hard_failure_count": hard_count,
        "operational_metrics": operational_metrics(runs),
        "cases": case_rows,
    }
    return report, failures


def replay_independence_failures(
    paths: list[Path],
    batches: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    errors: list[str] = []
    if len({str(path.resolve()) for path in paths}) != len(paths):
        errors.append("duplicate_replay_path")
    if any(not path.is_file() or path.is_symlink() for path in paths):
        errors.append("replay_not_regular_file")
    else:
        hashes = [sha256_file(path) for path in paths]
        if len(set(hashes)) != len(hashes):
            errors.append("duplicate_replay_file_hash")
    run_ids: list[str] = []
    for expected_replay, rows in enumerate(batches, 1):
        ids = {
            row.get("execution", {}).get("run_id")
            for row in rows
            if isinstance(row.get("execution"), dict)
        }
        replay_numbers = {
            row.get("execution", {}).get("replay")
            for row in rows
            if isinstance(row.get("execution"), dict)
        }
        if len(ids) != 1 or None in ids:
            errors.append(f"invalid_run_id_replay_{expected_replay}")
        else:
            run_ids.append(next(iter(ids)))
        if replay_numbers != {expected_replay}:
            errors.append(f"invalid_replay_number_{expected_replay}")
    if len(run_ids) != len(paths) or len(set(run_ids)) != len(paths):
        errors.append("duplicate_replay_run_id")
    if not errors:
        return []
    return [hard_failure(
        "replay_sources_not_independent",
        "Three replays must be distinct regular files with unique hashes, run identities and ordered replay numbers.",
        engine="motor_v2",
        replay=0,
        severity="P0",
        layer="motor",
        evidence={"error_codes": sorted(set(errors))},
    )]


def paired_comparison(
    current: dict[str, Any],
    v2: dict[str, Any],
    gate: dict[str, Any],
) -> dict[str, Any]:
    thresholds = gate["required_release_thresholds"]
    max_case = thresholds["regression_max_points_per_case"]
    max_dimension = thresholds["regression_max_points_per_dimension"]
    current_cases = {item["case_id"]: item for item in current["cases"]}
    v2_cases = {item["case_id"]: item for item in v2["cases"]}
    case_rows: list[dict[str, Any]] = []
    case_regressions: list[dict[str, Any]] = []
    for case_id in sorted(set(current_cases) & set(v2_cases)):
        before = current_cases[case_id]["secondary_weighted_aggregate"]
        after = v2_cases[case_id]["secondary_weighted_aggregate"]
        delta = round(after - before, 2) if before is not None and after is not None else None
        regressed = delta is not None and delta < -max_case
        row = {"case_id": case_id, "current": before, "v2": after, "delta": delta, "regression": regressed}
        case_rows.append(row)
        if regressed:
            case_regressions.append(row)
    dimensions: dict[str, Any] = {}
    dimension_regressions: list[str] = []
    for dimension in DIMENSIONS:
        before = current["dimension_scores"][dimension]["macro_average"]
        after = v2["dimension_scores"][dimension]["macro_average"]
        delta = round(after - before, 2) if before is not None and after is not None else None
        regressed = delta is not None and delta < -max_dimension
        dimensions[dimension] = {
            "current": before,
            "v2": after,
            "delta": delta,
            "regression": regressed,
        }
        if regressed:
            dimension_regressions.append(dimension)
    return {
        "schema_version": "phase17-paired-comparison-v1.0.0",
        "status": "PASS" if not case_regressions and not dimension_regressions else "FAIL",
        "limits": {
            "max_points_per_case": max_case,
            "max_points_per_dimension": max_dimension,
        },
        "dimensions": dimensions,
        "cases": case_rows,
        "case_regressions": case_regressions,
        "dimension_regressions": dimension_regressions,
    }


def replay_analysis(reports: list[dict[str, Any]], gate: dict[str, Any]) -> dict[str, Any]:
    threshold = gate["required_release_thresholds"]["three_replays_dimension_variation_max_points"]

    def critical_vector(report: dict[str, Any]) -> list[list[Any]]:
        vector: list[list[Any]] = []
        for case in report["cases"]:
            for assertion in case["assertions"]:
                if assertion["critical"]:
                    vector.append([case["case_id"], assertion["assertion_id"], assertion["status"]])
            vector.append([case["case_id"], "runtime_idempotency", case["idempotency_pass"]])
        return sorted(vector)

    vectors = [critical_vector(report) for report in reports]
    critical_identical = all(vector == vectors[0] for vector in vectors[1:]) if vectors else False
    dimensions: dict[str, Any] = {}
    variation_pass = True
    for dimension in DIMENSIONS:
        values = [report["dimension_scores"][dimension]["macro_average"] for report in reports]
        numeric = [value for value in values if value is not None]
        variation = round(max(numeric) - min(numeric), 2) if len(numeric) == len(values) and numeric else None
        passed = variation is not None and variation <= threshold
        variation_pass = variation_pass and passed
        dimensions[dimension] = {"values": values, "variation": variation, "pass": passed}
    exact_case_vectors = []
    for report in reports:
        exact_case_vectors.append([
            [case["case_id"], case["dimension_scores"], case["secondary_weighted_aggregate"]]
            for case in report["cases"]
        ])
    exact_scores_identical = all(vector == exact_case_vectors[0] for vector in exact_case_vectors[1:]) if exact_case_vectors else False
    trace_vectors = [
        [[case["case_id"], case["trace_sha256"]] for case in report["cases"]]
        for report in reports
    ]
    exact_traces_identical = all(vector == trace_vectors[0] for vector in trace_vectors[1:]) if trace_vectors else False
    return {
        "schema_version": "phase17-reproducibility-v1.0.0",
        "status": "PASS" if len(reports) >= 3 and critical_identical and variation_pass else "FAIL",
        "replay_count": len(reports),
        "critical_vector_identical": critical_identical,
        "exact_scores_identical": exact_scores_identical,
        "exact_traces_identical": exact_traces_identical,
        "dimension_variation_limit": threshold,
        "dimensions": dimensions,
    }


def gate_verdict(
    *,
    source: dict[str, Any],
    current: dict[str, Any],
    v2_reports: list[dict[str, Any]],
    paired: dict[str, Any],
    reproducibility: dict[str, Any],
    gate: dict[str, Any],
    all_failures: list[dict[str, Any]],
) -> dict[str, Any]:
    thresholds = gate["required_release_thresholds"]
    checks: dict[str, dict[str, Any]] = {}
    checks["source_validation"] = {"pass": source["status"] == "PASS", "actual": source["status"], "required": "PASS"}
    checks["current_complete"] = {
        "pass": current["completed_cases"] == current["fixture_count"],
        "actual": current["completed_cases"],
        "required": current["fixture_count"],
    }
    checks["three_v2_replays"] = {"pass": len(v2_reports) >= 3, "actual": len(v2_reports), "required": 3}
    hard_failures = [failure for failure in all_failures if failure["source"] == "hard_guard"]
    checks["hard_guards"] = {"pass": not hard_failures, "actual": len(hard_failures), "required": 0}
    for severity in ("P0", "P1"):
        per_replay = [report["failure_counts_by_severity"][severity] for report in v2_reports]
        limit = thresholds[f"{severity}_failures"]
        actual = max(per_replay, default=0)
        checks[f"{severity}_failures"] = {"pass": actual <= limit, "actual": actual, "required_max": limit}

    dimension_threshold_keys = {
        "comprehension": "comprehension_min",
        "context": "context_min",
        "multi_intent": "multi_intent_min",
        "handoff": "handoff_min",
        "safety": "safety",
        "efficiency": "efficiency_min",
        "receipts_actions": "receipts_actions",
        "correct_closure": "correct_closure",
    }
    for dimension, threshold_key in dimension_threshold_keys.items():
        values = [report["dimension_scores"][dimension]["macro_average"] for report in v2_reports]
        actual = min((value for value in values if value is not None), default=None)
        required = thresholds[threshold_key]
        checks[f"dimension_{dimension}"] = {
            "pass": actual is not None and actual >= required,
            "actual_worst_replay": actual,
            "required_min": required,
        }
    checks["paired_regression"] = {"pass": paired["status"] == "PASS", "actual": paired["status"], "required": "PASS"}
    checks["critical_vector_stability"] = {
        "pass": reproducibility["critical_vector_identical"] is thresholds["three_replays_critical_vector_identical"],
        "actual": reproducibility["critical_vector_identical"],
        "required": thresholds["three_replays_critical_vector_identical"],
    }
    checks["dimension_variation"] = {
        "pass": all(item["pass"] for item in reproducibility["dimensions"].values()),
        "actual_max": max(
            (item["variation"] for item in reproducibility["dimensions"].values() if item["variation"] is not None),
            default=None,
        ),
        "required_max": thresholds["three_replays_dimension_variation_max_points"],
    }
    passed = all(item["pass"] for item in checks.values())
    return {
        "schema_version": "phase17-gate-verdict-v1.0.0",
        "verdict": "GATE_HUMANO_1_APTO_PARA_SHADOW_MODE" if passed else "GATE_HUMANO_1_NAO_APTO",
        "pass": passed,
        "threshold_source": "phase15/governance/future_motor_v2_gate.json",
        "thresholds": thresholds,
        "checks": checks,
        "blocking_checks": sorted(key for key, item in checks.items() if not item["pass"]),
        "scope_note": "This benchmark gate does not authorize shadow mode, production, or Phase 18.",
    }


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    path.chmod(0o600)


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    path.chmod(0o600)


def render_markdown(
    current: dict[str, Any],
    v2: dict[str, Any],
    paired: dict[str, Any],
    reproducibility: dict[str, Any],
    gate: dict[str, Any],
) -> str:
    lines = [
        "# Phase 17 isolated benchmark",
        "",
        f"**Verdict:** `{gate['verdict']}`",
        "",
        "No production adapter, network access, or external side effect is permitted by this report.",
        "",
        "## Dimension scores",
        "",
        "| Dimension | Current | Motor V2 | Delta |",
        "|---|---:|---:|---:|",
    ]
    for dimension in DIMENSIONS:
        row = paired["dimensions"][dimension]
        lines.append(f"| {dimension} | {row['current']} | {row['v2']} | {row['delta']} |")
    lines.extend([
        "",
        "## Failures",
        "",
        f"- Current P0/P1: {current['failure_counts_by_severity']['P0']}/{current['failure_counts_by_severity']['P1']}",
        f"- Motor V2 P0/P1: {v2['failure_counts_by_severity']['P0']}/{v2['failure_counts_by_severity']['P1']}",
        f"- Paired regression: `{paired['status']}`",
        f"- Three-replay reproducibility: `{reproducibility['status']}`",
        "",
        "## Blocking checks",
        "",
    ])
    blockers = gate["blocking_checks"]
    lines.extend(f"- `{blocker}`" for blocker in blockers)
    if not blockers:
        lines.append("- None inside this benchmark contract.")
    lines.extend([
        "",
        "This result is evidence for a human gate only. It does not promote rules, fixtures, or code.",
    ])
    return "\n".join(lines) + "\n"


def write_manifest(output_dir: Path) -> Path:
    path = output_dir / "MANIFEST.sha256"
    files = sorted(item for item in output_dir.iterdir() if item.is_file() and item.name != path.name)
    path.write_text("".join(f"{sha256_file(item)}  {item.name}\n" for item in files), encoding="utf-8")
    path.chmod(0o600)
    return path


def prepare_output_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)
    fixed_names = {
        "MANIFEST.sha256",
        "REPORT.md",
        "current_workflow_report.json",
        "failure_matrix.jsonl",
        "gate_verdict.json",
        "paired_comparison.json",
        "reproducibility_report.json",
        "source_validation.json",
    }
    for item in output_dir.iterdir():
        owned = item.name in fixed_names or re.fullmatch(r"motor_v2_replay_\d{2}_report\.json", item.name)
        if not owned or not item.is_file() or item.is_symlink():
            raise BenchmarkInputError(f"output directory contains unowned entry: {item.name}")
    for item in output_dir.iterdir():
        item.unlink()


def run_benchmark(
    *,
    fixtures_path: Path,
    fixture_summary_path: Path,
    fixture_schema_path: Path,
    trace_schema_path: Path,
    manifest_path: Path,
    gate_path: Path,
    current_run_path: Path,
    v2_run_paths: list[Path],
    output_dir: Path,
) -> dict[str, Any]:
    if len(v2_run_paths) < 3:
        raise BenchmarkInputError("at least three Motor V2 replay files are required")
    fixtures, trace_schema, gate, source = source_validation(
        fixtures_path=fixtures_path,
        fixture_summary_path=fixture_summary_path,
        fixture_schema_path=fixture_schema_path,
        trace_schema_path=trace_schema_path,
        gate_path=gate_path,
        manifest_path=manifest_path,
    )
    prepare_output_dir(output_dir)
    if source["status"] != "PASS":
        write_json(output_dir / "source_validation.json", source)
        write_manifest(output_dir)
        raise BenchmarkInputError("immutable fixture validation failed")

    current_runs = read_jsonl(current_run_path)
    current_report, current_failures = score_engine_run(
        fixtures,
        current_runs,
        trace_schema,
        engine="current_workflow",
        replay=1,
    )
    v2_batches = [read_jsonl(path) for path in v2_run_paths]
    replay_source_failures = replay_independence_failures(v2_run_paths, v2_batches)
    v2_reports: list[dict[str, Any]] = []
    all_failures = [*current_failures, *replay_source_failures]
    for index, runs in enumerate(v2_batches, 1):
        report, failures = score_engine_run(
            fixtures,
            runs,
            trace_schema,
            engine="motor_v2",
            replay=index,
        )
        v2_reports.append(report)
        all_failures.extend(failures)
    paired = paired_comparison(current_report, v2_reports[0], gate)
    reproducibility = replay_analysis(v2_reports, gate)
    verdict = gate_verdict(
        source=source,
        current=current_report,
        v2_reports=v2_reports,
        paired=paired,
        reproducibility=reproducibility,
        gate=gate,
        all_failures=all_failures,
    )

    write_json(output_dir / "source_validation.json", source)
    write_json(output_dir / "current_workflow_report.json", current_report)
    for index, report in enumerate(v2_reports, 1):
        write_json(output_dir / f"motor_v2_replay_{index:02d}_report.json", report)
    write_json(output_dir / "paired_comparison.json", paired)
    write_json(output_dir / "reproducibility_report.json", reproducibility)
    write_json(output_dir / "gate_verdict.json", verdict)
    write_jsonl(
        output_dir / "failure_matrix.jsonl",
        sorted(
            all_failures,
            key=lambda item: (
                SEVERITY_ORDER[item["severity_on_fail"]],
                item["engine"],
                item["replay"],
                item["case_id"],
                item["failure_id"],
            ),
        ),
    )
    report_path = output_dir / "REPORT.md"
    report_path.write_text(render_markdown(current_report, v2_reports[0], paired, reproducibility, verdict), encoding="utf-8")
    report_path.chmod(0o600)
    write_manifest(output_dir)
    return {
        "verdict": verdict["verdict"],
        "output_dir": str(output_dir),
        "fixture_count": len(fixtures),
        "v2_replays": len(v2_reports),
        "failure_count": len(all_failures),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--fixture-summary", type=Path, required=True)
    parser.add_argument("--fixture-schema", type=Path, required=True)
    parser.add_argument("--trace-schema", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--gate", type=Path, required=True)
    parser.add_argument("--current-run", type=Path, required=True)
    parser.add_argument("--v2-run", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_benchmark(
            fixtures_path=args.fixtures,
            fixture_summary_path=args.fixture_summary,
            fixture_schema_path=args.fixture_schema,
            trace_schema_path=args.trace_schema,
            manifest_path=args.manifest,
            gate_path=args.gate,
            current_run_path=args.current_run,
            v2_run_paths=args.v2_run,
            output_dir=args.output_dir,
        )
    except BenchmarkInputError as exc:
        print(json.dumps({"status": "INVALID_INPUT", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
