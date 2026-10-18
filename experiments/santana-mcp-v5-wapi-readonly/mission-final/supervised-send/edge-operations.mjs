// Candidate mount in existing PROD Edge, behind its existing X-Sana-Prod-Token gate.
// There is no provider transport and no W-API credential in this module.
const ISSUER='https://sfoygvjtnwqvudrbgoom.supabase.co/auth/v1';
const HMG='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(body        ,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
function claims(token       ){try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return {};}}
export async function verifiedReview(token       ,operation       ,human        ,transport             =fetch){
 const r=await transport(HMG,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({mode:'send_intent',action:human?'human_binding_proof':'oauth_binding_proof',intent_id:operation})});
 if(!r.ok)throw Error('MCP_REVIEW_UNAVAILABLE');
 const raw=await r.text();if(raw.length>12000)throw Error('MCP_REVIEW_UNAVAILABLE');
 const p=JSON.parse(raw);
 if(p.status!=='ready'||p.intent_id!==operation||p.actor?.session_active!==true||!UUID.test(p.actor?.id||'')||!UUID.test(p.actor?.session_id||'')||p.owner_id!==p.actor.id)throw Error('MCP_REVIEW_UNAVAILABLE');
 if(human){if(p.actor.client_id||!p.actor.password_amr||!Number.isFinite(p.actor.auth_time)||p.actor.auth_time<Date.now()/1000-600||p.actor.auth_time>Date.now()/1000+30||p.reviewed_by!==p.actor.id||p.review_session_id!==p.actor.session_id)throw Error('MCP_HUMAN_REVIEW_NOT_CURRENT');}
 else if(p.actor.client_id!==CLIENT)throw Error('MCP_CLIENT_DENIED');
 return p;
}
export async function productionOperator(service    ,token       ){
 const {data,error}=await service.auth.getUser(token);const u=data?.user,c=claims(token);
 if(error||!u||u.app_metadata?.sana_panel_operator!==true||c.sub!==u.id||c.iss!==ISSUER||c.aud!=='authenticated'||c.client_id||c.azp||!Number.isFinite(c.exp)||c.exp<=Date.now()/1000||c.nbf&&c.nbf>Date.now()/1000||!UUID.test(c.session_id||''))throw Error('MCP_PROD_SESSION_REQUIRED');
 const m=await service.from('support_members').select('is_active,approval_status,permissions').eq('user_id',u.id).maybeSingle();
 if(m.error||!m.data?.is_active||m.data.approval_status!=='approved'||!m.data.permissions?.includes('atendimentos'))throw Error('MCP_PROD_OPERATOR_REVOKED');
 const s=await service.rpc('sana_mcp_session_active',{p_owner:u.id,p_session:c.session_id});
 if(s.error||s.data!==true)throw Error('MCP_PROD_SESSION_REQUIRED');
 return{id:u.id,session_id:c.session_id,session_active:true,active:true};
}
export async function mcpOfficialOperation(request        ,b    ,service    ,transport             =fetch){
 const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!token||Object.keys(b).some(k=>!['action','operation_id','payload_sha256','explicit_authorization','claim_token','outcome','provider_message_id'].includes(k)))return reply({error:'MCP_INVALID_OPERATION'},400);
 try{
  if(b.action==='operator_mcp_identity')return reply(await productionOperator(service,token));
  if(!UUID.test(b.operation_id||''))return reply({error:'MCP_INVALID_OPERATION'},400);
  let p    ;
  if(['operator_mcp_authorize','operator_mcp_preview'].includes(b.action)){
   const operator=await productionOperator(service,token);
   const proof=await verifiedReview(request.headers.get('x-santana-human-review')||'',b.operation_id,true,transport);
   if(proof.state!=='human_reviewed_dispatch_blocked'||proof.payload?.attachment!==null||!Number.isFinite(Date.parse(proof.expires_at))||Date.parse(proof.expires_at)<=Date.now())throw Error('MCP_APPROVAL_INVALID_OR_STALE');
   const binding=await service.from('sana_mcp_read_access').select('operator_id').eq('subject_id',proof.actor.id).eq('client_id',CLIENT).eq('operator_id',operator.id).eq('conversation_id',proof.payload.conversation_id).eq('is_active',true).gt('expires_at',new Date().toISOString()).maybeSingle();
   if(binding.error||!binding.data)throw Error('MCP_PROD_IDENTITY_BINDING_REQUIRED');
   if(b.action==='operator_mcp_preview')return reply({status:'ready',payload:proof.payload,payload_sha256:proof.payload_sha256,expires_at:proof.expires_at,operation_id:b.operation_id});
   if(b.explicit_authorization!=='one_real_text_attempt'||proof.payload_sha256!==b.payload_sha256)throw Error('MCP_APPROVAL_INVALID_OR_STALE');
   p={operation:'authorize',operation_id:b.operation_id,subject_id:proof.actor.id,client_id:CLIENT,operator_id:operator.id,operator_session_id:operator.session_id,
    conversation_id:proof.payload.conversation_id,payload:proof.payload,payload_sha256:proof.payload_sha256,expires_at:new Date(Math.min(Date.parse(proof.expires_at),Date.now()+600000)).toISOString(),explicit_authorization:b.explicit_authorization};
  }else{
   const proof=await verifiedReview(token,b.operation_id,false,transport);
   const kind=({operator_mcp_prepare:'prepare',operator_mcp_settle:'settle',operator_mcp_status:'status'}                         )[b.action];
   if(!kind)throw Error('MCP_INVALID_OPERATION');
   if(kind==='prepare'&&(proof.state!=='human_reviewed_dispatch_blocked'||proof.payload_sha256!==b.payload_sha256||proof.payload?.attachment!==null||!Number.isFinite(Date.parse(proof.expires_at))||Date.parse(proof.expires_at)<=Date.now()))throw Error('MCP_APPROVAL_INVALID_OR_STALE');
   p={operation:kind,operation_id:b.operation_id,subject_id:proof.actor.id,client_id:CLIENT,...(kind==='prepare'?{payload_sha256:b.payload_sha256}:kind==='settle'?{claim_token:b.claim_token,outcome:b.outcome,provider_message_id:b.provider_message_id}:{})};
  }
  const r=await service.rpc('sana_mcp_coordinated_send',{p});
  if(r.error)throw Error(/^MCP_[A-Z_]+$/.test(r.error.message||'')?r.error.message:'MCP_DATABASE_UNAVAILABLE');
  return reply(r.data);
 }catch(e){const code=e instanceof Error&&/^MCP_[A-Z_]+$/.test(e.message)?e.message:'MCP_OPERATION_UNAVAILABLE';return reply({error:code,retry_allowed:false},409);}
}
