import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
import {createProductionReadHandler} from './mcp-production-core.mjs';
const ISSUER='https://xdccjulfqcqefykunwtg.supabase.co/auth/v1';
const PUBLIC_KEY='sb_publishable_doiDzLKISweiTWKlFYFG6w_0PZjP1vw';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
export function productionMcpRead(req:Request,service:any){
 const auth=createClient(ISSUER.replace('/auth/v1',''),PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const handler=createProductionReadHandler({
  authenticate:async(token:string)=>{
   const {data,error}=await auth.auth.getUser(token);if(error||!data.user)return null;
   let c;try{c=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
   if(c.sub!==data.user.id||c.iss!==ISSUER||c.client_id!==CLIENT||c.aud!=='authenticated'||!Number.isFinite(c.exp)||c.exp<=Date.now()/1000||c.nbf&&c.nbf>Date.now()/1000)return null;
   return {issuer:ISSUER,subject:data.user.id,client_id:CLIENT};
  },
  grants:async(actor:any)=>{
   const {data,error}=await service.from('sana_mcp_read_access').select('operator_id,conversation_id,scopes').eq('issuer',actor.issuer).eq('subject_id',actor.subject).eq('client_id',actor.client_id).eq('is_active',true).gt('expires_at',new Date().toISOString()).limit(50);
   if(error)throw Error('authorization_unavailable');if(!data?.length)return [];
   const operator=data[0].operator_id;
   if(data.some((g:any)=>g.operator_id!==operator))return [];
   const u=await service.auth.admin.getUserById(operator);
   if(u.error||u.data.user?.app_metadata?.sana_panel_operator!==true)return [];
   const member=await service.from('support_members').select('is_active,approval_status,permissions').eq('user_id',operator).maybeSingle();
   if(member.error||!member.data?.is_active||member.data.approval_status!=='approved'||!member.data.permissions?.includes('atendimentos'))return [];
   actor.operator_id=operator;return data;
  },
  quota:async(actor:any,limit:number)=>{const {data,error}=await service.rpc('sana_mcp_read_rate_check',{p_subject:actor.subject,p_client:actor.client_id,p_limit:limit});if(error)throw Error('quota_unavailable');return data===true;},
  snapshot:async(id:string,before:string|null,key:string|null)=>{const {data,error}=await service.rpc('sana_panel_fast_snapshot',{p_id:id,p_view:'messages',p_before:before,p_before_key:key});if(error||!data||data.error)throw Error('snapshot_unavailable');return data;},
  audit:async(actor:any,operation:string,id:string|null,count:number,outcome:string)=>{const {error}=await service.from('sana_mcp_read_audit').insert({subject_id:actor.subject,client_id:actor.client_id,operator_id:actor.operator_id,operation,conversation_id:id,item_count:count,outcome});if(error)throw Error('audit_unavailable');},
 });
 return handler(req);
}
