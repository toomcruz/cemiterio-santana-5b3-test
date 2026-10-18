import {sendIntent} from './send-intents.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHomologReadHandler } from "./homolog_core.mjs";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = url && serviceRole ? createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null;

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function jwtClaims(token: string) {
  try {
    const raw = token.split(".")[1];
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch { return null; }
}

if (!url || !anon || !serviceRole || !supabaseAdmin) {
  Deno.serve(() => new Response(JSON.stringify({ status: "unavailable" }), {
    status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" },
  }));
} else {
  const handler = createHomologReadHandler({
    authenticate: async (token: string) => {
      // Supabase Auth verifies the signature/session; claims below are only used after getUser succeeds.
      const verifier = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await verifier.auth.getUser(token);
      if (error || !data.user) return null;
      const claims = jwtClaims(token);
      const aud = claims?.aud;
      const expectedIssuer = `${url.replace(/\/$/, "")}/auth/v1`;
      if (!claims || claims.sub !== data.user.id || claims.iss !== expectedIssuer
        || !(aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated")))
        || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)
        || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > Math.floor(Date.now() / 1000)))) return null;
      const clientId = claims.client_id ?? claims.azp;
      if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 200
        || /[\u0000-\u001f\u007f]/.test(clientId)) return null;
      return { sub: data.user.id, clientId };
    },
    authorize: async (identity: { sub: string; clientId: string }, scope: string, conversationId: string | null) => {
      const { data: operator, error: operatorError } = await supabaseAdmin.from("homolog_mcp_operators")
        .select("is_active").eq("user_id", identity.sub).maybeSingle();
      if (operatorError || !operator || operator.is_active !== true) return { allowed: false, conversationIds: [], scopes: [] };
      const { data, error } = await supabaseAdmin.from("homolog_mcp_read_grants")
        .select("scopes,conversation_ids,is_active,expires_at")
        .eq("user_id", identity.sub).eq("client_id", identity.clientId).maybeSingle();
      if (error || !data || data.is_active !== true
        || (data.expires_at && Date.parse(data.expires_at) <= Date.now())
        || !Array.isArray(data.scopes) || !data.scopes.includes(scope)
        || !Array.isArray(data.conversation_ids)) return { allowed: false, conversationIds: [] };
      const ids = data.conversation_ids.filter((id: unknown) => typeof id === "string");
      if (conversationId && !ids.includes(conversationId)) return { allowed: false, conversationIds: ids, scopes: data.scopes };
      return { allowed: ids.length > 0, conversationIds: ids, scopes: data.scopes };
    },
    checkRateLimit: async (identity: { sub: string; clientId: string }, limit: number) => {
      const actorHash = await sha256(`${identity.sub}:${identity.clientId}`);
      const { data, error } = await supabaseAdmin.rpc("sana_mcp_homolog_rate_check", {
        p_actor_hash: actorHash, p_client_id: identity.clientId, p_limit: limit,
      });
      if (error) throw new Error("rate_limit_unavailable");
      return data === true;
    },
    readSnapshot: async ({ mode, conversationId, limit, offset, conversationIds, before, beforeKey }) => {
      const { data, error } = await supabaseAdmin.rpc("sana_mcp_homolog_snapshot", {
        p_mode: mode, p_conversation_id: conversationId, p_limit: limit, p_offset: offset ?? 0,
        p_conversation_ids: mode === "conversations" ? conversationIds : null,
        p_before: before, p_before_key: beforeKey,
      });
      if (error) throw new Error("synthetic_snapshot_unavailable");
      return data;
    },
  });
  Deno.serve(async (request: Request) => {
    if (request.method !== "POST" || request.headers.has("origin")) return handler(request);
    const intentMode = await request.clone().json().then((v:any)=>v?.mode === "send_intent").catch(()=>false);
    if (intentMode) {
      const b=await request.json(); delete b.mode;
      return sendIntent(new Request(request.url,{method:"POST",headers:{authorization:request.headers.get("authorization")??""},body:JSON.stringify(b)}),supabaseAdmin,supabaseAdmin,`${url.replace(/\/$/,"")}/auth/v1`);
    }
    const raw = await request.clone().text();
    if (raw.length > 4096) return new Response(JSON.stringify({status:"request_too_large"}), {status:413,headers:{"content-type":"application/json","cache-control":"no-store"}});
    try {
      const upstream = await fetch("https://sfoygvjtnwqvudrbgoom.supabase.co/functions/v1/sana-panel-preview-login/mcp-read", {
        method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
        headers:{"content-type":"application/json","Authorization":request.headers.get("authorization")??""},body:raw,
      });
      const text = await upstream.text();
      if (text.length > 2000000) throw Error("response_too_large");
      const data = JSON.parse(text);
      if (upstream.status === 404 && data.status === "identity_unbound") return handler(request);
      return new Response(text,{status:upstream.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
    } catch {
      return new Response(JSON.stringify({status:"production_read_unavailable"}),{status:503,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
  });
}
