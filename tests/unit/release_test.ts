import { assertEquals } from "../fixtures/assert.ts";
import { resolveRelease } from "../../edge-functions/support-release-resolver/index.ts";
Deno.test("resolver uses atomic RPC",async()=>{let n="";const r:any={rpc:async(x:string)=>{n=x;return {status:"SESSION_PINNED"};}};await resolveRelease({conversation_id:"c",scope_code:"SANTANA"},r);assertEquals(n,"resolve_shadow_session");});
