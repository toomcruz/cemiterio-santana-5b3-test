// Preparation and human review only. No transport, provider key or dispatch path.
export const REAL_DISPATCH_ENABLED = false;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
function attachment(b){
 if(b===undefined)return null;
 if(!exact(b,['name','mime_type','content_base64'])||typeof b.name!=='string'||!b.name||b.name.length>100||/[\x00-\x1f\x7f/\\]/.test(b.name)||!['image/png','image/jpeg','application/pdf'].includes(b.mime_type)||typeof b.content_base64!=='string'||b.content_base64.length>700000||!b.content_base64.length||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.content_base64))throw Error('invalid_attachment');
 const bytes=Uint8Array.from(atob(b.content_base64),x=>x.charCodeAt(0));
 const valid=b.mime_type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):b.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:[37,80,68,70,45].every((v,i)=>bytes[i]===v);
 if(!valid||bytes.length<16||bytes.length>524288)throw Error('invalid_attachment');
 return {...b,size_bytes:bytes.length,bytes};
}
export function createIntentHandler({authenticate,contact,save,get,approve,audit,reviewSessionActive=async()=>false,now=()=>Date.now(),id=()=>crypto.randomUUID()}){
 return async request=>{
  if(request.method!=='POST'||request.headers.has('origin'))return json(403,{status:'origin_or_method_denied'});
  let b;try{const raw=await request.text();if(raw.length>720000)return json(413,{status:'request_too_large'});b=JSON.parse(raw);}catch{return json(400,{status:'bad_request'});}
  if(!b||!['prepare','status','human_preview','approve','human_binding_proof','oauth_binding_proof'].includes(b.action))return json(400,{status:'bad_request'});
  const token=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(request.headers.get('authorization')||'')?.[1];
  let actor;try{actor=token?await authenticate(token):null;}catch{}
  if(!actor)return json(401,{status:'unauthorized'});
  const human=['human_preview','approve','human_binding_proof'].includes(b.action);
  if(human&&(!actor.human||actor.client_id||!UUID.test(actor.session_id||'')||!Number.isFinite(actor.auth_time)||actor.auth_time>now()/1000+30||actor.auth_time<now()/1000-600))return json(403,{status:'independent_recent_human_session_required'});
  if(!human&&(!actor.oauth||actor.client_id!=='ccb5e1fc-2a61-4296-943a-a85c103e9313'))return json(403,{status:'preparation_client_denied'});
  try{
   if(b.action==='prepare'){
    if(!exact(b,['action','conversation_id','idempotency_key','text','attachment'])||!UUID.test(b.conversation_id||'')||!UUID.test(b.idempotency_key||'')||typeof b.text!=='string'||b.text.length>3000||(!b.text.trim()&&!b.attachment))return json(400,{status:'invalid_preparation'});
    const a=attachment(b.attachment),c=await contact(token,b.conversation_id);
    if(!c||c.conversation_id!==b.conversation_id||!c.contact_key||!Number.isSafeInteger(c.revision)||typeof c.human_paused!=='boolean')return json(403,{status:'authorized_recipient_unavailable'});
    const payload={conversation_id:b.conversation_id,recipient:{name:c.name||null,phone_mask:c.contact_key},expected_revision:c.revision,...(c.message_watermark?{conversation_watermark:c.message_watermark}:{}),text:b.text,attachment:a?{name:a.name,mime_type:a.mime_type,size_bytes:a.size_bytes,sha256:await digest(a.bytes)}:null};
    const sha=await digest(JSON.stringify(payload));
    const row=await save({id:id(),owner_id:actor.sub,client_id:actor.client_id,idempotency_key:b.idempotency_key,payload,payload_sha256:sha,attachment_base64:a?.content_base64??null,state:'prepared',expires_at:new Date(now()+30*60000).toISOString()});
    if(row.payload_sha256!==sha)return json(409,{status:'idempotency_conflict'});
    await audit(actor,row.id,'prepare');
    return json(200,{status:'ready',source:'santana_send_intent_homolog',intent_id:row.id,payload:row.payload,payload_sha256:sha,state:row.state,approval_url:'https://santana-mcp-homolog-consent.vercel.app/revisar-envio#'+row.id,real_dispatch_enabled:false,external_request_attempted:false});
   }
   if(!exact(b,['action','intent_id',...(b.action==='approve'?['payload_sha256']:[])])||!UUID.test(b.intent_id||''))return json(400,{status:'bad_request'});
   const row=await get(b.intent_id,actor.sub);
   const bindingProof=['human_binding_proof','oauth_binding_proof'].includes(b.action);
   if(!row||!bindingProof&&Date.parse(row.expires_at)<=now())return json(404,{status:'intent_not_available'});
   if(b.action==='approve'){
    if(b.payload_sha256!==row.payload_sha256)return json(409,{status:'preview_changed'});
    if(row.state!=='prepared')return json(409,{status:'already_reviewed'});
    const changed=await approve(row.id,actor.sub,actor.session_id,row.payload_sha256);
    if(!changed)return json(409,{status:'approval_conflict'});
    // approve() persists both the review and its audit atomically.
    return json(200,{status:'ready',state:'human_reviewed_dispatch_blocked',intent_id:row.id,real_dispatch_enabled:false,external_request_attempted:false});
   }
   const review_session_active=bindingProof&&row.reviewed_by===actor.sub&&UUID.test(row.review_session_id||'')?await reviewSessionActive(row.owner_id,row.review_session_id):false;
   await audit(actor,row.id,bindingProof?(human?'human_preview':'status'):b.action);
   return json(200,{status:'ready',intent_id:row.id,payload:row.payload,payload_sha256:row.payload_sha256,state:row.state,expires_at:row.expires_at,...(bindingProof?{owner_id:row.owner_id,reviewed_by:row.reviewed_by,review_session_id:row.review_session_id,review_session_active,actor:{id:actor.sub,client_id:actor.client_id,session_id:actor.session_id,auth_time:actor.auth_time,password_amr:actor.human,session_active:actor.session_active===true}}:{}),...(human?{attachment_base64:row.attachment_base64}:{}),real_dispatch_enabled:false,coordinator_verified:false,external_request_attempted:false});
  }catch(error){return json(error?.message==='invalid_attachment'?400:503,{status:error?.message==='invalid_attachment'?'invalid_attachment':'intent_backend_unavailable'});}
 };
}

