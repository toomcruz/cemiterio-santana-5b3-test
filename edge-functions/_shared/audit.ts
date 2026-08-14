import { SupabaseRest } from "./rest.ts";
export async function appendAuditEvent(rest:SupabaseRest,event:Record<string,unknown>):Promise<void>{await rest.rpc("append_shadow_audit_event",{p_event:event});}
