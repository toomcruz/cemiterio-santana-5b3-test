import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupervisedOfficialHandler} from './official-adapter.mjs';
const ID='10000000-0000-4000-8000-000000000001',SUB='10000000-0000-4000-8000-000000000002',SID='10000000-0000-4000-8000-000000000003';
const CID='10000000-0000-4000-8000-000000000004',CLAIM='10000000-0000-4000-8000-000000000005',CLIENT='ccb5e1fc-2a61-4296-943a-a85c103e9313',HASH='a'.repeat(64);
const PROD='synthetic-production-session-token',HUMAN='synthetic-homolog-human-session',OAUTH='synthetic-chatgpt-oauth-session';
function setup(options={}){
 const now=Date.now();let operation=null,count=0;const requests=[],events=[];
 const proof={owner_id:SUB,reviewed_by:SUB,review_session_id:SID,review_session_active:true,state:'human_reviewed_dispatch_blocked',payload_sha256:HASH,expires_at:new Date(now+300000).toISOString(),payload:{conversation_id:CID,recipient:{name:'Synthetic','phone_mask':'***0200'},expected_revision:7,text:'Synthetic supervised message',attachment:null},...options.proof};
 const deps={now:()=>now,prodIdentity:async t=>t===PROD?{id:ID,session_id:SID,active:true,session_active:!options.revoked}:null,
  homologIdentity:async(t,{human})=>t===(human?HUMAN:OAUTH)?{id:SUB,client_id:human?null:CLIENT,session_id:SID,session_active:!options.revoked,password_amr:human,auth_time:now/1000}:null,
  reviewProof:async()=>proof,
  rpc:async p=>{
   events.push(p.operation);
   if(p.operation==='authorize'){operation={...p,state:'authorized'};return{status:'authorized',operation_id:p.operation_id};}
   if(!operation||operation.subject_id!==p.subject_id)throw Error('NO_AUTHORIZATION');
   if(p.operation==='status')return{state:operation.state,delivery_confirmed:false};
   if(p.operation==='prepare'){
    if(options.busy)throw Error('MCP_CONCURRENT_OR_AMBIGUOUS_DELIVERY');
    if(options.stale)throw Error('MCP_RECIPIENT_CONTENT_OR_REVISION_CHANGED');
    if(operation.state!=='authorized')return{status:'duplicate',delivery_state:operation.state==='dispatching'?'unknown':operation.state};
    operation.state='dispatching';
    return {status:'prepared',delivery_state:'dispatching',no_send:false,claim_token:CLAIM,recipient_e164:'+12025550200',text:operation.payload.text};
   }
   if(p.operation==='settle'){operation.state=p.outcome;return{status:'committed',delivery_state:p.outcome};}
   throw Error('INVALID_RPC');
  },officialConfig:{production:true,token:'synthetic-only',instance:'synthetic'},
  transport:async(url,init)=>{count++;requests.push({url,body:JSON.parse(init.body)});if(options.timeout)throw Error('synthetic timeout');return Response.json(options.provider??{messageId:'synthetic-provider-id'});}
 };
 const handler=createSupervisedOfficialHandler(deps);
 const call=(action,body={},token=action==='authorize'?PROD:OAUTH)=>handler(new Request('https://synthetic.invalid/internal',{method:'POST',headers:{authorization:'Bearer '+token,'x-santana-human-review':HUMAN},body:JSON.stringify({action,operation_id:ID,payload_sha256:HASH,...(action==='authorize'?{explicit_authorization:'one_real_text_attempt'}:{}),...body})}));
 return{call,requests,events,count:()=>count};
}
test('full authorization -> exact official sender -> provider acceptance -> status; no delivery assertion',async()=>{
 const s=setup();assert.equal((await s.call('authorize')).status,200);const r=await(await s.call('send')).json();assert.equal(r.delivery_state,'sent');assert.equal(r.delivery_confirmed,false);assert.equal(s.count(),1);assert.match(s.requests[0].url,/api.w-api.app\/v1\/message\/send-text/);assert.equal(s.requests[0].body.phone,'12025550200');assert.equal(s.requests[0].body.message,'Synthetic supervised message');assert.equal((await(await s.call('status')).json()).state,'sent');
});
test('HOMOLOG OAuth cannot act as PROD operator or independent human',async()=>{
 const s=setup();assert.equal((await s.call('authorize',{},OAUTH)).status,403);assert.equal(s.count(),0);
});
test('specific authorization and an existing operator session are mandatory',async()=>{
 for(const [options,body] of [[{}, {explicit_authorization:null}],[{revoked:true},{}]]){const s=setup(options);assert.equal((await s.call('authorize',body)).status,403);assert.equal(s.count(),0);}
});
test('changed digest, attachment or expired review cannot authorize',async()=>{
 for(const proof of [{payload_sha256:'b'.repeat(64)},{expires_at:new Date(0).toISOString()},{payload:{attachment:{name:'unqualified.pdf'}}}]){const s=setup({proof});assert.equal((await s.call('authorize')).status,409);assert.equal(s.count(),0);}
});
test('stale revision and prior concurrent claims stop before any provider call',async()=>{
 for(const options of [{stale:true},{busy:true}]){const s=setup(options);await s.call('authorize');assert.equal((await s.call('send')).status,409);assert.equal(s.count(),0);}
});
test('two simultaneous invocations cause one provider request',async()=>{
 const s=setup();await s.call('authorize');await Promise.all([s.call('send'),s.call('send')]);assert.equal(s.count(),1);
});
test('timeout or malformed success settles unknown and repeat never resends',async()=>{
 for(const options of [{timeout:true},{provider:{}}]){const s=setup(options);await s.call('authorize');assert.equal((await(await s.call('send')).json()).delivery_state,'unknown');await s.call('send');assert.equal(s.count(),1);}
});
test('caller cannot substitute text, operator or phone; missing backend permission blocks',async()=>{
 const s=setup();assert.equal((await s.call('send',{text:'changed'})).status,400);assert.equal((await s.call('send',{operator_id:ID})).status,400);assert.equal((await s.call('send')).status,409);assert.equal(s.count(),0);
});
