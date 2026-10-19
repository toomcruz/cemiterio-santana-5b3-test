// Same Panel route, same official emitter. No W-API URL or credential here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const safeError=e=>/^MCP_[A-Z_]+$/.test(e?.message||'')?e.message:'MCP_PANEL_OUTCOME_UNCONFIRMED';
export function createSingleReviewHandler({invoke,sendOfficial,config,origin='https://atendimento-cemiterio-santana.vercel.app'}){
 return async req=>{
  if(req.method!=='POST')return reply({error:'MCP_PANEL_METHOD_REQUIRED'},405);
  let b;try{let raw=await req.text();if(new TextEncoder().encode(raw).length>4096)throw Error();b=JSON.parse(raw);}catch{return reply({error:'MCP_PANEL_INVALID_REQUEST'},400);}
  const action=typeof b?.action==='string'?b.action.replace(/^mcp_review_/,''):'';
  const modes={stage:['action','operation_id','payload_sha256'],status:['action','operation_id'],list:['action','before_at','before_id'],preview:['action','operation_id'],receipt:['action','operation_id'],approve_send:['action','operation_id','payload_sha256','challenge']};
  if(!modes[action]||!b||Array.isArray(b)||Object.keys(b).some(k=>!modes[action].includes(k))||action!=='list'&&!UUID.test(b.operation_id||''))return reply({error:'MCP_PANEL_INVALID_REQUEST'},400);
  const human=!['stage','status'].includes(action);
  if(human&&(req.headers.get('origin')!==origin||req.headers.get('sec-fetch-site')==='cross-site'))return reply({error:'MCP_PANEL_ORIGIN_REQUIRED'},403);
  if(!human&&req.headers.has('origin'))return reply({error:'MCP_PANEL_SERVER_STAGE_REQUIRED'},403);
  if(!/^Bearer [A-Za-z0-9._~-]{20,16384}$/.test(req.headers.get('authorization')||''))return reply({error:'MCP_PANEL_SESSION_REQUIRED'},401);
  if((action==='stage'||action==='approve_send')&&!HASH.test(b.payload_sha256||''))return reply({error:'MCP_PANEL_INVALID_REQUEST'},400);
  if(action==='approve_send'&&!/^[A-Za-z0-9_-]{43}$/.test(b.challenge||''))return reply({error:'MCP_PANEL_APPROVAL_NOT_BOUND'},403);
  try{
   if(action!=='approve_send'){
    const r=await invoke({action:'operator_mcp_review_'+action,...Object.fromEntries(Object.entries(b).filter(([k])=>k!=='action'))});
    return reply(r.data,r.response.status);
   }
   // Config readiness is checked before recording an approval.
   if(!config?.production||!config.token||!/^[A-Za-z0-9_-]{1,80}$/.test(config.instance||''))return reply({error:'MCP_PANEL_OFFICIAL_CHANNEL_UNAVAILABLE'},503);
   const authorization=await invoke({action:'operator_mcp_review_approve',operation_id:b.operation_id,payload_sha256:b.payload_sha256,challenge:b.challenge});
   if(!authorization.response.ok)return reply(authorization.data,authorization.response.status);
   const a=authorization.data;
   if(a.fresh_approval!==true){return reply({...a,retry_allowed:false,dispatch_requested:false});}
   if(a.status!=='authorized'||a.operation_id!==b.operation_id||a.payload_sha256!==b.payload_sha256||!a.payload)return reply({error:'MCP_PANEL_INVALID_APPROVAL_RECEIPT',retry_allowed:false},502);
   const callOfficial=async v=>{
    const operation=v.action==='operator_manual_prepare'?'prepare':v.action==='operator_manual_settle'?'settle':null;
    if(!operation)throw Error('MCP_PANEL_OFFICIAL_ACTION_DENIED');
    return invoke({action:'operator_mcp_review_'+operation,operation_id:b.operation_id,payload_sha256:b.payload_sha256,
     ...(operation==='settle'?{claim_token:v.claim_token,outcome:v.outcome,provider_message_id:v.provider_message_id}:{})});
   };
   const sent=await sendOfficial({conversation_id:a.payload.conversation_id,action_id:b.operation_id,
    expected_revision:a.payload.expected_revision,text:a.payload.text,...(a.attachment_id?{attachment_id:a.attachment_id}:{})},callOfficial,config);
   // A read can fail after the official sender succeeded. Never convert that into a retry.
   try{const status=await invoke({action:'operator_mcp_review_receipt',operation_id:b.operation_id});if(status.response.ok)return reply({...status.data,retry_allowed:false,dispatch_requested:true,...(sent.body?.error?{dispatch_error:sent.body.error}:{})});}catch{}
   const state=sent.body?.delivery_state;
   return reply({status:'recorded',operation_id:b.operation_id,state:state==='dispatching'?'unknown':state||'unknown',
    accepted_by_api:state==='sent'?true:state==='failed'||state==='test'?false:null,delivery_confirmed:false,retry_allowed:false,dispatch_requested:true});
  }catch(e){return reply({status:'unconfirmed',error:safeError(e),retry_allowed:false,automatic_retry:false,operation_id:b.operation_id},409);}
 };
}
