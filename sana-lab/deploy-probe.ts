/** Runs inside the private bridge container. Never prints the bearer token or request. */
const commit = Deno.args[0] ?? "";
if (!/^[0-9a-f]{40}$/.test(commit)) throw Error("INVALID_PROBE_COMMIT");
const endpoint = "http://127.0.0.1:8765/lab/v1/turn";
const unauthorized = await fetch(endpoint, { method: "POST" });
if (unauthorized.status !== 401) throw Error("LAB_PROBE_AUTH_REQUIRED");
const token = Deno.readTextFileSync("/run/secrets/sana_lab_token").trim();
const caseId = `deploy-probe-${commit}`;
const eventId = `deploy-probe-event-${commit}`;
const request = {
  contract_version: "sana-lab-bridge/1", event_id: eventId, case_id: caseId,
  conversation_id: `deploy-conversation-${commit}`, episode_id: `deploy-episode-${commit}`,
  correlation_id: `deploy-correlation-${commit}`, message: "Como funciona a exumação?",
  layer1_result: { familia: "EXUMACAO", objetivo: "INFORMACAO", tipo_turno: "DEMANDA" },
};
const reply = await fetch(endpoint, {
  method: "POST", headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(request),
});
if (reply.status !== 200) {
  const failure = await reply.json().catch(() => null);
  const reason = failure?.error === "LAB_STARTUP_FAILED" && /^[A-Z][A-Z0-9_]{2,64}$/.test(failure.code)
    ? `_STARTUP_${failure.code}` : "";
  throw Error(`LAB_PROBE_HTTP_${reply.status}${reason}`);
}
const body = await reply.json();
if (body.contract_version !== "sana-lab-bridge/1" || body.case_id !== caseId ||
    body.module !== "EXUMACAO" || body.evidence?.engine_called !== true ||
    body.evidence?.canonical_engine_path !== "sana-lab/engine.ts" ||
    body.state?.schema_version !== "sana-lab/1" || body.state?.case_id !== caseId ||
    !Number.isSafeInteger(body.new_revision) || !Array.isArray(body.operations) || body.operations.length ||
    typeof body.duplicate !== "boolean") throw Error("LAB_PROBE_INVALID_CONTRACT");
console.log(`LAB_PROBE_OK HTTP=200 CONTRACT=sana-lab-bridge/1 MODULE=EXUMACAO ENGINE_CALLED=YES CASE=${caseId} DUPLICATE=${body.duplicate}`);
