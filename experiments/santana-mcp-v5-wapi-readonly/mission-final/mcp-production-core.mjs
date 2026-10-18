const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const S='sana_panel_fast_snapshot';
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const mask=value=>typeof value==='string'?'+••••••'+value.replace(/\D/g,'').slice(-4):null;
const conv=c=>({conversation_id:c.conversation_id,contact_key:mask(c.contact_key),name_available:Boolean(c.contact_name),name:c.contact_name||null,lifecycle:c.lifecycle,automation_mode:c.automation_available===false?'human':c.automation_mode,human_paused:c.automation_available===false||c.automation_mode==='human',automation_available:c.automation_available!==false,revision:c.revision,updated_at:c.updated_at});
export function createProductionReadHandler({authenticate,grants,quota,snapshot,audit}) {
 return async req=>{
  if(req.method!=='POST')return response(405,{status:'method_not_allowed'});
  if(req.headers.has('origin'))return response(403,{status:'origin_denied'});
  const bearer=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(req.headers.get('authorization')||'');
  if(!bearer)return response(401,{status:'unauthorized'});
  if(Number(req.headers.get('content-length')||0)>4096)return response(413,{status:'request_too_large'});
  let b;try{const raw=await req.text();if(raw.length>4096)return response(413,{status:'request_too_large'});b=JSON.parse(raw);}catch{return response(400,{status:'bad_request'});}
  if(!b||typeof b!=='object'||Array.isArray(b)||!['conversations','contact','messages','files'].includes(b.mode))return response(400,{status:'bad_request'});
  const allowed=b.mode==='conversations'?['mode','page','per_page']:b.mode==='contact'?['mode','conversation_id']:['mode','conversation_id','limit','before','before_key',...(b.mode==='messages'?['include_content']:[])];
  if(Object.keys(b).some(k=>!allowed.includes(k))||b.mode!=='conversations'&&!UUID.test(b.conversation_id||''))return response(400,{status:'bad_request'});
  if(b.include_content!==undefined&&typeof b.include_content!=='boolean')return response(400,{status:'bad_request'});
  const include=b.mode==='messages'&&b.include_content===true;
  const limit=b.limit??(include?20:100),page=b.page??1,perPage=b.per_page??20;
  if(!Number.isInteger(limit)||limit<1||limit>(include?20:100)||!Number.isInteger(page)||page<1||page>10||!Number.isInteger(perPage)||perPage<1||perPage>50)return response(400,{status:'bad_request'});
  const before=b.before??null,key=b.before_key??null;
  if((before===null)!==(key===null)||before!==null&&(typeof before!=='string'||!Number.isFinite(Date.parse(before))||typeof key!=='string'||!key||key.length>200))return response(400,{status:'bad_request'});
  let actor,access;
  try{actor=await authenticate(bearer[1]);}catch{return response(401,{status:'unauthorized'});}
  if(!actor)return response(401,{status:'unauthorized'});
  try{access=await grants(actor);}catch{return response(503,{status:'authorization_unavailable'});}
  if(!access?.length)return response(404,{status:'identity_unbound'});
  const scope=b.mode==='messages'?(include?'santana.messages.read_content':'santana.messages.read_metadata'):b.mode==='files'?'santana.files.read_metadata':'santana.conversations.read';
  const authorized=access.filter(g=>g.scopes.includes(scope));
  const target=b.mode==='conversations'?authorized:authorized.filter(g=>g.conversation_id===b.conversation_id);
  if(!target.length)return response(403,{status:'read_access_denied',required_scope:scope});
  try{if(!await quota(actor,include?5:b.mode==='files'?10:30))return response(429,{status:'rate_limited'});}catch{return response(503,{status:'quota_unavailable'});}
  try{
   if(b.mode==='conversations'){
    const start=(page-1)*perPage,selected=target.slice(start,start+perPage),items=[];
    for(const grant of selected){const s=await snapshot(grant.conversation_id,null,null);const c=s.conversations?.find(c=>c.conversation_id===grant.conversation_id);if(c&&c.technical!==true)items.push(conv(c));}
    await audit(actor,b.mode,null,items.length,'allowed');
    return response(200,{status:'ready',source:S,environment:'production',items,page,per_page:perPage,has_more:start+perPage<target.length});
   }
   const s=await snapshot(b.conversation_id,before,key),c=s.conversations?.find(c=>c.conversation_id===b.conversation_id);
   if(!c||c.technical===true)return response(404,{status:'not_found'});
   if(b.mode==='contact'){await audit(actor,b.mode,b.conversation_id,1,'allowed');return response(200,{status:'ready',source:S,environment:'production',contact:conv(c)});}
   const history=(s.history??[]).filter(m=>m.hidden!==true),selected=history.slice(-limit);
   const hasMore=history.length>selected.length||Boolean(s.has_more_messages);
   const first=selected[0];
   const cursor=hasMore?(history.length>selected.length?{before:first?.created_at,before_key:first?.message_key}:{before:s.next_cursor?.before,before_key:s.next_cursor?.key??s.next_cursor?.before_key}):null;
   if(hasMore&&(!cursor?.before||!cursor?.before_key))return response(503,{status:'cursor_unavailable'});
   const items=b.mode==='messages'?selected.map(m=>({message_id:m.message_key,created_at:m.created_at,sender_role:m.sender_role,delivery_state:m.delivery_state,no_send:m.no_send,...(include?{inbound_text:m.inbound_text??null,response_text:m.response_text??null}:{})})):selected.flatMap(m=>(Array.isArray(m.attachments)?m.attachments:[]).filter(a=>a&&typeof a==='object').map(a=>({message_id:m.message_key,...Object.fromEntries(['artifact_id','type','file_name','mime_type','size_bytes','media_status'].filter(k=>['string','number','boolean'].includes(typeof a[k])).map(k=>[k,a[k]]))})));
   await audit(actor,b.mode,b.conversation_id,items.length,'allowed');
   return response(200,{status:'ready',source:S,environment:'production',conversation_id:b.conversation_id,items,has_more:hasMore,next_cursor:cursor,...(b.mode==='messages'?{content_included:include}:{count:items.length,continuation_required:hasMore})});
  }catch{return response(503,{status:'snapshot_unavailable'});}
 };
}
