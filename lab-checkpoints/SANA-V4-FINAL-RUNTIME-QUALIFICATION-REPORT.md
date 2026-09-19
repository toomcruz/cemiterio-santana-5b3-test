# SANA V4 FINAL RUNTIME QUALIFICATION — BLOCKED

## Scope

- Human-approved runtime commit: `e3beef9e0acbef5b67cf2873310520c3c679ad34`
- Branch: `sana-conversational-refinement-v4`
- LAB project: `SANTANA-VNEXT-LAB` (`vpinclyspbcrxazmnrie`)
- Qualification run: `v4q-1789833744982-c599a46a`
- Interpreter: deterministic; Gemini was not called
- Delivery: synthetic LAB claims/completions only
- Production changes: none
- WhatsApp messages: 0

## Result

- LAB assertions: **88 passed / 1 failed**
- Official suite: **447 passed / 0 failed / 1 ignored**
- Extended Sana/domain suite: **560 passed / 0 failed**
- Typecheck: PASS
- Synthetic residue after cleanup: **0**

The qualification cannot pass because the mandatory lifecycle path is not fully proven.

## Passing E2E evidence

The real LAB RPC/store boundary persisted and audited:

- 33 conversational turns plus replay/concurrency/failure probes
- 35 inbound receipts
- 34 turn events
- 31 outbox rows before cleanup: 30 synthetically completed and 1 intentionally left pending for audit
- 15 synthetic conversations audited before cleanup
- Topic switch, FOCUS_CASE, PAUSE/return, documents, privacy, localization, protocol and no-request passed
- HUMAN_REQUEST changed the conversation to human ownership; the next two inbounds produced no reply and no new outbox
- Duplicate inbound, retry, concurrent duplicate, outbox double-claim and double-completion were idempotent
- Simulated delivery lease expiry recovered the same outbox row instead of creating a second row
- Interpretation failure persisted one `INTERPRETATION_UNAVAILABLE` marker and a real receipt, with no reply/outbox
- A failure after the first binding insert in `support_runtime_commit_turn` rolled back state, event, outbox and bindings; the acquired receipt remained `RECEIVED`

## Blocking failure 1 — CLOSE / RESUME_CASE

**Scenario:** `J_CLOSE`

1. A jazigo case was opened.
2. `Pode encerrar por enquanto.` persisted a `SOCIAL` event with note `CLOSE` and a closing reply.
3. `Ainda estou aqui.` was accepted as a normal automatic turn, generated a new reply/outbox and replaced the most recent lifecycle marker.
4. `Voltei para continuar o atendimento do jazigo.` became `RECLASSIFICATION`, not `RESUME_CASE`.

**Layer:** lifecycle interpretation/reducer boundary.

**Cause:** resume detection consults only the last event note. A non-resume inbound after `CLOSE` is allowed to continue automatically, so the close marker is no longer the last event when the explicit return arrives.

**Impact:** a closed conversation can resume automation without the official resume transition, violating the mandatory lifecycle rule.

**Minimum correction proposed:** persist or derive an explicit closed/paused session gate and suppress ordinary post-close inbounds until a validated return creates `RESUME_CASE`; add a real E2E regression proving no outbox before that transition. No correction was applied during qualification.

## Blocking failure 2 — authorized post-handoff resume unavailable in LAB

The live LAB exposes:

- `support_runtime_acquire_inbound`
- `support_runtime_commit_turn`
- `support_runtime_claim_delivery`
- `support_runtime_complete_delivery`
- `support_runtime_fail_delivery`

It does not expose:

- `support_runtime_commit_operator`
- `support_runtime_operator_snapshot`
- `support_runtime_operator_replay`
- `set_support_automation_mode`

**Layer:** LAB persistence/operator lifecycle surface.

**Impact:** HUMAN_REQUEST and suppression are proven, but the required authorized resume after takeover cannot be executed or evidenced through the live LAB boundary.

**Minimum correction proposed:** install the controlled LAB-compatible operator resume surface and its operator authorization prerequisites, then rerun the handoff/resume E2E. No migration was installed during qualification.

## Additional diagnostic

The optional local PGlite operator-bridge runner did not execute because `@electric-sql/pglite` is not installed in this worktree. It was not installed or retried because the live LAB surface is the required qualification boundary and is already the blocker.

## Artifacts

- `lab-checkpoints/SANA-V4-FINAL-RUNTIME-QUALIFICATION.json`
- `lab-checkpoints/SANA-V4-FINAL-RUNTIME-QUALIFICATION-CLEANUP.json`

No promotion, publication, Edge deployment, canary, W-API action or real delivery was performed.
