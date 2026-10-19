import {singleReviewBinding} from '@/lib/sana/single-review-binding';
import {officialSupervisedBinding} from '@/lib/sana/vercel-binding';
import { NextRequest, NextResponse } from "next/server";
import { sendManualWhatsApp } from "@/lib/sana/manual-whatsapp";
import { recoverContactNames } from "@/lib/sana-contact-names";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const EDGE = "https://sfoygvjtnwqvudrbgoom.supabase.co/functions/v1/sana-panel-preview-login";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["operator_control", "operator_case_note", "operator_reply", "operator_document_link", "operator_manual_send", "operator_manual_open", "operator_attachment_upload", "operator_attachment_link", "operator_contact_name_save", "operator_contact_names_refresh", "mcp_authorize", "mcp_preview", "mcp_send", "mcp_status", "mcp_review_stage", "mcp_review_status", "mcp_review_list", "mcp_review_preview", "mcp_review_receipt", "mcp_review_approve_send"]);
export const maxDuration = 60;
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function forward(request: NextRequest, body: Record<string, unknown>) {
  if (!["preview", "production"].includes(process.env.VERCEL_ENV ?? "")) return json({ error: "NOT_FOUND" }, 404);
  const token = process.env.SANA_PROD_CALLER_TOKEN?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer [^\s]+$/.test(authorization)) return json({ error: "USER_SESSION_REQUIRED" }, 401);
  if (token.length < 32) return json({ error: "RUNTIME_BINDING_UNAVAILABLE" }, 503);
  const invoke = async (payload: object) => {
    const response = await fetch(EDGE, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(['operator_mcp_authorize','operator_mcp_prepare','operator_mcp_review_approve','operator_mcp_review_prepare'].includes(String((payload as Record<string,unknown>).action))?30000:12000),
      headers: { "Content-Type": "application/json", "X-Sana-Prod-Token": token, Authorization: authorization, ...(request.headers.get("x-santana-human-review") ? {"X-Santana-Human-Review":request.headers.get("x-santana-human-review")!}: {}) },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("INVALID_UPSTREAM");
    return { response, data };
  };
  try {
    if (String(body.action).startsWith('mcp_review_')) {
      if (process.env.SANTANA_SINGLE_REVIEW_READY !== 'verified') return json({error:'MCP_PANEL_REVIEW_DISABLED'},503);
      const clean=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)});
      const result=await singleReviewBinding(clean,invoke,{production:process.env.VERCEL_ENV==='production',token:process.env.WAPI_TOKEN??'',instance:process.env.WAPI_INSTANCE_ID??''});
      return json(await result.json(),result.status);
    }
    if (["mcp_authorize","mcp_preview","mcp_send","mcp_status"].includes(String(body.action))) {
      if (process.env.SANTANA_SUPERVISED_SEND_READY !== "verified") return json({error:"MCP_SUPERVISED_BINDING_DISABLED"},503);
      const human = ["mcp_authorize","mcp_preview"].includes(String(body.action));
      if (human && (request.headers.get("origin") !== "https://atendimento-cemiterio-santana.vercel.app" || request.headers.get("sec-fetch-site")==="cross-site")) return json({error:"MCP_PANEL_ORIGIN_REQUIRED"},403);
      if (body.action==="mcp_preview") { const r=await invoke({...body,action:"operator_mcp_preview"});return json(r.data,r.response.status); }
      const clean=new Request(request.url,{method:"POST",headers:{authorization,"x-santana-human-review":request.headers.get("x-santana-human-review")??""},body:JSON.stringify({...body,action:String(body.action).replace("mcp_","")})});
      const result=await officialSupervisedBinding(clean,invoke,{production:process.env.VERCEL_ENV==="production",token:process.env.WAPI_TOKEN??"",instance:process.env.WAPI_INSTANCE_ID??""});
      return json(await result.json(),result.status);
    }
    if(body.action === 'operator_attachment_upload' && process.env.VERCEL_ENV !== 'production') return json({error:'PRODUCTION_REQUIRED'},403);
    if (body.action === "operator_contact_names_refresh") {
      if (Object.keys(body).some(key => key !== 'action')) return json({ error: 'INVALID_CONTACT_NAME' }, 400);
      const result = await recoverContactNames(invoke, { token: process.env.WAPI_TOKEN ?? '', instance: process.env.WAPI_INSTANCE_ID ?? '' });
      return json(result.body, result.status);
    }
    if (body.action === "operator_manual_send") {
      const result = await sendManualWhatsApp(body, invoke, { production: process.env.VERCEL_ENV === "production", token: process.env.WAPI_TOKEN ?? "", instance: process.env.WAPI_INSTANCE_ID ?? "" });
      return json(result.body, result.status);
    }
    if (body.action === "operator_manual_open" && process.env.VERCEL_ENV !== "production") return json({ error: "PRODUCTION_REQUIRED" }, 403);
    if (body.action === "operator_document_link") {
      if (typeof body.conversation_id !== "string" || !UUID.test(body.conversation_id)
        || typeof body.document_id !== "string" || !UUID.test(body.document_id)) return json({ error: "INVALID_DOCUMENT_SCOPE" }, 400);
      // Use the same operator's existing snapshot boundary. Do not invent
      // assignment ownership or rely on the browser to authorize a document.
      const scoped = await invoke({ action: "operational_snapshot", conversation_id: body.conversation_id });
      if (!scoped.response.ok) return json({ error: "DOCUMENT_SCOPE_UNAVAILABLE" }, [401, 403, 404].includes(scoped.response.status) ? scoped.response.status : 502);
      const scope = scoped.data;
      if (!Array.isArray(scope.conversations) || !Array.isArray(scope.cases) || !Array.isArray(scope.documents)) return json({ error: "DOCUMENT_SCOPE_UNAVAILABLE" }, 502);
      const hasConversation = scope.conversations.some((item: { conversation_id?: unknown }) => item?.conversation_id === body.conversation_id);
      const caseIds = new Set(scope.cases.filter((item: { conversation_id?: unknown; case_id?: unknown }) => item?.conversation_id === body.conversation_id && typeof item.case_id === "string" && UUID.test(item.case_id)).map((item: { case_id: string }) => item.case_id));
      const hasDocument = scope.documents.some((item: { document_id?: unknown; case_id?: unknown }) => item?.document_id === body.document_id && caseIds.has(item.case_id));
      if (!hasConversation || !hasDocument) return json({ error: "DOCUMENT_NOT_AVAILABLE" }, 404);
    }
    const result = await invoke(body);
    return json(result.data, result.response.status >= 200 && result.response.status <= 599 && ![204, 205, 304].includes(result.response.status) ? result.response.status : 502);
  } catch { return json({ error: "RUNTIME_UNAVAILABLE" }, 502); }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("conversation_id");
  const view = request.nextUrl.searchParams.get("view");
  const before = request.nextUrl.searchParams.get("before");
  const key = request.nextUrl.searchParams.get("before_key");
  if(view!==null&&!['messages','administrative','audit'].includes(view))return json({error:'INVALID_VIEW'},400);
  return forward(request, { action: "operational_snapshot", ...(id ? { conversation_id: id } : {}),...(view?{view}:{}),...(before?{before,before_key:key??''}:{}) });
}
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 16384) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid");
  } catch { return json({ error: "INVALID_BODY" }, 400); }
  if (typeof body.action !== "string" || !ACTIONS.has(body.action)) return json({ error: "ACTION_NOT_ALLOWED" }, 400);
  if (body.action !== "operator_manual_send" && Buffer.byteLength(JSON.stringify(body), "utf8") > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
  return forward(request, body);
}

