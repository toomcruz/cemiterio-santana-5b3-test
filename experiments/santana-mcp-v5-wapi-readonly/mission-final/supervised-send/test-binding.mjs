import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';
import {createIntentHandler} from './homolog/send-intents-core.mjs';
import {mcpOfficialOperation} from './edge-operations.ts';
import {officialSupervisedBinding} from './vercel-binding.ts';
const ID='10000000-0000-4000-8000-000000000001',SUB='10000000-0000-4000-8000-000000000002',SID='10000000-0000-4000-8000-000000000003',CID='10000000-0000-4000-8000-000000000004',ACTOR='10000000-0000-4000-8000-000000000005';
const CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313',HASH='a'.repeat(64),HUMAN='synthetic-homolog-human-session',OAUTH='synthetic-chatgpt-oauth-session';
const jwt=claims=>'e30.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.synthetic_signature';
const PROD=jwt({sub:ACTOR,iss:'https://sfoygvjtnwqvudrbgoom.supabase.co/auth/v1',aud:'authenticated',exp:Date.now()/1000+3600,session_id:SID});
const fixtures=JSON.parse(readFileSync(new URL('./media-fixtures/fixtures.json',import.meta.url),'utf8'));
function setup(options={}){
 let op=null,count=0,staged=null,stored=null;const requests=[];
 const row={id:ID,owner_id:SUB,client_id:CLIENT,reviewed_by:SUB,review_session_id:SID,state:'human_reviewed_dispatch_blocked',payload_sha256:HASH,expires_at:new Date(Date.now()+300000).toISOString(),payload:{conversation_id:CID,expected_revision:7,recipient:{name:'Synthetic','phone_mask':'***0200'},text:'Synthetic supervised binding',attachment:null}};
 if(options.fixture){const f=fixtures[options.fixture];row.payload.attachment={name:options.fixture,mime_type:f.mime_type,size_bytes:f.size_bytes,sha256:f.sha256};row.attachment_base64=f.content_base64;}
 const hmg=createIntentHandler({authenticate:async token=>options.hmgRevoked?null:token===HUMAN?{sub:SUB,client_id:null,human:true,session_id:options.renewedSession?ACTOR:SID,auth_time:Date.now()/1000,session_active:true}:token===OAUTH?{sub:SUB,client_id:CLIENT,oauth:true,session_id:SID,session_active:true}:null,get:async(_,owner)=>owner===SUB?row:null,audit:async()=>{},reviewSessionActive:async(owner,session)=>owner===SUB&&session===SID&&!options.reviewSessionRevoked});
 const transport=async(url,init)=>{if(url==='https://xdccjulfqcqefykunwtg.supabase.co/functions/v1/sana-mcp-read'){const b=JSON.parse(init.body);delete b.mode;return hmg(new Request(url,{...init,body:JSON.stringify(b)}));}if(url.startsWith('https://api.w-api.app/')){count++;requests.push({url,body:JSON.parse(init.body)});return Response.json({messageId:'synthetic-binding-id'});}throw Error('NO_OTHER_NETWORK_ALLOWED');};
 const service={storage:{from:()=>({download:async()=>stored?{data:new Blob([stored],{type:row.payload.attachment.mime_type})}:{error:{statusCode:404}},upload:async(path,bytes,opts)=>{assert.equal(opts.upsert,false);stored=options.corruptStored?new Uint8Array(bytes.length):bytes;return{};},createSignedUrl:async path=>({data:{signedUrl:'https://sfoygvjtnwqvudrbgoom.supabase.co/storage/v1/object/sign/sana-operator-attachments/'+path+'?token=synthetic-only'}})})},auth:{getUser:async token=>({data:{user:token===PROD?{id:ACTOR,app_metadata:{sana_panel_operator:true}}:null},error:token!==PROD})},from:table=>{const chain={select:()=>chain,eq:()=>chain,gt:()=>chain,update:v=>{Object.assign(staged,v);return chain;},maybeSingle:async()=>({data:table==='support_members'?{is_active:!options.prodRevoked,approval_status:'approved',permissions:['atendimentos']}:table==='sana_mcp_send_permissions'?{live_enabled:!options.disabled}:table==='sana_mcp_send_operations'?op:table==='sana_operator_attachments'?staged:options.wrongBinding?null:{operator_id:ACTOR},error:null})};return chain;},rpc:async(name,args)=>{const {p}=args;
  if(name==='sana_stage_operator_attachment'){staged={artifact_id:SID,actor_id:ACTOR,action_id:ID,conversation_id:CID,file_name:args.p_name,mime_type:args.p_mime,size_bytes:args.p_size,sha256:args.p_hash,created_at:new Date().toISOString(),verified_at:null,storage_path:`${ACTOR}/${CID}/${ID}.${args.p_mime==='application/pdf'?'pdf':'png'}`};return{data:{status:'ready',artifact_id:SID,storage_path:staged.storage_path}};}
  if(name==='sana_mcp_session_active')return{data:!options.prodRevoked,error:null};
  if(p.operation==='authorize'){op={...p,state:'authorized'};return{data:{status:'authorized',operation_id:ID}};}
  if(!op)return{error:{message:'MCP_OPERATION_NOT_AVAILABLE'}};
  if(p.operation==='prepare'){if(op.state!=='authorized')return{data:{status:'duplicate',delivery_state:op.state}};op.state='dispatching';return{data:{status:'prepared',delivery_state:'dispatching',no_send:false,claim_token:SID,recipient_e164:'+12025550200',text:row.payload.text,attachment_id:op.attachment_id}};}
  if(p.operation==='settle'){op.state=p.outcome;return{data:{status:'committed',delivery_state:p.outcome}};}
  return{data:{state:op.state,delivery_confirmed:false,attachment_id:op.attachment_id}};
 }};
 const call=async action=>{
  const token=action==='authorize'?PROD:OAUTH;
  const request=new Request('https://synthetic.invalid/internal',{method:'POST',headers:{authorization:'Bearer '+token,'x-santana-human-review':HUMAN},body:JSON.stringify({action,operation_id:ID,payload_sha256:HASH,...(action==='authorize'?{explicit_authorization:!options.fixture?'one_real_text_attempt':options.fixture.endsWith('.pdf')?'one_real_document_attempt':'one_real_image_attempt'}:{})})});
  const invoke=async body=>{const response=await mcpOfficialOperation(new Request('https://synthetic.invalid/edge',{method:'POST',headers:request.headers}),body,service,transport);return{response,data:await response.json()};};
  return officialSupervisedBinding(request,invoke,{production:true,token:'synthetic-provider-only',instance:'synthetic'},transport);
 };
 return{call,count:()=>count,requests};
}
test('existing HMG proof -> PROD operator gate -> coordinator -> existing official emitter, fully simulated',async()=>{const s=setup();assert.equal((await s.call('authorize')).status,200);assert.equal((await(await s.call('send')).json()).delivery_state,'sent');assert.equal(s.count(),1);await s.call('send');assert.equal(s.count(),1);});
test('revoked HMG, revoked PROD and wrong identity binding never reach provider',async()=>{for(const o of [{hmgRevoked:true},{prodRevoked:true},{wrongBinding:true}]){const s=setup(o);assert.notEqual((await s.call('authorize')).status,200);assert.equal(s.count(),0);}});

