// Mount beside manual-whatsapp.ts in the existing official Panel project.
import {createSupervisedOfficialHandler} from './official-adapter.mjs';
import {verifiedReview} from './edge-operations.mjs';
type Invoke=(body:object)=>Promise<{response:Response,data:any}>;
export function officialSupervisedBinding(request:Request,invoke:Invoke,config:{production:boolean,token:string,instance:string},transport:typeof fetch=fetch){
 const proofs=new Map<string,any>(); // One request only; never logged or persisted.
 return createSupervisedOfficialHandler({
  prodIdentity:async()=>{const r=await invoke({action:'operator_mcp_identity'});return r.response.ok?r.data:null;},
  homologIdentity:async(token:string,{human,operation_id}:any)=>{const proof=await verifiedReview(token,operation_id,human,transport);proofs.set(token,proof);return proof.actor;},
  reviewProof:async(token:string)=>proofs.get(token),
  rpc:async(p:any)=>{
   const b={action:'operator_mcp_'+p.operation,operation_id:p.operation_id,...(p.payload_sha256?{payload_sha256:p.payload_sha256}:{}),...(p.explicit_authorization?{explicit_authorization:p.explicit_authorization}:{}),...(p.claim_token?{claim_token:p.claim_token,outcome:p.outcome,provider_message_id:p.provider_message_id}:{})};
   const r=await invoke(b);if(!r.response.ok)throw Error(r.data.error||'MCP_DATABASE_UNAVAILABLE');return r.data;
  },officialConfig:config,transport,
 })(request);
}
