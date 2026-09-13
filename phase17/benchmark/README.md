# Phase 17 benchmark framework

Scores the immutable Phase 15 Gold V2 fixtures against one complete current- workflow run and at least three Motor V2
replays. It performs no network calls, does not execute either engine, and never changes the fixture set.

```sh
python3 phase17/benchmark/benchmark.py \
  --fixtures /path/to/fixtures.jsonl \
  --fixture-summary /path/to/FIXTURE_SET_SUMMARY.json \
  --fixture-schema /path/to/gold-fixture-v2.schema.json \
  --trace-schema /path/to/benchmark-trace-v1.schema.json \
  --manifest /path/to/MANIFEST.sha256 \
  --gate /path/to/future_motor_v2_gate.json \
  --current-run /path/to/current.jsonl \
  --v2-run /path/to/v2-replay-1.jsonl \
  --v2-run /path/to/v2-replay-2.jsonl \
  --v2-run /path/to/v2-replay-3.jsonl \
  --output-dir /private/output
```

Each run row follows `schemas/engine-run-v1.schema.json`. The scorer accepts the legacy Phase 15 `runtime` isolation
evidence or the explicit `environment` object. A run with fixture drift, privacy hits, network/production access,
unknown receipts, claims without verifiable receipts, external side effects, or failed idempotency is a hard gate
failure.

The JSON, JSONL, Markdown, and SHA-256 manifest outputs are deterministic for identical inputs. Scores remain separated
by dimension; the aggregate is marked secondary and is never used to hide a dimension failure.
