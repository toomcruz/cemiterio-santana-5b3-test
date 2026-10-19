const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 4096;
const MODES = new Set(["conversations", "contact", "messages", "files"]);
const response = (status, payload) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
function allowedKeys(body, keys) { return Object.keys(body).every((key) => keys.has(key)); }
function positiveInt(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error("bad_request");
  return value;
}
function requiredScope(mode, body) {
  if (mode === "conversations" || mode === "contact") return "santana.conversations.read";
  if (mode === "files") return "santana.files.read_metadata";
  return body.include_content === true ? "santana.messages.read_content" : "santana.messages.read_metadata";
}

export function createHomologReadHandler({ authenticate, authorize, checkRateLimit, readSnapshot }) {
  for (const fn of [authenticate, authorize, checkRateLimit, readSnapshot]) {
    if (typeof fn !== "function") throw new Error("invalid_configuration");
  }
  return async (request) => {
    if (request.method !== "POST") return response(405, { status: "method_not_allowed" });
    if (request.headers.has("origin")) return response(403, { status: "origin_denied" });
    const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(request.headers.get("authorization") || "");
    if (!match) return response(401, { status: "unauthorized" });
    if (Number(request.headers.get("content-length") || "0") > MAX_BODY) return response(413, { status: "request_too_large" });
    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return response(413, { status: "request_too_large" });
      body = JSON.parse(raw);
    } catch { return response(400, { status: "bad_request" }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !MODES.has(body.mode)) return response(400, { status: "bad_request" });
    const mode = body.mode;
    const keys = mode === "conversations" ? new Set(["mode", "page", "per_page"])
      : mode === "contact" ? new Set(["mode", "conversation_id"])
      : new Set(["mode", "conversation_id", "limit", "before", "before_key", ...(mode === "messages" ? ["include_content"] : [])]);
    if (!allowedKeys(body, keys)) return response(400, { status: "bad_request" });
    if (["contact", "messages", "files"].includes(mode)
      && (typeof body.conversation_id !== "string" || !UUID_RE.test(body.conversation_id))) return response(400, { status: "bad_request" });
    if (mode === "messages" && body.include_content === true) return response(403, { status: "content_scope_unavailable" });
    if (mode === "messages" && body.include_content !== undefined && typeof body.include_content !== "boolean") return response(400, { status: "bad_request" });
    let limit;
    let offset = 0;
    let page = 1;
    try {
      if (mode === "conversations") {
        page = positiveInt(body.page, 1, 25);
        limit = positiveInt(body.per_page, 20, 50);
        offset = (page - 1) * limit;
      } else limit = positiveInt(body.limit, 20, 100);
    } catch { return response(400, { status: "bad_request" }); }
    const before = body.before ?? null;
    const beforeKey = body.before_key ?? null;
    if ((before === null) !== (beforeKey === null) || (before !== null &&
      (typeof before !== "string" || !Number.isFinite(Date.parse(before)) || typeof beforeKey !== "string" || !UUID_RE.test(beforeKey)))) return response(400, { status: "bad_request" });

    let identity;
    try { identity = await authenticate(match[1]); } catch { return response(401, { status: "unauthorized" }); }
    if (!identity || typeof identity.sub !== "string" || !UUID_RE.test(identity.sub)
      || typeof identity.clientId !== "string" || identity.clientId.length < 1 || identity.clientId.length > 200
      || /[\u0000-\u001f\u007f]/.test(identity.clientId)) return response(401, { status: "unauthorized" });
    const scope = requiredScope(mode, body);
    let grant;
    try { grant = await authorize(identity, scope, mode === "conversations" ? null : body.conversation_id ?? null); }
    catch { return response(503, { status: "unavailable" }); }
    if (!grant?.allowed || !Array.isArray(grant.scopes) || !grant.scopes.includes(scope)
      || !Array.isArray(grant.conversationIds) || grant.conversationIds.length === 0) return response(403, { status: "read_access_denied", required_scope: scope });
    if (body.conversation_id && !grant.conversationIds.includes(body.conversation_id)) return response(403, { status: "conversation_access_denied" });
    const quota = mode === "files" ? 10 : mode === "messages" && body.include_content ? 5 : 30;
    try { if (!(await checkRateLimit(identity, quota))) return response(429, { status: "rate_limited" }); }
    catch { return response(503, { status: "unavailable" }); }
    try {
      const data = await readSnapshot({ mode, conversationId: body.conversation_id ?? null, limit, offset,
        conversationIds: grant.conversationIds, before, beforeKey });
      if (!data || data.status === "not_found" || data.code === "CONVERSATION_NOT_FOUND") return response(404, { status: "not_found", code: "CONVERSATION_NOT_FOUND" });
      if (mode === "conversations") {
        const allowedIds = new Set(grant.conversationIds);
        const items = (data.items ?? []).filter((item) => allowedIds.has(item.conversation_id));
        return response(200, { status: "ready", source: "synthetic_homolog", items, count: data.total_count ?? items.length,
          page, per_page: limit, has_more: Boolean(data.has_more), next_page: data.next_offset === null ? null : page + 1 });
      }
      if (mode === "contact") {
        if (!data.contact || !grant.conversationIds.includes(data.contact.conversation_id)) return response(404, { status: "not_found" });
        return response(200, { status: "ready", source: "synthetic_homolog", contact: data.contact });
      }
      if (mode === "messages") return response(200, { status: "ready", source: "synthetic_homolog", conversation_id: body.conversation_id,
        items: data.messages ?? [], has_more: Boolean(data.has_more_messages), next_cursor: data.next_cursor ?? null, content_included: false });
      return response(200, { status: "ready", source: "synthetic_homolog", conversation_id: body.conversation_id,
        items: data.files ?? [], count: Array.isArray(data.files) ? data.files.length : 0,
        has_more: Boolean(data.has_more), next_cursor: data.next_cursor ?? null });
    } catch { return response(503, { status: "unavailable" }); }
  };
}

