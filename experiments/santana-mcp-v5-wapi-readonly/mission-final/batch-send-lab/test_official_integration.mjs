// Contract integration with the EXISTING official sender. Fetch is denied globally;
// only the explicitly injected synthetic transport can see a provider-shaped URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSupervisedOfficialHandler} from '../supervised-send/official-adapter.mjs';
import {classifyDelivery} from '../admin-assist/admin-core.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const demo=JSON.parse(execFileSync(process.env.SANTANA_TEST_PYTHON||'python3',[root+'demo.py'],{encoding:'utf8',maxBuffer:2000000}));
const SUB='10000000-0000-4000-8000-000000000002',SID='10000000-0000-4000-8000-000000000003',OPERATOR='10000000-0000-4000-8000-000000000004',CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313';
const TOKENS={oauth:'synthetic-chatgpt-oauth-session',human:'synthetic-human-review-session',production:'synthetic-production-operator-session'};
const HASH='a'.repeat(64);
function handlerFor(child,{timeout=false}={}){
 let operation=null;const sends=[];const now=Date.now();
 const payload={conversation_id:child.conversation_id,recipient:{name:child.name,phone_mask:'***'+child.phone.slice(-4)},expected_revision:child.expected_revision,text:child.text,attachment:null};
 const proof={owner_id:SUB,reviewed_by:SUB,review_session_id:SID,review_session_active:true,state:'human_reviewed_dispatch_blocked',payload_sha256:HASH,expires_at:new Date(now+300000).toISOString(),payload};
 const handler=createSupervisedOfficialHandler({now:()=>now,
  prodIdentity:async t=>t===TOKENS.production?{id:OPERATOR,session_id:SID,active:true,session_active:true}:null,
  homologIdentity:async(t,{human})=>t===(human?TOKENS.human:TOKENS.oauth)?{id:SUB,client_id:human?null:CLIENT,session_id:SID,session_active:true,password_amr:human,auth_time:now/1000}:null,
  reviewProof:async()=>proof,
  rpc:async p=>{
   if(p.operation==='authorize'){operation={...p,state:'authorized'};return{status:'authorized'};}
   if(!operation)throw Error('MCP_NO_AUTHORIZATION');
   if(p.operation==='status')return{state:operation.state};
   if(p.operation==='prepare'){
    if(operation.state!=='authorized')return{status:'duplicate',delivery_state:operation.state==='dispatching'?'unknown':operation.state};
    operation.state='dispatching';return{status:'prepared',delivery_state:'dispatching',no_send:false,claim_token:SID,recipient_e164:'+'+child.phone,text:child.text};
   }
   if(p.operation==='settle'){operation.state=p.outcome;return{status:'committed',delivery_state:p.outcome};}
   throw Error('INVALID_RPC');
  },officialConfig:{production:true,token:'synthetic-only',instance:'synthetic'},
  transport:async(url,init)=>{sends.push({url,body:JSON.parse(init.body)});if(timeout)throw Error('synthetic-timeout');return Response.json({messageId:'synthetic-'+child.operation_id});}
 });
 const call=async action=>{
  const r=await handler(new Request('https://synthetic.invalid/internal',{method:'POST',headers:{authorization:'Bearer '+(action==='authorize'?TOKENS.production:TOKENS.oauth),'x-santana-human-review':TOKENS.human},body:JSON.stringify({action,operation_id:child.operation_id,payload_sha256:HASH,...(action==='authorize'?{explicit_authorization:'one_real_text_attempt'}:{})})}));
  return{status:r.status,body:await r.json()};
 };
 return{call,sends};
}
test('all 50 LAB child operations preserve destination, body and idempotency through the existing official handler',async()=>{
 assert.equal(demo.contract_payloads.length,50);
 for(const child of demo.contract_payloads){
  const h=handlerFor(child);assert.equal((await h.call('authorize')).status,200);
  const r=await h.call('send');assert.equal(r.body.accepted_by_api,true);assert.equal(r.body.delivery_confirmed,false);
  await h.call('send');assert.equal(h.sends.length,1);
  assert.equal(h.sends[0].body.phone,child.phone);assert.equal(h.sends[0].body.message,child.text);
  assert.match(h.sends[0].url,/api\.w-api\.app\/v1\/message\/send-text/);
 }
});
test('existing official adapter preserves unknown results without another transport call',async()=>{
 const h=handlerFor(demo.contract_payloads[0],{timeout:true});await h.call('authorize');
 assert.equal((await h.call('send')).body.delivery_state,'unknown');await h.call('send');assert.equal(h.sends.length,1);
});
test('existing administrative classifier distinguishes pending, failed, unknown and accepted; generated text is not send evidence',()=>{
 const at=new Date().toISOString();
 assert.equal(classifyDelivery([]).state,'sem_resposta');
 const failed=classifyDelivery([{state:'FAILED',created_at:at}]);assert.notEqual(failed.state,'respondido_aceito');
 const unknown=classifyDelivery([{state:'UNKNOWN',created_at:at}]);assert.equal(unknown.send_allowed,false);
 const generated=classifyDelivery([{state:'GENERATED',created_at:at,response_text:'Sugestão fictícia'}]);assert.notEqual(generated.state,'respondido_aceito');
});
test('one review covers each immutable LAB manifest; tracking and timing cover the complete lot',()=>{
 for(const n of [1,2,10,50]){
  const d=demo.demos.find(x=>x.recipients===n);assert.equal(d.human_approvals,1);assert.equal(d.individual_attempts,n);assert.equal(d.distinct_operations,n);
  assert.equal(d.all_results_tracked,true);assert.equal(d.real_messages_sent,0);if(n>1)assert.ok(d.minimum_spacing_seconds>=2);
 }
});
