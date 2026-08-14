import type { RequestCommandInput, RequestCommandResult } from "../../contracts/request-command.ts";
import { assertMethod, assertString, HttpProblem, json, parseJson, problem } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { requireInternalShadowAccess, requireShadowOnly } from "../_shared/security.ts";
function one<T>(value:T|T[]):T { if(Array.isArray(value)){ if(!value[0]) throw new HttpProblem(502,"EMPTY_RPC_RESULT","RPC returned no result"); return value[0]; } return value; }
/** RPC-only façade: no request fact is authoritative outside the database transaction. */
export async function executeRequestCommand(input:RequestCommandInput, rest:SupabaseRest):Promise<RequestCommandResult> {
 if(!input.shadow_only) throw new HttpProblem(403,"SHADOW_ONLY_REQUIRED","Live request execution is unavailable"); const actor=input.actor_id??"support-request-command-shadow";
 if(input.action==="PROPOSE") return one(await rest.rpc<RequestCommandResult|RequestCommandResult[]>("propose_request_transaction",{p_decision_id:assertString(input.decision_id,"decision_id"),p_actor:actor}));
 const id=assertString(input.confirmation_id,"confirmation_id");
 if(input.action==="CONFIRM") return one(await rest.rpc<RequestCommandResult|RequestCommandResult[]>("confirm_request_transaction",{p_confirmation_id:id,p_confirmation_nonce:assertString(input.confirmation_nonce,"confirmation_nonce"),p_classification_id:assertString(input.classification_id,"classification_id"),p_inbound_message_id:assertString(input.inbound_message_id,"inbound_message_id"),p_actor:actor}));
 if(input.action==="DECLINE") return one(await rest.rpc<RequestCommandResult|RequestCommandResult[]>("decline_request_transaction_v2",{p_confirmation_id:id,p_confirmation_nonce:assertString(input.confirmation_nonce,"confirmation_nonce"),p_actor:actor}));
 if(input.action==="GET_STATUS") return one(await rest.rpc<RequestCommandResult|RequestCommandResult[]>("get_request_confirmation_status",{p_confirmation_id:id}));
 throw new HttpProblem(400,"INVALID_ACTION","Unsupported request action");
}
if(import.meta.main) Deno.serve(async request=>{try{assertMethod(request,"POST");requireInternalShadowAccess(request);requireShadowOnly();return json(await executeRequestCommand(await parseJson<RequestCommandInput>(request),new SupabaseRest()));}catch(error){return problem(error);}});
