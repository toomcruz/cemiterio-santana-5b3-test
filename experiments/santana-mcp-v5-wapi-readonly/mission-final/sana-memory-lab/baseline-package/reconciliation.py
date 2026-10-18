"""Pure, read-only adapter for Boss task result reconciliation (LAB candidate).

Does not call OpenBot or resend anything. An OpenBot status=succeeded is not
proof that a response was persisted or delivered to the bridge.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Mapping, Any

@dataclass(frozen=True)
class ResultAssessment:
    state: str
    run_id: str | None
    result_available: bool
    reason: str


def assess_boss_result(task: Mapping[str,Any], run: Mapping[str,Any] | None) -> ResultAssessment:
    """Safely interpret both the bridge task row and its OpenBot run metadata.

    For real systems use one stable task_id/run_id association, and request the
    result by that run_id. All outputs are metadata only; do not include text.
    """
    run_id = task.get("run_id")
    if not isinstance(run_id,str) or not run_id:
        return ResultAssessment("QUEUED",None,False,"no associated run; do not synthesize an ID")
    if not isinstance(run,Mapping):
        return ResultAssessment("UNKNOWN",run_id,False,"result status not accessible; no automatic replay")
    reported_id = run.get("run_id")
    if reported_id != run_id:
        return ResultAssessment("CONFLICT",run_id,False,"run identity mismatch; no automatic replay")
    state = run.get("status")
    available = run.get("result_available") is True
    if state == "succeeded":
        if available and run.get("result") is not None:
            return ResultAssessment("RESULT_AVAILABLE",run_id,True,"terminal response correlated")
        return ResultAssessment("RESULT_MISSING",run_id,False,"run completed but bridge lacks terminal response")
    if state in ("failed","interrupted","cancelled"):
        return ResultAssessment("TERMINAL_FAILURE",run_id,False,"terminal failure; no automatic resend")
    if state in ("running","queued","starting"):
        return ResultAssessment("IN_PROGRESS",run_id,False,"wait or check without re-submission")
    return ResultAssessment("UNKNOWN",run_id,False,"unrecognized status; do not infer success")
