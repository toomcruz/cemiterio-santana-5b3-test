import {createIntentHandler} from './send-intents-core.mjs';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
export function sendIntent(request:Request,admin:any,verifier:any,issuer:string){
 return createIntentHandler({
  authenticate:async(token:string)=>{
   const {data,error}=await verifier.auth.getUser(token);if(error||!data.user)return null;
   let c;try{c=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
   if(c.sub!==data.user.id||c.iss!==issuer||c.aud!=='authenticated'||!Number.isFinite(c.exp)||c.exp<=Date.now()/1000||c.nbf&&c.nbf>Date.now()/1000)return null;
   const o=await admin.from('homolog_mcp_operators').select('is_active').eq('user_id',data.user.id).maybeSingle();
   if(o.error||!o.data?.is_active)return null;
   const session=await admin.rpc('sana_mcp_session_active',{p_owner:c.sub,p_session:c.session_id});
   if(session.error||session.data!==true)return null;
   const client=c.client_id??c.azp;
   const password=Array.isArray(c.amr)?c.amr.find((x:any)=>x.method==='password'):null;
   return {sub:c.sub,client_id:client??null,oauth:client===CLIENT,human:!client&&Boolean(password),session_id:c.session_id,auth_time:password?.timestamp,session_active:true};
  },
  contact:async(token:string,id:string)=>{
   const r=await fetch('https://sfoygvjtnwqvudrbgoom.supabase.co/functions/v1/sana-panel-preview-login/mcp-read',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({mode:'contact',conversation_id:id})});
   const d=await r.json();return r.ok&&d.source==='sana_panel_fast_snapshot'?d.contact:null;
  },
  save:async(row:any)=>{
   const existing=await admin.from('homolog_mcp_send_intents').select('*').eq('owner_id',row.owner_id).eq('client_id',row.client_id).eq('idempotency_key',row.idempotency_key).maybeSingle();
   if(existing.error)throw Error('persistence');if(existing.data)return existing.data;
   const count=await admin.from('homolog_mcp_send_intents').select('id',{count:'exact',head:true}).eq('owner_id',row.owner_id).gt('expires_at',new Date().toISOString());
   if(count.error||count.count>=50)throw Error('capacity');
   const v=await admin.from('homolog_mcp_send_intents').upsert(row,{onConflict:'owner_id,client_id,idempotency_key',ignoreDuplicates:true});
   if(v.error)throw Error('persistence');
   const r=await admin.from('homolog_mcp_send_intents').select('*').eq('owner_id',row.owner_id).eq('client_id',row.client_id).eq('idempotency_key',row.idempotency_key).single();if(r.error)throw Error('persistence');return r.data;
  },
  get:async(id:string,owner:string)=>{const r=await admin.from('homolog_mcp_send_intents').select('*').eq('id',id).eq('owner_id',owner).maybeSingle();if(r.error)throw Error('persistence');return r.data;},
  approve:async(id:string,owner:string,session:string,sha:string)=>{
   const r=await admin.rpc('sana_mcp_review_intent_atomic',{p_owner:owner,p_intent:id,p_session:session,p_digest:sha});
   if(r.error)throw Error('review_persistence');return r.data===true;
  },
  audit:async(actor:any,intent:string,operation:string)=>{const r=await admin.from('homolog_mcp_send_audit').insert({owner_id:actor.sub,intent_id:intent,operation,session_id:actor.human?actor.session_id:null});if(r.error)throw Error('audit');},
 })(request);
}

