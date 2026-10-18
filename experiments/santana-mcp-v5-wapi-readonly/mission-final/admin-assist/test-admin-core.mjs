import test from'node:test';import assert from'node:assert/strict';
import{classifyDelivery,createAdminHandler,selectRules,validateRequest}from'./admin-core.mjs';
import{federatedAuthenticator,productionIdentity}from'./identity-core.mjs';
const NOW=Date.parse('2026-10-18T21:00:00Z'),ID='20000000-0000-4000-8000-000000000001';
const event=(state,extra={})=>({id:state,created_at:'2026-10-18T20:59:30Z',state,covers_latest:true,...extra});
test('delivery classification is conservative, causally grounded and distinguishes acceptance from delivery',()=>{
 assert.equal(classifyDelivery([],NOW).state,'sem_resposta');
 assert.equal(classifyDelivery([event('SENT')],NOW).delivery_confirmed,false);
 assert.equal(classifyDelivery([event('SENT',{covers_latest:false})],NOW).state,'sem_resposta');
 assert.equal(classifyDelivery([event('SENT',{delivered_at:'2026-10-18T20:59:31Z'})],NOW).delivery_confirmed,true);
 assert.equal(classifyDelivery([event('DISPATCHING',{created_at:'2026-10-18T20:00:00Z'})],NOW).state,'resultado_desconhecido');
 assert.equal(classifyDelivery([event('PENDING'),event('UNKNOWN')],NOW).state,'resultado_desconhecido');
 assert.equal(classifyDelivery([event('SENT'),event('UNKNOWN')],NOW).retry_allowed,false);
 assert.equal(classifyDelivery([event('NEW_UNRECOGNIZED_STATE')],NOW).send_allowed,false);
 assert.equal(classifyDelivery(Array(101).fill(event('SENT')),NOW).state,'evidencia_incompleta');
});
test('date defaults to Sao Paulo today; invalid fields/cursors/identity inputs fail before data',()=>{
 assert.equal(validateRequest({mode:'pending'},Date.parse('2026-10-19T01:00:00Z')).date,'2026-10-18');
 for(const b of[{mode:'pending',date:'2026-02-30'},{mode:'pending',operator_id:'forged'},{mode:'context',conversation_id:ID,before:'2026-10-18T12:00:00Z',before_key:'x'},{mode:'attachment',conversation_id:ID,message_key:'x',artifact_id:'y',url:'https://evil.invalid'},{mode:'rules',include_pending_as_approved:true}])assert.throws(()=>validateRequest(b));
});
const CATALOG={version:'synthetic',sha256:'a'.repeat(64),sources:{TEST:{title:'Synthetic approved instruction'}},rules:[{id:'a',status:'RESOLVED',text:'Synthetic hours',sources:['TEST'],when:{service:'specific'},exclude_processes:['other']},{id:'b',status:'PENDING',text:'Do not publish',sources:['TEST']},{id:'c',status:'PROJECT_REFERENCE',text:'Reference only',sources:[]}]};
const approval=id=>({rule_id:id,catalog_sha256:'a'.repeat(64),approved_at:'2026-10-18T10:00:00Z',expires_at:'2026-10-19T00:00:00Z'});
test('only explicit, live, exact-catalog approval publishes a resolved rule with its conditions',()=>{
 const a=selectRules(CATALOG,[approval('a'),approval('b')],{},NOW);
 assert.deepEqual(a.approved_rules.map(r=>r.id),['a']);assert.equal(a.approved_rules[0].applicability.when.service,'specific');
 assert.equal(a.pending_rules.length,2);assert.ok(a.pending_rules.every(r=>r.usable_for_answer===false));assert.doesNotMatch(JSON.stringify(a),/Do not publish/);
 for(const approvals of[[],[{...approval('a'),catalog_sha256:'b'.repeat(64)}],[{...approval('a'),expires_at:'2026-10-17T00:00:00Z'}],[{...approval('a'),revoked_at:'2026-10-18T00:00:00Z'}]])assert.equal(selectRules(CATALOG,approvals,{},NOW).approved_rules.length,0);
});
test('rule pagination preserves pending identities without publishing their text',()=>{
 const first=selectRules(CATALOG,[approval('a')],{limit:1},NOW);assert.equal(first.has_more,true);
 const next=selectRules(CATALOG,[approval('a')],{...first.next_cursor,limit:1},NOW);assert.equal(next.pending_rules[0].id,'b');assert.equal(next.has_more,true);
});
test('an empty pending page still exposes continuation when scanned conversations were already answered',async()=>{
 const candidates=[0,1].map(n=>({conversation_id:ID,last_received_at:'2026-10-18T20:00:00Z',delivery_evidence:[event('SENT')]}));
 const h=createAdminHandler({authenticate:async()=>({}),read:async()=>({candidates,date:'2026-10-18',timezone:'America/Sao_Paulo'}),now:()=>NOW});
 const d=await(await h(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32)},body:JSON.stringify({mode:'pending',limit:1})}))).json();
 assert.equal(d.items.length,0);assert.equal(d.has_more,true);assert.ok(d.next_cursor);assert.equal(d.scanned_count,1);
});
test('bad auth, browser origin and audit/source error never release any data',async()=>{
 let reads=0;const h=createAdminHandler({authenticate:async()=>null,read:async()=>{reads++;return{};}});
 assert.equal((await h(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32)},body:'{"mode":"pending"}'}))).status,401);assert.equal(reads,0);
 assert.equal((await h(new Request('https://test.invalid',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'}))).status,403);
});
test('legacy reads fall back only without an administrative grant; revoked/broken boundaries do not fall through',async()=>{
 for(const[code,expected]of[['MCP_ADMIN_GRANT_REQUIRED',200],['MCP_ADMIN_OPERATOR_REVOKED',403],['MCP_ADMIN_SOURCE_UNAVAILABLE',503]]){
  let fallback=0;const h=createAdminHandler({authenticate:async()=>({}),read:async()=>{throw Error(code)},legacy:async()=>{fallback++;return Response.json({legacy:true})}});
  const r=await h(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(32)},body:JSON.stringify({mode:'contact',conversation_id:ID})}));assert.equal(r.status,expected);assert.equal(fallback,code==='MCP_ADMIN_GRANT_REQUIRED'?1:0);
 }
});
test('OAuth signature/session result is verified before claims; wrong client, issuer and expired session are rejected',async()=>{
 const subject=ID,client='10000000-0000-4000-8000-000000000002',issuer='https://synthetic.invalid/auth/v1';
 const claims={sub:subject,client_id:client,iss:issuer,aud:'authenticated',session_id:'40000000-0000-4000-8000-000000000001',exp:NOW/1000+100};
 const token=c=>'e30.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.synthetic';
 const good={auth:{getUser:async()=>({data:{user:{id:subject}}})}};
 const auth=federatedAuthenticator(good,issuer,client,()=>NOW);assert.equal((await auth(token(claims))).subject,subject);
 for(const changed of[{client_id:'another'},{iss:'https://evil.invalid'},{exp:1},{session_id:null},{aud:'service_role'},{nbf:NOW/1000+200}])assert.equal(await auth(token({...claims,...changed})),null);
 const rejected=federatedAuthenticator({auth:{getUser:async()=>({error:{code:'session_not_found'},data:{}})}},issuer,client,()=>NOW);assert.equal(await rejected(token(claims)),null);
});
test('production app_metadata is required; user_metadata cannot grant an operator identity',async()=>{
 const service={rpc:async()=>({data:'operator'}),auth:{admin:{getUserById:async()=>({data:{user:{user_metadata:{sana_panel_operator:true},app_metadata:{}}}})}}};
 await assert.rejects(productionIdentity(service,{subject:ID},'fixed-client'),/OPERATOR_REVOKED/);
});
