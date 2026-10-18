import test from 'node:test';import assert from 'node:assert/strict';
import {createIntentHandler} from './homolog/send-intents-core.mjs';
import {mcpOfficialOperation} from './edge-operations.ts';
import {officialSupervisedBinding} from './vercel-binding.ts';
const ID='10000000-0000-4000-8000-000000000001',SUB='10000000-0000-4000-8000-000000000002',SID='10000000-0000-4000-8000-000000000003',CID='10000000-0000-4000-8000-000000000004',ACTOR='10000000-0000-4000-8000-000000000005';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313',HASH='a'.repeat(64),HUMAN='synthetic-homolog-human-session',OAUTH='synthetic-chatgpt-oauth-session';
const jwt=claims=>'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic_signature';
const PROD=jwt({sub:ACTOR,iss:'https://sfoygvjtnwqvudrbgoom.supabase.co/auth/v1',aud:'authenticated',exp:Date.now()/1000+3600,session_id:SID});
function setup(options={}){
 let op=null,count=0;
 const row={id:ID,owner_id:SUB,client_id:CLIENT,reviewed_by:SUB,review_session_id:SID,state:'human_reviewed_dispatch_blocked',payload_sha256:HASH,expires_at:new Date(Date.now()+300000).toISOString(),payload:{conversation_id:CID,expected_revision:7,recipient:{name:'Synthetic','phone_mask':'***0200'},text:'Synthetic supervised binding',attachment:null}};
 const hmg=createIntentHandler({authenticate:async token=>options.hmgRevoked?null:token===HUMAN?{sub:SUB,client_id:null,human:true,session_id:SID,auth_time:Date.now()/1000,session_active:true}:token===OAUTH?{sub:SUB,client_id:CLIENT,oauth:true,session_id:SID,session_active:true}:null,get:async(_,owner)=>owner===SUB?row:null,audit:async()=>{}});
 const transport=async(url,init)=>{if(url==='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read'){const b=JSON.parse(init.body);delete b.mode;return hmg(new Request(url,{...init,body:JSON.stringify(b)}));}if(url.startsWith('https://api.w-api.app/')){count++;return Response.json({messageId:'synthetic-binding-id'});}throw Error('NO_OTHER_NETWORK_ALLOWED');};
 const service={auth:{getUser:async token=>({data:{user:token===PROD?{id:ACTOR,app_metadata:{sana_panel_operator:true}}:null},error:token!==PROD})},from:table=>{const chain={select:()=>chain,eq:()=>chain,gt:()=>chain,maybeSingle:async()=>({data:table==='support_members'?{is_active:!options.prodRevoked,approval_status:'approved',permissions:['atendimentos']}:options.wrongBinding?null:{operator_id:ACTOR},error:null})};return chain;},rpc:async(name,{p})=>{
  if(name==='sana_mcp_session_active')return{data:!options.prodRevoked,error:null};
  if(p.operation==='authorize'){op={...p,state:'authorized'};return{data:{status:'authorized',operation_id:ID}};}
  if(!op)return{error:{message:'MCP_OPERATION_NOT_AVAILABLE'}};
  if(p.operation==='prepare'){if(op.state!=='authorized')return{data:{status:'duplicate',delivery_state:op.state}};op.state='dispatching';return{data:{status:'prepared',delivery_state:'dispatching',no_send:false,claim_token:SID,recipient_e164:'+12025550200',text:row.payload.text}};}
  if(p.operation==='settle'){op.state=p.outcome;return{data:{status:'committed',delivery_state:p.outcome}};}
  return{data:{state:op.state,delivery_confirmed:false}};
 }};
 const call=async action=>{
  const token=action==='authorize'?PROD:OAUTH;
  const request=new Request('https://synthetic.invalid/internal',{method:'POST',headers:{authorization:'Bearer '+token,'x-santana-human-review':HUMAN},body:JSON.stringify({action,operation_id:ID,payload_sha256:HASH,...(action==='authorize'?{explicit_authorization:'one_real_text_attempt'}:{})})});
  const invoke=async body=>{const response=await mcpOfficialOperation(new Request('https://synthetic.invalid/edge',{method:'POST',headers:request.headers}),body,service,transport);return{response,data:await response.json()};};
  return officialSupervisedBinding(request,invoke,{production:true,token:'synthetic-provider-only',instance:'synthetic'},transport);
 };
 return{call,count:()=>count};
}
test('existing HMG proof -> PROD operator gate -> coordinator -> existing official emitter, fully simulated',async()=>{const s=setup();assert.equal((await s.call('authorize')).status,200);assert.equal((await(await s.call('send')).json()).delivery_state,'sent');assert.equal(s.count(),1);await s.call('send');assert.equal(s.count(),1);});
test('revoked HMG, revoked PROD and wrong identity binding never reach provider',async()=>{for(const o of [{hmgRevoked:true},{prodRevoked:true},{wrongBinding:true}]){const s=setup(o);assert.notEqual((await s.call('authorize')).status,200);assert.equal(s.count(),0);}});
