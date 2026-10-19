import {productionOperator} from './mcp-official-operations.ts';
import {validMedia,reviewedBytes,stageApprovedMedia,officialMediaReceipt} from './media-attachments.mjs';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
const HMG='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const reply=(b:unknown,s=200)=>Response.json(b,{status:s,headers:{'cache-control':'no-store'}});
export const sha256=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function canonical(v:any):string {return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
const fail=(error:any,fallback='MCP_PANEL_DATABASE_UNAVAILABLE')=>{throw Error(/^MCP_[A-Z_]+$/.test(error?.message||'')?error.message:fallback);};
async function proof(token:string,op:string,staging:boolean,transport:typeof fetch){
 const r=await transport(HMG,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({mode:'send_intent',action:staging?'panel_binding_proof':'oauth_binding_proof',intent_id:op})});
 if(!r.ok)throw Error('MCP_PANEL_OAUTH_BINDING_REQUIRED');
 const raw=await r.text();if(raw.length>720000)throw Error('MCP_PANEL_OAUTH_BINDING_REQUIRED');const p=JSON.parse(raw);
 if(p.status!=='ready'||p.intent_id!==op||p.owner_id!==p.actor?.id||!UUID.test(p.actor?.id||'')||!UUID.test(p.actor?.session_id||'')||p.actor?.session_active!==true||p.actor?.client_id!==CLIENT)throw Error('MCP_PANEL_OAUTH_BINDING_REQUIRED');
 if(staging&&(p.state!=='prepared'||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(p.expires_at)<=Date.now()))throw Error('MCP_PANEL_DRAFT_EXPIRED');
 return p;
}
export async function singleReviewOperation(req:Request,b:any,service:any,transport:typeof fetch=fetch){
 const kind=String(b?.action||'').replace(/^operator_mcp_review_/,'');
 const allowed:any={stage:['operation_id','payload_sha256'],status:['operation_id'],list:['before_at','before_id'],preview:['operation_id'],receipt:['operation_id'],approve:['operation_id','payload_sha256','challenge'],prepare:['operation_id','payload_sha256'],settle:['operation_id','payload_sha256','claim_token','outcome','provider_message_id']};
 const token=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(req.headers.get('authorization')||'')?.[1];
 if(!token||!allowed[kind]||Object.keys(b).some(k=>k!=='action'&&!allowed[kind].includes(k))||kind!=='list'&&!UUID.test(b.operation_id||''))return reply({error:'MCP_PANEL_INVALID_REQUEST'},400);
 try{
  const rpc=async(p:any)=>{const r=await service.rpc('sana_mcp_panel_review',{p});if(r.error)fail(r.error);return r.data;};
  if(kind==='stage'||kind==='status'){
   const p=await proof(token,b.operation_id,kind==='stage',transport);
   if(kind==='status')return reply(await rpc({operation:'status',operation_id:b.operation_id,subject_id:p.actor.id,client_id:CLIENT}));
   const v=p.payload;
   if(!HASH.test(b.payload_sha256||'')||p.payload_sha256!==b.payload_sha256||!UUID.test(v?.conversation_id||'')||!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||typeof v.text!=='string'||v.text.length>3000||(!v.text.trim()&&!v.attachment)||!v.recipient||!v.conversation_watermark||(v.attachment!==null&&!validMedia(v.attachment)))throw Error('MCP_PANEL_INVALID_DRAFT');
   if(v.attachment!==null)await reviewedBytes(p);
   const c=await service.from('sana_conversations').select('contact_key').eq('conversation_id',v.conversation_id).maybeSingle();
   if(c.error||!c.data||typeof c.data.contact_key!=='string')throw Error('MCP_PANEL_SCOPE_DENIED');
   // Bind the exact native destination, even when OAuth reads mask the phone.
   const recipient=c.data.contact_key,payloadHash=await sha256(canonical({payload:v,recipient_e164:recipient}));
   const out=await rpc({operation:'stage',operation_id:b.operation_id,subject_id:p.actor.id,client_id:CLIENT,recipient_e164:recipient,payload:v,payload_sha256:payloadHash,source_payload_sha256:p.payload_sha256,attachment_base64:v.attachment===null?null:p.attachment_base64,expires_at:p.expires_at});
   return reply({...out,review_url:'https://atendimento-cemiterio-santana.vercel.app/mcp-review?operation='+b.operation_id});
  }
  // Only a validated PROD human session supplies the operator/session IDs.
  const operator=await productionOperator(service,token);
  const identity={operator_id:operator.id,operator_session_id:operator.session_id};
  if(['list','receipt'].includes(kind))return reply(await rpc({operation:kind,...identity,...(kind==='receipt'?{operation_id:b.operation_id}:{before_at:b.before_at,before_id:b.before_id})}));
  if(kind==='preview'){
   const challenge=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
   const data=await rpc({operation:'preview',operation_id:b.operation_id,...identity,challenge_sha256:await sha256(challenge)});
   return reply({...data,...(data.state==='prepared'&&!data.approved?{challenge}:{})});
  }
  const row=await service.from('sana_mcp_panel_reviews').select('*').eq('operation_id',b.operation_id).eq('operator_id',operator.id).maybeSingle();
  if(row.error||!row.data)throw Error('MCP_PANEL_DRAFT_NOT_AVAILABLE');const d=row.data;
  if(!HASH.test(b.payload_sha256||'')||d.payload_sha256!==b.payload_sha256)throw Error('MCP_PANEL_APPROVAL_NOT_BOUND');
  if(kind==='approve'){
   // Invalid/expired challenges must not even stage private attachment bytes.
   if(!d.approved_at&&(!/^[A-Za-z0-9_-]{43}$/.test(b.challenge||'')||d.challenge_session_id!==operator.session_id||d.challenge_sha256!==await sha256(b.challenge)||!(Date.parse(d.challenge_expires_at)>Date.now())||!(Date.parse(d.expires_at)>Date.now())))throw Error('MCP_PANEL_APPROVAL_NOT_BOUND');
   const scope=await service.rpc('sana_mcp_supervised_scope',{p_subject:d.subject_id,p_client:d.client_id,p_operator:operator.id,p_conversation:d.conversation_id,p_live:true});
   if(scope.error)fail(scope.error);if(scope.data!==true)throw Error('MCP_PANEL_SCOPE_DENIED');
   const attachmentId=d.approved_at||d.payload.attachment===null?null:await stageApprovedMedia(service,d,operator.id,b.operation_id);
   return reply(await rpc({operation:'approve',operation_id:b.operation_id,...identity,payload_sha256:b.payload_sha256,challenge_sha256:await sha256(b.challenge),attachment_id:attachmentId}));
  }
  if(!d.approved_at||d.approved_session_id!==operator.session_id)throw Error('MCP_PANEL_APPROVAL_NOT_BOUND');
  let attachmentReceipt:any=null;
  if(kind==='prepare'&&d.payload.attachment!==null){
   const owned=await service.from('sana_mcp_send_operations').select('*').eq('operation_id',b.operation_id).eq('operator_id',operator.id).maybeSingle();
   if(owned.error||!owned.data)throw Error('MCP_PANEL_DRAFT_NOT_AVAILABLE');
   if(owned.data.state==='authorized')attachmentReceipt=await officialMediaReceipt(service,owned.data);
  }
  const p={operation:kind,operation_id:b.operation_id,subject_id:d.subject_id,client_id:d.client_id,...(kind==='prepare'?{payload_sha256:d.payload_sha256}:{claim_token:b.claim_token,outcome:b.outcome,provider_message_id:b.provider_message_id})};
  const r=await service.rpc('sana_mcp_coordinated_send',{p});if(r.error)fail(r.error);
  return reply({...r.data,...(r.data?.status==='prepared'&&!r.data.no_send&&attachmentReceipt?{attachment:attachmentReceipt}:{})});
 }catch(e){return reply({error:e instanceof Error&&/^MCP_[A-Z_]+$/.test(e.message)?e.message:'MCP_PANEL_OPERATION_UNCONFIRMED',retry_allowed:false},409);}
}
