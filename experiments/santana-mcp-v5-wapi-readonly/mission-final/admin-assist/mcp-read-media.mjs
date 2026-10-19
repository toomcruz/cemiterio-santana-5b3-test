// Read-only addition to the existing Panel media route. Uses its native helpers.
const EDGE='https://sfoygvjtnwqvudrbgoom.supabase.co/functions/v1/sana-panel-preview-login';
const MAX=2*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(status,code)=>Response.json({status:code},{status,headers:{'cache-control':'no-store'}});
export async function mcpReadMedia(request,d){
 if(request.headers.has('origin'))return json(403,'MCP_ADMIN_ORIGIN_DENIED');
 if(d.environment!=='production')return json(403,'MCP_ADMIN_MEDIA_DISABLED');
 const bearer=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9._~-]{20,16384}$/.test(bearer))return json(401,'MCP_ADMIN_UNAUTHORIZED');
 let b;try{const raw=await request.text();if(raw.length>4096)return json(413,'MCP_ADMIN_TOO_LARGE');b=JSON.parse(raw);}catch{return json(400,'MCP_ADMIN_INVALID_REQUEST');}
 if(!b||Object.keys(b).some(k=>!['conversation_id','message_key','artifact_id'].includes(k))||!UUID.test(b.conversation_id||'')||typeof b.message_key!=='string'||!b.message_key||b.message_key.length>100||typeof b.artifact_id!=='string'||!b.artifact_id||b.artifact_id.length>512)return json(400,'MCP_ADMIN_INVALID_REQUEST');
 const caller=d.caller?.trim(),instance=d.instance?.trim(),token=d.token?.trim();
 if(!caller||!instance||!token)return json(503,'MCP_ADMIN_MEDIA_UNAVAILABLE');
 const transport=d.transport||fetch;
 async function scope(action,extra={}){
  const r=await transport(EDGE,{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:bearer,'x-sana-prod-token':caller,'content-type':'application/json'},body:JSON.stringify({action,...b,...extra})});
  if(!r.ok)throw Error([401,403,404].includes(r.status)?'MCP_ADMIN_ATTACHMENT_DENIED':r.status===429?'MCP_ADMIN_RATE_LIMITED':'MCP_ADMIN_SOURCE_UNAVAILABLE');return r.json();
 }
 try{
  const s=await scope('operator_mcp_attachment_reference');
  if(!['image','document'].includes(s.type))return json(415,'MCP_ADMIN_MEDIA_TYPE_UNSUPPORTED');
  const ref=d.mediaReference(s.provider)||await d.recoverMediaReference(instance,token,s.external_message_id,s.phone);
  if(!ref||!['image/png','image/jpeg','image/webp','application/pdf'].includes(ref.mimetype.toLowerCase()))return json(404,'MCP_ADMIN_ATTACHMENT_UNAVAILABLE');
  const url=await d.downloadMedia(ref,instance,token);
  if(!url)return json(404,'MCP_ADMIN_ATTACHMENT_UNAVAILABLE');
  // Native helper already validates this; keep the same boundary independently.
  const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='api.w-api.app'||u.port||u.username||u.password||!u.pathname.startsWith('/media/file/'))throw Error('MCP_ADMIN_ATTACHMENT_DENIED');
  const response=await transport(u,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const file=ref.mimetype.toLowerCase()==='application/pdf'?await d.pdfBytes(response,MAX):await d.imageBytes(response,MAX);
  if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(file.type)||file.bytes.length>MAX)throw Error('MCP_ADMIN_ATTACHMENT_DENIED');
  const digest=await crypto.subtle.digest('SHA-256',file.bytes);const sha=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  if(s.sha256&&s.sha256!==sha)throw Error('MCP_ADMIN_ATTACHMENT_DENIED');
  // Recheck revocation/ownership and commit the file-read audit before release.
  await scope('operator_mcp_attachment_record',{sha256:sha});
  return new Response(file.bytes,{headers:{'content-type':file.type,'content-length':String(file.bytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-santana-artifact-sha256':sha}});
 }catch(error){
  const code=error?.name==='TimeoutError'||error?.name==='AbortError'?'MCP_ADMIN_ATTACHMENT_TIMEOUT':
   error instanceof Error&&/^MCP_ADMIN_[A-Z_]{1,64}$/.test(error.message)?error.message:
   /^(?:PDF|IMAGE)_TOO_LARGE$/.test(error?.message||'')?'MCP_ADMIN_ATTACHMENT_TOO_LARGE':'MCP_ADMIN_MEDIA_UNAVAILABLE';
  const status=code==='MCP_ADMIN_ATTACHMENT_DENIED'?403:code==='MCP_ADMIN_RATE_LIMITED'?429:code==='MCP_ADMIN_ATTACHMENT_TIMEOUT'?504:code==='MCP_ADMIN_ATTACHMENT_TOO_LARGE'?413:503;
  return json(status,code);
 }
}
