// Real individual Auth; only grants permission for fixtures. No PROD call/transport.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS={'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'POST,OPTIONS'};
const reply=(b,status=200)=>new Response(JSON.stringify(b),{status,headers:HEADERS});
export function createLabReview({authenticate,grant,sessionActive,save,now=()=>Date.now()}){
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
  if(request.method!=='POST')return reply({error:'LAB_METHOD_DENIED'},405);
  let b;try{const raw=await request.text();if(raw.length>230000)throw Error();b=JSON.parse(raw);}catch{return reply({error:'LAB_INVALID_BODY'},400);}
  if(!b||Object.keys(b).some(k=>!['canonical_manifest','manifest_sha256','challenge_nonce','explicit'].includes(k))||b.explicit!=='approve_exact_synthetic_batch'||typeof b.canonical_manifest!=='string'||!/[a-f0-9]{64}/.test(b.manifest_sha256||'')||!/^[-_A-Za-z0-9]{40,100}$/.test(b.challenge_nonce||''))return reply({error:'LAB_EXACT_REVIEW_REQUIRED'},400);
  try{
   const token=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(request.headers.get('authorization')||'')?.[1];
   const actor=token?await authenticate(token):null;
   if(!actor||actor.client_id||!actor.password_amr||!UUID.test(actor.subject)||!UUID.test(actor.session)||!Number.isFinite(actor.auth_time)||actor.auth_time<now()/1000-600||actor.auth_time>now()/1000+30)return reply({error:'LAB_RECENT_INDEPENDENT_SESSION_REQUIRED'},403);
   const access=await grant(actor.subject);
   if(!access?.is_active||!UUID.test(access.operator_id)||Date.parse(access.expires_at)<=now()||!await sessionActive(actor.subject,actor.session))return reply({error:'LAB_OPERATOR_REVOKED'},403);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b.canonical_manifest)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(hash!==b.manifest_sha256)return reply({error:'LAB_MANIFEST_CHANGED'},409);
   const m=JSON.parse(b.canonical_manifest);
   if(m.owner!==actor.subject||m.operator!==access.operator_id||m.client!=='chatgpt-lab'||!UUID.test(m.batch_id)||!Number.isFinite(m.expires_at)||m.expires_at<=now()/1000||m.expires_at>now()/1000+660||!Array.isArray(m.recipients)||m.recipients.length<1||m.recipients.length>50)return reply({error:'LAB_SCOPE_DENIED'},403);
   for(const p of m.recipients){
    if(!/^00000000-0000-4000-8000-[0-9a-f]{12}$/.test(p.conversation_id)||parseInt(p.conversation_id.slice(-12),16)<1||parseInt(p.conversation_id.slice(-12),16)>50||!/^551199990[0-9]{4}$/.test(p.phone)||!UUID.test(p.operation_id)||typeof p.text!=='string'||p.text.length>3000||p.attachment&&(!['image/png','image/jpeg','application/pdf'].includes(p.attachment.mime_type)||!/^[a-f0-9]{64}$/.test(p.attachment.sha256)||'content_base64' in p.attachment))return reply({error:'LAB_FIXTURE_ONLY'},403);
   }
   const receipt=await save({subject_id:actor.subject,operator_id:access.operator_id,session_id:actor.session,batch_id:m.batch_id,manifest_sha256:hash,challenge_nonce:b.challenge_nonce,auth_time:new Date(actor.auth_time*1000).toISOString(),expires_at:new Date(Math.min(m.expires_at*1000,Date.parse(access.expires_at),(actor.auth_time+600)*1000)).toISOString(),recipient_count:m.recipients.length});
   return reply({status:'approved_lab_only',receipt_id:receipt.receipt_id,batch_id:m.batch_id,manifest_sha256:hash,production_write_authorized:false});
  }catch{return reply({error:'LAB_REVIEW_UNAVAILABLE'},503);}
 };
}
