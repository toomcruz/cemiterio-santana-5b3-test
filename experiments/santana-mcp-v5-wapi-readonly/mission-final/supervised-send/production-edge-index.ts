import {mcpOfficialOperation} from './mcp-official-operations.ts';
import {productionMcpRead} from './mcp-production.ts';
import {mountOperationalTeamReview} from './lib/sana/recadastro-team-host.ts';
import {syntheticPlanBytes} from './team-review-plan.ts';
import { whatsappIdentity } from "./whatsapp-identity.ts";
import { panelOperations } from "./panel-operations.ts";
import { humanInbox, whatsappOutbound } from "./human-inbox.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const operatorName = (name: string) => /^[a-z][a-z0-9._-]{2,31}$/.test(name) && !name.startsWith("sana-preview-");
function sameSecret(provided: string, expected: string) {
  if (provided.length !== expected.length || expected.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const caller = Deno.env.get("SANA_PROD_CALLER_TOKEN") ?? "";
  if (!url || !serviceKey || !anonKey || caller.length < 32)
    return reply({ error: "AUTH_BACKEND_UNCONFIGURED" }, 503);
  // Separate OAuth-authenticated read boundary; original panel actions keep their caller guard.
  if (new URL(request.url).pathname.endsWith("/sana-panel-preview-login/mcp-read")) {
    const scopedService = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return productionMcpRead(request, scopedService);
  }
  if (!sameSecret(request.headers.get("x-sana-prod-token") ?? "", caller))
    return reply({ error: "UNAUTHORIZED_CALLER" }, 401);
  if (Number(request.headers.get("content-length") ?? "0") > 2050000)
    return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
  const rawBody = await request.text();
  const bodyBytes = new TextEncoder().encode(rawBody).byteLength;
  if (bodyBytes > 2050000) return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })() as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "INVALID_BODY" }, 400);
  if (!['human_inbox_ingest','paused_canary_inbox_ingest','whatsapp_outbound_ingest','whatsapp_identity','operator_appearance_save'].includes(String(body.action)) && !String(body.action).startsWith("operator_manual_") && bodyBytes > 4096) return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
  if (['human_inbox_ingest','paused_canary_inbox_ingest','whatsapp_outbound_ingest','whatsapp_identity'].includes(String(body.action)) && bodyBytes > 32768) return reply({error:'PAYLOAD_TOO_LARGE'},413);
  if (String(body.action).startsWith("operator_manual_") && bodyBytes > 16384) return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = text(body.action);
  if (['operator_mcp_identity','operator_mcp_preview','operator_mcp_authorize','operator_mcp_prepare','operator_mcp_settle','operator_mcp_status'].includes(action)) return mcpOfficialOperation(request,body,service);
  if (['recadastro_read','recadastro_review','recadastro_preview'].includes(action)) {
    try {
      const privateReview=await mountOperationalTeamReview(name=>Deno.env.get(name),service,syntheticPlanBytes);
      return panelOperations(request,body,service,privateReview);
    } catch { return reply({error:'PRIVATE_REVIEW_UNAVAILABLE',no_send:true},503); }
  }
  if (["human_inbox_ingest","paused_canary_inbox_ingest"].includes(action)) return humanInbox(body, service);
  if (action === "whatsapp_identity") return whatsappIdentity(body, service);
  if (action === "whatsapp_outbound_ingest") return whatsappOutbound(body, service);
  if (["operational_snapshot", "operator_control", "operator_case_note", "operator_reply", "operator_document_link", "operator_manual_open", "operator_manual_prepare", "operator_manual_settle", "operator_appearance_read", "operator_appearance_save", "operator_attachment_read", "operator_attachment_upload", "operator_attachment_link", "operator_validation_seed", "operator_validation_result", "operator_contact_name_save", "operator_contact_names_sync"].includes(action))
    return panelOperations(request, body, service);

  if (action === "register") {
    const username = text(body.username);
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    const password = body.password;
    if (!operatorName(username) || displayName.length < 2 || displayName.length > 100
        || typeof password !== "string" || password.length < 16 || password.length > 128)
      return reply({ error: "INVALID_OPERATOR_REGISTRATION" }, 400);
    const existing = await service.from("support_members").select("user_id").limit(1);
    if (existing.error) return reply({ error: "MEMBER_LOOKUP_FAILED" }, 502);
    if (existing.data.length) return reply({ error: "OPERATOR_REGISTRATION_CLOSED" }, 409);
    const email = `${username}@acesso.cemiterio-santana.local`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { sana_panel_operator: true } });
    if (created.error || !created.data.user) return reply({ error: "CREATE_USER_FAILED" }, 502);
    const id = created.data.user.id;
    const member = await service.from("support_members").insert({
      user_id: id, username, display_name: displayName, role: "agent",
      is_active: false, approval_status: "pending", permissions: ["atendimentos"],
    });
    if (member.error) {
      await service.auth.admin.deleteUser(id);
      return reply({ error: "CREATE_MEMBER_FAILED" }, 502);
    }
    await service.from("support_access_audit").insert({
      action: "operator_register", target_type: "support_members", target_id: id,
      details: { username, approval_required: true },
    });
    return reply({ status: "pending" }, 201);
  }

  if (action === "login") {
    const identifier = text(body.identifier);
    const password = body.password;
    if (!operatorName(identifier) || typeof password !== "string" || password.length < 16)
      return reply({ error: "Usuário ou senha incorretos." }, 401);
    const member = await service.from("support_members")
      .select("user_id,username,role,is_active,approval_status,permissions")
      .eq("username", identifier).maybeSingle();
    if (member.error || !member.data?.is_active || member.data.approval_status !== "approved"
        || !member.data.permissions.includes("atendimentos"))
      return reply({ error: "Usuário ou senha incorretos." }, 401);
    const user = await service.auth.admin.getUserById(member.data.user_id);
    if (!user.data.user?.email || user.data.user.app_metadata?.sana_panel_operator !== true)
      return reply({ error: "Usuário ou senha incorretos." }, 401);
    const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await publicClient.auth.signInWithPassword({ email: user.data.user.email, password });
    if (signed.error || !signed.data.session) return reply({ error: "Usuário ou senha incorretos." }, 401);
    await service.from("support_members").update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", member.data.user_id);
    return reply({ access_token: signed.data.session.access_token,
      refresh_token: signed.data.session.refresh_token, username: identifier,
      role: "agent", approval_status: "approved", permissions: ["atendimentos"] });
  }

  if (action === "technical_snapshot") {
    const jwt = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (!jwt) return reply({ error: "USER_SESSION_REQUIRED" }, 401);
    const authenticated = await service.auth.getUser(jwt);
    const user = authenticated.data.user;
    if (authenticated.error || !user || user.app_metadata?.sana_panel_operator !== true)
      return reply({ error: "USER_SESSION_INVALID" }, 401);
    const member = await service.from("support_members")
      .select("user_id,username,display_name,is_active,approval_status,permissions")
      .eq("user_id", user.id).maybeSingle();
    if (member.error || !member.data?.is_active || member.data.approval_status !== "approved"
        || !member.data.permissions?.includes("atendimentos"))
      return reply({ error: "OPERATOR_NOT_AUTHORIZED" }, 403);
    const technicalId = "11111111-1111-4111-8111-111111111111";
    const requested = body.conversation_id;
    if (requested !== undefined && requested !== technicalId)
      return reply({ error: "CONVERSATION_NOT_AUTHORIZED" }, 404);
    const conversation = await service.from("sana_conversations")
      .select("conversation_id,contact_key,lifecycle,automation_mode,revision,created_at,updated_at")
      .eq("conversation_id", technicalId).maybeSingle();
    if (conversation.error || !conversation.data || conversation.data.contact_key !== "+12025550101")
      return reply({ error: "TECHNICAL_CONTEXT_NOT_FOUND" }, 404);
    const [cases, events, outbox] = await Promise.all([
      service.from("sana_cases").select("case_id,service_family,status,revision,created_at")
        .eq("conversation_id", technicalId).order("created_at"),
      service.from("sana_events").select("event_id,event_type,revision,created_at,payload_json")
        .eq("conversation_id", technicalId).order("created_at").limit(100),
      service.from("sana_outbox").select("outbox_id,response_text,delivery_state,created_at")
        .eq("conversation_id", technicalId).order("created_at").limit(100),
    ]);
    if (cases.error || events.error || outbox.error) return reply({ error: "TECHNICAL_READ_FAILED" }, 502);
    return reply({ status: "ready", operator: {
      id: user.id, username: member.data.username, display_name: member.data.display_name,
      permissions: ["atendimentos"],
    }, conversation: {
      id: technicalId, label: "Conversa técnica 0101",
      lifecycle: conversation.data.lifecycle, automation_mode: conversation.data.automation_mode,
      revision: conversation.data.revision, created_at: conversation.data.created_at,
      updated_at: conversation.data.updated_at,
    }, cases: cases.data, history: [
      ...(events.data ?? []).map(event => ({
        id: event.event_id, kind: "event", type: event.event_type,
        revision: event.revision, created_at: event.created_at,
        detail: event.event_type === "OPERATOR_CONTROL" ? event.payload_json?.mode ?? null : null,
      })),
      ...(outbox.data ?? []).map(message => ({
        id: message.outbox_id, kind: "outbox", type: message.delivery_state,
        created_at: message.created_at, text: message.response_text,
      })),
    ].sort((a,b) => String(a.created_at).localeCompare(String(b.created_at))) });
  }

  return reply({ error: "ACTION_NOT_ALLOWED" }, 400);
});

