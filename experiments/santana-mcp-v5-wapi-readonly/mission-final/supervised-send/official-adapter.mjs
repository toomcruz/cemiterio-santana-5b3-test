// Candidate adapter for the EXISTING official sender. No provider transport here.
import {sendManualWhatsApp} from '../official-channel-manual.ts';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
// Auth dependencies MUST validate issuer/signature/audience/expiry/current session.
// prodIdentity is the real PROD user; OAuth HOMOLOG is never a PROD user JWT.
export function createSupervisedOfficialHandler({prodIdentity,homologIdentity,reviewProof,rpc,officialConfig,transport,now=()=>Date.now()}){
 return async request=>{
  if(request.method!=='POST'||request.headers.has('origin'))return json(403,{error:'SERVER_ROUTE_REQUIRED'});
  let b;try{const text=await request.text();if(text.length>6000)throw Error();b=JSON.parse(text);}catch{return json(400,{error:'INVALID_BODY'});}
  if(!exact(b,['action','operation_id','payload_sha256','explicit_authorization'])||!['authorize','send','status'].includes(b.action)||!UUID.test(b.operation_id||''))return json(400,{error:'INVALID_OPERATION'});
  const bearer=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(request.headers.get('authorization')||'')?.[1];
  try{
   if(b.action==='authorize'){
    const actor=bearer?await prodIdentity(bearer):null;
    if(!actor?.active||!actor.session_active||!UUID.test(actor.id||'')||!UUID.test(actor.session_id||''))return json(403,{error:'PROD_OPERATOR_SESSION_REQUIRED'});
    if(b.explicit_authorization!=='one_real_text_attempt')return json(403,{error:'SPECIFIC_REAL_SEND_AUTHORIZATION_REQUIRED'});
    const humanToken=request.headers.get('x-santana-human-review')||'';
    const human=await homologIdentity(humanToken,{human:true,operation_id:b.operation_id});
    if(!human?.session_active||human.client_id||!human.password_amr||!Number.isFinite(human.auth_time)||human.auth_time<now()/1000-600||human.auth_time>now()/1000+30)return json(403,{error:'INDEPENDENT_HUMAN_SESSION_REQUIRED'});
    const proof=await reviewProof(humanToken,b.operation_id,{human:true});
    if(!proof||proof.owner_id!==human.id||proof.reviewed_by!==human.id||!UUID.test(proof.review_session_id||'')||proof.review_session_active!==true||proof.state!=='human_reviewed_dispatch_blocked')return json(403,{error:'HUMAN_REVIEW_NOT_PROVEN'});
    const p=proof.payload;
    if(proof.payload_sha256!==b.payload_sha256||!p||p.attachment!==null||typeof p.text!=='string'||p.text!==p.text.trim()||!p.text||!Number.isSafeInteger(p.expected_revision)||!UUID.test(p.conversation_id||'')||!Number.isFinite(Date.parse(proof.expires_at))||Date.parse(proof.expires_at)<=now())return json(409,{error:'REVIEW_CHANGED_EXPIRED_OR_UNSUPPORTED'});
    const receipt=await rpc({operation:'authorize',operation_id:b.operation_id,subject_id:human.id,client_id:CLIENT,operator_id:actor.id,operator_session_id:actor.session_id,
     conversation_id:p.conversation_id,payload:p,payload_sha256:proof.payload_sha256,expires_at:new Date(Math.min(Date.parse(proof.expires_at),now()+600000)).toISOString(),explicit_authorization:b.explicit_authorization});
    return json(200,{...receipt,real_attempt_executed:false});
   }
   const actor=bearer?await homologIdentity(bearer,{human:false,operation_id:b.operation_id}):null;
   if(!actor?.session_active||actor.client_id!==CLIENT||!UUID.test(actor.id||''))return json(403,{error:'CHATGPT_OAUTH_SESSION_REQUIRED'});
   const identity={operation_id:b.operation_id,subject_id:actor.id,client_id:CLIENT};
   if(b.action==='status')return json(200,await rpc({operation:'status',...identity}));
   if(!/^[a-f0-9]{64}$/.test(b.payload_sha256||''))return json(400,{error:'EXACT_CONTENT_DIGEST_REQUIRED'});
   const proof=await reviewProof(bearer,b.operation_id,{human:false});
   if(!proof||proof.owner_id!==actor.id||proof.state!=='human_reviewed_dispatch_blocked'||proof.review_session_active!==true||proof.payload_sha256!==b.payload_sha256||Date.parse(proof.expires_at)<=now()||!Number.isFinite(Date.parse(proof.expires_at))||proof.payload?.attachment!==null)return json(403,{error:'REVIEW_NOT_CURRENT'});
   // The database owns the canonical operator, full recipient, revision and
   // single-use operation. Neither caller-provided text nor actor_id is accepted.
   const invoke=async body=>{
    const prepare=body.action==='operator_manual_prepare';
    if(!prepare&&body.action!=='operator_manual_settle')throw Error('OFFICIAL_ACTION_NOT_ALLOWED');
    const data=await rpc({...identity,operation:prepare?'prepare':'settle',...(prepare?{payload_sha256:b.payload_sha256}:{claim_token:body.claim_token,outcome:body.outcome,provider_message_id:body.provider_message_id})});
    return {response:new Response('{}',{status:200}),data};
   };
   const p=proof.payload;
   const result=await sendManualWhatsApp({conversation_id:p.conversation_id,action_id:b.operation_id,expected_revision:p.expected_revision,text:p.text},invoke,officialConfig,transport);
   return json(result.status,{...result.body,operation_id:b.operation_id,accepted_by_api:result.body.delivery_state==='sent',delivery_confirmed:false});
  }catch(error){
   // Never repeat a call after an ambiguous network/database outcome.
   return json(409,{error:/^MCP_[A-Z_]+$/.test(error?.message||'')?error.message:'OPERATION_BLOCKED_OR_OUTCOME_UNKNOWN',retry_allowed:false});
  }
 };
}
