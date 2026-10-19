import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
import {createAdminHandler} from './mcp-admin-core.mjs';
import {productionMcpRead as legacyRead} from './mcp-production.ts';
import {federatedAuthenticator,productionIdentity} from './mcp-admin-identity.mjs';
import CATALOG from './mcp-rule-catalog.json' with {type:'json'};
const ISSUER='https://xdccjulfqcqefykunwtg.supabase.co/auth/v1';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
const PUBLIC='sb_publishable_doiDzLKISweiTWKlFYFG6w_0PZjP1vw';
const MEDIA='https://atendimento-cemiterio-santana.vercel.app/api/runtime/sana-media';
const verifier=createClient(ISSUER.replace('/auth/v1',''),PUBLIC,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const actor=federatedAuthenticator(verifier,ISSUER,CLIENT);
async function identity(service:any,a:any){
 return productionIdentity(service,a,CLIENT);
}
export async function administrativeMcpRead(req:Request,service:any){
 const read=async(a:any,mode:string,args:any)=>{
  await identity(service,a);
  const r=await service.rpc('sana_mcp_admin_read',{p_subject:a.subject,p_client:CLIENT,p_mode:mode,p_args:args});
  if(r.error)throw Error(/^MCP_ADMIN_[A-Z_]+$/.test(r.error.message??'')?r.error.message:'MCP_ADMIN_SOURCE_UNAVAILABLE');
  if(r.data?.status!=='ready')throw Error('MCP_ADMIN_SOURCE_UNAVAILABLE');return r.data.data;
 };
 return createAdminHandler({authenticate:actor,read,catalog:CATALOG,legacy:(r:Request)=>legacyRead(r,service),readAttachment:async(token:string,args:any)=>{
  const r=await fetch(MEDIA,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(26000),headers:{authorization:'Bearer '+token,'content-type':'application/json','x-santana-mcp-read':'1'},body:JSON.stringify({conversation_id:args.conversation_id,message_key:args.message_key,artifact_id:args.artifact_id})});
  if(!r.ok||!r.body)throw Error('MCP_ADMIN_ATTACHMENT_UNAVAILABLE');
  const reader=r.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>2097152)throw Error('MCP_ADMIN_ATTACHMENT_TOO_LARGE');chunks.push(n.value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(!size||sha!==r.headers.get('x-santana-artifact-sha256'))throw Error('MCP_ADMIN_ATTACHMENT_INTEGRITY');
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return{conversation_id:args.conversation_id,message_key:args.message_key,artifact_id:args.artifact_id,mime_type:r.headers.get('content-type'),size_bytes:size,sha256:sha,content_base64:btoa(binary)};
 }})(req);
}
export async function administrativeAttachment(req:Request,b:any,service:any){
 try{
  if(Object.keys(b).some(k=>!['action','conversation_id','message_key','artifact_id','sha256'].includes(k)))throw Error('MCP_ADMIN_INVALID_REQUEST');
  const a=await actor((req.headers.get('authorization')||'').replace(/^Bearer /,''));if(!a)return Response.json({status:'unauthorized'},{status:401});
  await identity(service,a);
  const {action,...args}=b;
  const r=await service.rpc('sana_mcp_admin_read',{p_subject:a.subject,p_client:CLIENT,p_mode:action==='operator_mcp_attachment_record'?'attachment_record':'attachment_reference',p_args:args});
  if(r.error)throw Error('MCP_ADMIN_ATTACHMENT_DENIED');
  return Response.json(r.data.data,{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({status:'MCP_ADMIN_ATTACHMENT_DENIED'},{status:403,headers:{'cache-control':'no-store'}});}
}
