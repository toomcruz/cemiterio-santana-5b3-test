/** Run with Node and an externally installed PGlite; never connects to network.
 * PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node tests/postgres/run_operator_bridge.mjs
 * Fixtures are synthetic and the database exists only in memory.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import process from "node:process";
process.on("uncaughtException", (error) => {
  console.error(
    JSON.stringify({
      error: error.message,
      code: error.code,
      detail: error.detail,
      position: error.position,
      where: error.where,
      stack: error.stack?.split("\n").slice(0, 4),
    }),
  );
  process.exit(1);
});
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname, "../..");
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema extensions;
  create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
  create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;`);
const load = async (path) => db.exec(await readFile(resolve(root, path), "utf8"));
await load("database/lab/0001_panel_projection_fixture.sql");
await load("tests/postgres/fixtures/operator_bridge_fixture.sql");
for (
  const path of [
    "0022_5b4d_official_runtime.sql",
    "0023_5b4e_runtime_attachments.sql",
    "0024_5b4f_runtime_recovery.sql",
    "0025_5b50_attachment_retry.sql",
    "0026_5b51_runtime_catalog_upgrade.sql",
    "20260909193802_official_operations_bridge.sql",
  ]
) {
  await load(`database/migrations/${path}`);
}
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uuid(1),
  denied = uuid(2),
  other = uuid(3),
  conv = uuid(10),
  conv2 = uuid(11),
  document = uuid(20),
  foreignDocument = uuid(21);
const hash = "a".repeat(64), stateHash = "b".repeat(64), goal = "goal-test";
await db.query(
  `insert into public.support_members(user_id,display_name) values($1,'Operador sintético'),($2,'Sem permissão'),($3,'Outro operador')`,
  [actor, denied, other],
);
await db.query(`update public.support_members set permissions='{}' where user_id=$1`, [denied]);
await db.query(
  `insert into public.support_conversations(id,contact_name,phone_e164) values($1,'Teste local','+5511000000010'),($2,'Outro local','+5511000000011')`,
  [conv, conv2],
);
const request = {
  solicitacao_id: uuid(30),
  goal_id: goal,
  topic_code: "EXUMACAO",
  summary: "Solicitação sintética local",
  estado: "ABERTA",
};
const state = {
  conversation_id: conv,
  goals: [{ goal_id: goal, goal_code: "GOAL_EXUMACAO", status: "WAITING" }],
  solicitacoes: [request],
  pending_question: null,
  handoff: null,
};
const projection = {
  subject: "exumacao",
  stage: "pendencias",
  automation_mode: "bot",
  queue_status: "inbox",
  flow_state: {
    runtime: "santana-conversation-domain/v1",
    active_goal_status: "WAITING",
    pending_action_codes: ["ACTION_TEST"],
    pending_question_code: null,
  },
};
await db.query(
  `insert into support_runtime.conversation_state(conversation_id,revision,catalog_hash,state_hash,state) values($1,1,$2,$3,$4)`,
  [conv, hash, stateHash, JSON.stringify(state)],
);
await db.query(
  `insert into public.support_documents(id,conversation_id,storage_path,file_name) values($1,$2,'synthetic/doc','Documento sintético'),($3,$4,'synthetic/other','Outro documento')`,
  [document, conv, foreignDocument, conv2],
);
let count = 0;
async function test(name, fn) {
  await fn();
  count++;
  console.log(`PASS ${name}`);
}
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
const reject = async (sql, args, code) => {
  await assert.rejects(db.query(sql, args), (e) => e.code === code);
};
const controlVersions = new Map();
const command = (n, revision, type = "RESUME", extra = {}) => ({
  command_id: uuid(n),
  conversation_id: conv,
  expected_revision: revision,
  type,
  note: "Teste isolado",
  ...(controlVersions.has(uuid(n)) ? { expected_control_version: controlVersions.get(uuid(n)) } : {}),
  ...extra,
});
const call = async (cmd, newState = state, reply = "Continuação sintética", newProjection = projection, by = actor) => {
  if (cmd.type === "RESUME" && !cmd.expected_control_version) {
    cmd.expected_control_version = await scalar(
      `select to_jsonb(updated_at) result from public.support_conversations where id=$1`,
      [conv],
    );
    controlVersions.set(cmd.command_id, cmd.expected_control_version);
  }
  return scalar(
    `select public.support_runtime_commit_operator($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result`,
    [
      conv,
      by,
      cmd.command_id,
      cmd.expected_revision,
      hash,
      stateHash,
      JSON.stringify(newState),
      JSON.stringify(cmd),
      reply,
      JSON.stringify(newProjection),
    ],
  );
};
await test("snapshot denied without attendance permission", () =>
  reject(`select public.support_runtime_operator_snapshot($1,$2)`, [conv, denied], "42501"));
await test("anonymous and authenticated roles cannot execute operator RPCs", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await reject(`select public.support_runtime_operator_snapshot($1,$2)`, [conv, actor], "42501");
    await reject(`select public.support_runtime_operator_replay($1,$2,$3,$4)`, [conv, actor, uuid(100), "{}"], "42501");
    await db.exec("reset role");
  }
});
let first;
await test("service-only command commits state, event, request, protocol, reply and projection atomically", async () => {
  await db.exec("set role service_role");
  first = await call(command(100, 1));
  await db.exec("reset role");
  assert.equal(first.revision, 2);
  assert.equal(first.requests.length, 1);
  assert.match(first.requests[0].protocol, /^SAN-\d{8}-\d{6}$/);
  assert.equal(first.requests[0].id, request.solicitacao_id);
  assert.equal(
    await scalar(`select queue_status result from public.support_conversations where id=$1`, [conv]),
    "inbox",
  );
  assert.equal(await scalar(`select count(*)::int result from support_runtime.operator_events`), 1);
  assert.equal(await scalar(`select count(*)::int result from public.support_messages where direction='inbound'`), 0);
  assert.equal(
    await scalar(`select due_at is not null result from public.support_service_requests where id=$1`, [
      request.solicitacao_id,
    ]),
    true,
  );
});
await test("same command replay does not duplicate any row", async () => {
  const replay = await call(command(100, 1));
  assert.equal(replay.replayed, true);
  assert.equal(replay.outbox_id, first.outbox_id);
  assert.equal(await scalar(`select count(*)::int result from public.support_service_requests`), 1);
  assert.equal(await scalar(`select count(*)::int result from support_runtime.outbound_queue`), 1);
});
await test("replay lookup works before stale revision evaluation", async () => {
  const replay = await scalar(`select public.support_runtime_operator_replay($1,$2,$3,$4) result`, [
    conv,
    actor,
    uuid(100),
    JSON.stringify(command(100, 1)),
  ]);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 2);
});
await test("command payload and actor collisions rejected", async () => {
  await assert.rejects(call(command(100, 1, "RESUME", { note: "Changed" })), (e) => e.code === "23505");
  await assert.rejects(call(command(100, 1), state, null, projection, other), (e) => e.code === "23505");
});
await test("stale revision cannot mutate state", async () => {
  await assert.rejects(call(command(101, 1)), (e) => e.code === "55000");
  assert.equal(
    await scalar(`select revision::int result from support_runtime.conversation_state where conversation_id=$1`, [
      conv,
    ]),
    2,
  );
});
await test("document review is committed with real actor and engine state", async () => {
  const cmd = command(102, 2, "REVIEW_DOCUMENT", { document_id: document, document_status: "ACEITO" });
  const res = await call(cmd);
  assert.equal(res.revision, 3);
  const row =
    (await db.query(`select status,reviewed_by,review_notes from public.support_documents where id=$1`, [document]))
      .rows[0];
  assert.equal(row.status, "approved");
  assert.equal(row.reviewed_by, actor);
  assert.equal(row.review_notes, "Teste isolado");
});
await test("foreign document review rolls back command and state", async () => {
  await assert.rejects(
    call(command(103, 3, "REVIEW_DOCUMENT", { document_id: foreignDocument, document_status: "ACEITO" })),
    (e) => e.code === "22023",
  );
  assert.equal(
    await scalar(`select revision::int result from support_runtime.conversation_state where conversation_id=$1`, [
      conv,
    ]),
    3,
  );
  assert.equal(
    await scalar(`select status result from public.support_documents where id=$1`, [foreignDocument]),
    "pending",
  );
});
await test("request identity collision rolls back document review too", async () => {
  const collision = {
    ...state,
    solicitacoes: [{ ...request, goal_id: "different" }],
    goals: [...state.goals, { goal_id: "different" }],
  };
  await assert.rejects(
    call(
      command(104, 3, "REVIEW_DOCUMENT", { document_id: document, document_status: "ILEGÍVEL_INADEQUADO" }),
      collision,
    ),
    (e) => e.code === "23505",
  );
  assert.equal(await scalar(`select status result from public.support_documents where id=$1`, [document]), "approved");
});
await test("operational request status is never overwritten by runtime materialization", async () => {
  await db.query(`update public.support_service_requests set status='in_review' where id=$1`, [request.solicitacao_id]);
  await call(command(105, 3));
  assert.equal(
    await scalar(`select status result from public.support_service_requests where id=$1`, [request.solicitacao_id]),
    "in_review",
  );
});
await test("human mode decisions persist without enqueue and explicit RESUME preserves pending state", async () => {
  await db.query(
    `update public.support_conversations set automation_mode='human',human_takeover_at=now() where id=$1`,
    [conv],
  );
  const human = await call(
    command(106, 4, "RESOLVE_ACTION", {
      action_code: "ACTION_TEST",
      goal_id: goal,
      fact_code: "synthetic",
      value: "OK",
    }),
  );
  assert.equal(human.outbox_id, null);
  assert.equal(
    await scalar(`select automation_mode result from public.support_conversations where id=$1`, [conv]),
    "human",
  );
  await call(command(107, 5));
  assert.equal(
    await scalar(`select automation_mode result from public.support_conversations where id=$1`, [conv]),
    "bot",
  );
  assert.deepEqual(
    await scalar(`select state result from support_runtime.conversation_state where conversation_id=$1`, [conv]),
    state,
  );
});
await test("delivery prevents pending replies from before human takeover", async () => {
  const result = await scalar(`select public.support_runtime_claim_delivery($1) result`, [first.outbox_id]);
  assert.equal(result.claimed, false);
  assert.equal(result.status, "CANCELLED");
});
await test("old backlog without runtime revision cannot be sent", async () => {
  const msg = uuid(40), queue = uuid(41);
  await db.query(
    `insert into public.support_messages(id,conversation_id,direction,sender_type,body) values($1,$2,'outbound','bot','Old synthetic')`,
    [msg, conv],
  );
  await db.query(
    `insert into support_runtime.outbound_queue(outbox_id,conversation_id,message_id,phone_e164,body) values($1,$2,$3,'+5511000000010','Old synthetic')`,
    [queue, conv, msg],
  );
  assert.equal((await scalar(`select public.support_runtime_claim_delivery($1) result`, [queue])).status, "CANCELLED");
});
async function inbound(n) {
  const id = uuid(n);
  await db.query(
    `insert into public.support_messages(id,conversation_id,direction,sender_type,body,external_message_id) values($1,$2,'inbound','citizen','Entrada sintética',$3)`,
    [id, conv, `local-${n}`],
  );
  await db.query(
    `insert into support_runtime.inbound_receipts(inbound_message_id,conversation_id,external_message_id,content_hash,status) values($1,$2,$3,$4,'RECEIVED')`,
    [id, conv, `local-${n}`, hash],
  );
  return id;
}
await test("takeover between acquire and inbound commit suppresses reply and keeps human control", async () => {
  const incoming = await inbound(50);
  await db.query(
    `update public.support_conversations set automation_mode='human',human_takeover_at=now() where id=$1`,
    [conv],
  );
  const res = await scalar(
    `select public.support_runtime_commit_turn($1,$2,6,$3,$4,$5,'PROPOSED','ANSWER','Should not send',$6) result`,
    [conv, incoming, hash, stateHash, JSON.stringify(state), JSON.stringify(projection)],
  );
  assert.equal(res.outbox_id, null);
  assert.equal(res.reply_suppressed, true);
  assert.equal(
    await scalar(`select automation_mode result from public.support_conversations where id=$1`, [conv]),
    "human",
  );
});
await test("legacy mode control preserves official flow and rejects destructive bot reset", async () => {
  await db.exec(`set request.jwt.claim.sub='${actor}';set role authenticated`);
  assert.equal(await scalar(`select public.set_support_automation_mode($1,'human') result`, [conv]), true);
  await reject(`select public.set_support_automation_mode($1,'bot')`, [conv], "55000");
  await db.exec("reset role");
  assert.equal(
    await scalar(`select flow_state->>'runtime' result from public.support_conversations where id=$1`, [conv]),
    "santana-conversation-domain/v1",
  );
});
await test("non-runtime conversation still uses existing panel mode behavior", async () => {
  await db.exec(`set request.jwt.claim.sub='${actor}';set role authenticated`);
  assert.equal(await scalar(`select public.set_support_automation_mode($1,'bot') result`, [conv2]), true);
  await db.exec("reset role");
  assert.deepEqual(await scalar(`select flow_state result from public.support_conversations where id=$1`, [conv2]), {});
});
await test("permission revoked after a valid command prevents even replay disclosure", async () => {
  await db.query(`update public.support_members set approval_status='rejected' where user_id=$1`, [actor]);
  await reject(`select public.support_runtime_operator_replay($1,$2,$3,$4)`, [
    conv,
    actor,
    uuid(100),
    JSON.stringify(command(100, 1)),
  ], "42501");
});
await db.query(`update public.support_members set approval_status='approved' where user_id=$1`, [actor]);
const revision = () =>
  scalar(`select revision::int result from support_runtime.conversation_state where conversation_id=$1`, [conv]);
await test("request snapshot and untouched summary follow the new engine record", async () => {
  const updated = {
    ...state,
    solicitacoes: [{ ...request, summary: "Resumo automático atualizado", pending_action_refs: ["action-current"] }],
  };
  await call(command(200, await revision()), updated, null);
  const row = (await db.query(`select summary,snapshot from public.support_service_requests where id=$1`, [
    request.solicitacao_id,
  ])).rows[0];
  assert.equal(row.summary, "Resumo automático atualizado");
  assert.deepEqual(row.snapshot.runtime_request.pending_action_refs, ["action-current"]);
});
await test("human summary edits survive later runtime snapshot updates", async () => {
  await db.query(`update public.support_service_requests set summary='Resumo escrito pela equipe' where id=$1`, [
    request.solicitacao_id,
  ]);
  const updated = {
    ...state,
    solicitacoes: [{ ...request, summary: "Outro resumo automático", pending_action_refs: [] }],
  };
  await call(command(201, await revision()), updated, null);
  const row = (await db.query(`select summary,snapshot from public.support_service_requests where id=$1`, [
    request.solicitacao_id,
  ])).rows[0];
  assert.equal(row.summary, "Resumo escrito pela equipe");
  assert.equal(row.snapshot.runtime_request.summary, "Outro resumo automático");
});
await test("useful citizen question wins over a separate waiting action", async () => {
  const useful = {
    ...projection,
    queue_status: "waiting_citizen",
    flow_state: { ...projection.flow_state, waiting_for: "citizen", pending_question_code: "Q_USEFUL" },
  };
  await call(command(202, await revision()), state, null, useful);
  assert.equal(
    await scalar(`select queue_status result from public.support_conversations where id=$1`, [conv]),
    "waiting_citizen",
  );
});
await test("explicit team document review overrides an existing question", async () => {
  const waiting = {
    ...projection,
    queue_status: "inbox",
    flow_state: { ...projection.flow_state, waiting_for: "team", pending_question_code: "Q_DOCUMENT" },
  };
  await call(command(203, await revision()), state, null, waiting);
  assert.equal(
    await scalar(`select queue_status result from public.support_conversations where id=$1`, [conv]),
    "inbox",
  );
});
await test("document rejection synchronizes public status and reviewer", async () => {
  await call(
    command(204, await revision(), "REVIEW_DOCUMENT", {
      document_id: document,
      document_status: "ILEGÍVEL_INADEQUADO",
    }),
    state,
    null,
  );
  assert.equal(await scalar(`select status result from public.support_documents where id=$1`, [document]), "rejected");
});
async function handoff(n) {
  await db.query(`update public.support_conversations set automation_mode='bot' where id=$1`, [conv]);
  const incoming = await inbound(n);
  return scalar(
    `select public.support_runtime_commit_turn($1,$2,$3,$4,$5,$6,'PROPOSED','HUMAN_REQUEST','Encaminhado à equipe',$7) result`,
    [
      conv,
      incoming,
      await revision(),
      hash,
      stateHash,
      JSON.stringify({ ...state, handoff: { requested_at_seq: 1 } }),
      JSON.stringify({
        ...projection,
        automation_mode: "human",
        flow_state: { ...projection.flow_state, handoff_requested: true },
      }),
    ],
  );
}
await test("single explicit handoff acknowledgement can deliver after bot creates human handoff", async () => {
  const res = await handoff(60);
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [res.outbox_id])).claimed,
    true,
  );
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [res.outbox_id])).claimed,
    false,
  );
  assert.equal(
    await scalar(`select public.support_runtime_complete_delivery($1,'synthetic-sent') result`, [res.outbox_id]),
    true,
  );
});
await test("operator takeover after handoff acknowledgement creation blocks delivery", async () => {
  const res = await handoff(61);
  await db.query(`update public.support_conversations set human_takeover_at=now() where id=$1`, [conv]);
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [res.outbox_id])).claimed,
    false,
  );
});
await test("outbound PENDING reply cannot deliver after a newer committed revision", async () => {
  const old = await call(command(210, await revision()));
  await call(command(211, await revision()), state, null);
  const result = await scalar(`select public.support_runtime_claim_delivery($1) result`, [old.outbox_id]);
  assert.equal(result.claimed, false);
  assert.equal(result.status, "CANCELLED");
});
await test("expired PROCESSING reply cannot retry after a newer committed revision", async () => {
  const old = await call(command(212, await revision()));
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [old.outbox_id])).claimed,
    true,
  );
  await call(command(213, await revision()), state, null);
  await db.query(`update support_runtime.outbound_queue set updated_at=now()-interval '6 minutes' where outbox_id=$1`, [
    old.outbox_id,
  ]);
  const result = await scalar(`select public.support_runtime_claim_delivery($1) result`, [old.outbox_id]);
  assert.equal(result.claimed, false);
  assert.equal(result.status, "CANCELLED");
});
await test("malformed outbound revision fails closed without cast exception", async () => {
  const res = await call(command(214, await revision()));
  await db.query(
    `update public.support_messages set metadata=jsonb_set(metadata,'{runtime_revision}','"999999999999999999999999999999999"'::jsonb) where id=(select message_id from support_runtime.outbound_queue where outbox_id=$1)`,
    [res.outbox_id],
  );
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [res.outbox_id])).status,
    "CANCELLED",
  );
});
await test("manual pause after operator snapshot invalidates a delayed RESUME without changing revision", async () => {
  const snapshot = await scalar(`select public.support_runtime_operator_snapshot($1,$2) result`, [conv, actor]);
  assert.equal(typeof snapshot.control_version, "string");
  await db.exec(`set request.jwt.claim.sub='${other}';set role authenticated`);
  await scalar(`select public.set_support_automation_mode($1,'human') result`, [conv]);
  await db.exec("reset role");
  await assert.rejects(
    call(command(215, snapshot.revision, "RESUME", { expected_control_version: snapshot.control_version })),
    (e) => e.code === "55000",
  );
  assert.equal(await revision(), snapshot.revision);
  assert.equal(
    await scalar(`select automation_mode result from public.support_conversations where id=$1`, [conv]),
    "human",
  );
});
await test("manual close after operator snapshot invalidates a delayed RESUME", async () => {
  const snapshot = await scalar(`select public.support_runtime_operator_snapshot($1,$2) result`, [conv, actor]);
  await db.exec(`set request.jwt.claim.sub='${other}';set role authenticated`);
  await scalar(`select public.set_support_automation_mode($1,'closed') result`, [conv]);
  await db.exec("reset role");
  await assert.rejects(
    call(command(216, snapshot.revision, "RESUME", { expected_control_version: snapshot.control_version })),
    (e) => e.code === "55000",
  );
  assert.equal(
    await scalar(`select automation_mode result from public.support_conversations where id=$1`, [conv]),
    "closed",
  );
});
const request2 = { ...request, solicitacao_id: uuid(301), goal_id: "goal-protocol-2" };
const protocolState = {
  ...state,
  goals: [...state.goals, { goal_id: request2.goal_id, goal_code: "GOAL_TRANSPORTE", status: "WAITING" }],
  solicitacoes: [request, request2],
};
const outboundRow = async (id) =>
  (await db.query(
    `select q.body,q.status,m.body message_body,m.metadata from support_runtime.outbound_queue q join public.support_messages m on m.id=q.message_id where q.outbox_id=$1`,
    [id],
  )).rows[0];
let protocolCreated, protocolCommand;
await test("new request real protocol is appended identically to reply message and outbox", async () => {
  protocolCommand = command(300, await revision());
  protocolCreated = await call(protocolCommand, protocolState);
  const row = await outboundRow(protocolCreated.outbox_id);
  const realProtocol = protocolCreated.requests.find((r) => r.id === request2.solicitacao_id).protocol;
  assert.equal(row.body, row.message_body);
  assert.equal(protocolCreated.reply_body, row.body);
  assert.ok(row.body.endsWith(`Protocolo do atendimento: ${realProtocol}.`));
  assert.deepEqual(row.metadata.request_ids, [request2.solicitacao_id]);
});
await test("protocol announcement replay reuses original outbox and creates no second message", async () => {
  const before = await scalar(`select count(*)::int result from public.support_messages`);
  const replay = await call(protocolCommand, protocolState);
  assert.equal(replay.replayed, true);
  assert.equal(replay.outbox_id, protocolCreated.outbox_id);
  assert.equal(await scalar(`select count(*)::int result from public.support_messages`), before);
});
await test("successfully SENT protocol is omitted from following turns", async () => {
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [protocolCreated.outbox_id])).claimed,
    true,
  );
  assert.equal(
    await scalar(`select public.support_runtime_complete_delivery($1,'protocol-2-sent') result`, [
      protocolCreated.outbox_id,
    ]),
    true,
  );
  const later = await call(command(302, await revision()), protocolState);
  const row = await outboundRow(later.outbox_id);
  assert.equal(row.body, "Continuação sintética");
  assert.deepEqual(row.metadata.request_ids, []);
});
const request3 = { ...request, solicitacao_id: uuid(303), goal_id: "goal-protocol-3" };
const humanProtocolState = {
  ...protocolState,
  goals: [...protocolState.goals, { goal_id: request3.goal_id, goal_code: "GOAL_COMERCIAL", status: "WAITING" }],
  solicitacoes: [...protocolState.solicitacoes, request3],
};
let resumedProtocol;
await test("request created under human control is silent and real protocol appears on RESUME", async () => {
  await db.query(
    `update public.support_conversations set automation_mode='human',human_takeover_at=now() where id=$1`,
    [conv],
  );
  const before = await scalar(`select count(*)::int result from support_runtime.outbound_queue`);
  const human = await call(
    command(304, await revision(), "RESOLVE_ACTION", {
      action_code: "ACTION_TEST",
      goal_id: goal,
      fact_code: "synthetic",
      value: "OK",
    }),
    humanProtocolState,
  );
  assert.equal(human.outbox_id, null);
  assert.equal(await scalar(`select count(*)::int result from support_runtime.outbound_queue`), before);
  resumedProtocol = await call(command(305, await revision()), humanProtocolState);
  const row = await outboundRow(resumedProtocol.outbox_id);
  const actual = resumedProtocol.requests.find((r) => r.id === request3.solicitacao_id).protocol;
  assert.ok(row.body.includes(`Protocolo do atendimento: ${actual}.`));
  assert.deepEqual(row.metadata.request_ids, [request3.solicitacao_id]);
});
await test("superseded unannounced protocol remains in next valid inbound reply", async () => {
  const incoming = await inbound(70);
  const next = await scalar(
    `select public.support_runtime_commit_turn($1,$2,$3,$4,$5,$6,'PROPOSED','ANSWER','Próxima pergunta',$7) result`,
    [conv, incoming, await revision(), hash, stateHash, JSON.stringify(humanProtocolState), JSON.stringify(projection)],
  );
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [resumedProtocol.outbox_id])).status,
    "CANCELLED",
  );
  const row = await outboundRow(next.outbox_id);
  assert.ok(row.body.includes("Protocolo do atendimento: "));
  assert.deepEqual(row.metadata.request_ids, [request3.solicitacao_id]);
  assert.equal(
    (await scalar(`select public.support_runtime_claim_delivery($1) result`, [next.outbox_id])).claimed,
    true,
  );
  assert.equal(
    await scalar(`select public.support_runtime_complete_delivery($1,'protocol-3-sent') result`, [next.outbox_id]),
    true,
  );
});
await test("full-size reply is preserved and protocol deferred until it fits", async () => {
  const request4 = { ...request, solicitacao_id: uuid(306), goal_id: "goal-protocol-4" };
  const fullState = {
    ...humanProtocolState,
    goals: [...humanProtocolState.goals, { goal_id: request4.goal_id, goal_code: "GOAL_CONCESSAO", status: "WAITING" }],
    solicitacoes: [...humanProtocolState.solicitacoes, request4],
  };
  const full = await call(command(307, await revision()), fullState, "x".repeat(4096));
  const fullRow = await outboundRow(full.outbox_id);
  assert.equal(fullRow.body.length, 4096);
  assert.equal(fullRow.body, fullRow.message_body);
  assert.deepEqual(fullRow.metadata.request_ids, []);
  const short = await call(command(308, await revision()), fullState, "Pergunta curta");
  const shortRow = await outboundRow(short.outbox_id);
  assert.ok(shortRow.body.length <= 4096);
  assert.ok(shortRow.body.includes("Protocolo do atendimento: "));
  assert.deepEqual(shortRow.metadata.request_ids, [request4.solicitacao_id]);
});
await test("historical non-runtime request protocols are never appended", async () => {
  await db.query(
    `insert into public.support_service_requests(id,conversation_id,protocol,subject,summary,idempotency_key) values($1,$2,'HISTORICAL-DO-NOT-ANNOUNCE','exumacao','Histórico sintético','manual:synthetic')`,
    [uuid(309), conv],
  );
  const later = await call(command(310, await revision()), humanProtocolState);
  assert.ok(!(await outboundRow(later.outbox_id)).body.includes("HISTORICAL-DO-NOT-ANNOUNCE"));
});
console.log(`PASS ${count} isolated PostgreSQL cases (PGlite); no external database or messaging used`);
await db.close();
