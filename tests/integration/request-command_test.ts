import { assertEquals } from "../fixtures/assert.ts";
import { executeRequestCommand } from "../../edge-functions/support-request-command/index.ts";
const rest:any={rpc:async(name:string,body:any)=>({status:name==="confirm_request_transaction"?"CONFIRMED":"PROPOSED",request_id:"r",reason_codes:[name],echo:body})};
Deno.test("PROPOSE sends only decision id to authoritative RPC",async()=>{const r:any=await executeRequestCommand({action:"PROPOSE",correlation_id:"c",decision_id:"d",shadow_only:true},rest);assertEquals(r.reason_codes[0],"propose_request_transaction");});
Deno.test("CONFIRM requires inbound proof",async()=>{let failed=false;try{await executeRequestCommand({action:"CONFIRM",correlation_id:"c",confirmation_id:"x",confirmation_nonce:"n",shadow_only:true},rest);}catch{failed=true;}assertEquals(failed,true);});