test("fresh login of the same reviewer preserves exact review only while original session remains active",async()=>{const s=setup({renewedSession:true});assert.equal((await s.call("authorize")).status,200);assert.equal(s.count(),0);for(const o of [{renewedSession:true,reviewSessionRevoked:true},{reviewSessionRevoked:true}]){const denied=setup(o);assert.notEqual((await denied.call("authorize")).status,200);assert.equal(denied.count(),0);}});

for(const fixture of Object.keys(fixtures))test(fixture+': complete HMG human proof -> private canonical attachment -> PROD consent -> official emitter, simulated',async()=>{
 const s=setup({fixture});assert.equal((await s.call('authorize')).status,200);const result=await(await s.call('send')).json();assert.equal(result.delivery_state,'sent');assert.equal(result.delivery_confirmed,false);assert.equal(s.count(),1);assert.equal(s.requests[0].body.caption,'Synthetic supervised binding');assert.match(s.requests[0].url,fixture.endsWith('.pdf')?/send-document/:/send-image/);await s.call('send');assert.equal(s.count(),1);
});
test('corrupt upload or closed live permission cannot authorize media or reach provider',async()=>{for(const options of [{corruptStored:true},{disabled:true}]){const s=setup({fixture:'Santana-Teste-Imagem.png',...options});assert.notEqual((await s.call('authorize')).status,200);assert.equal(s.count(),0);}});
