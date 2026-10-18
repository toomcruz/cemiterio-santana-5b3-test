import test,{before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{createAdminHandler}from'./admin-core.mjs';
const{PGlite}=await import(process.env.SANTANA_PGLITE_MODULE||'/tmp/santana-admin-test-deps/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite();
const SUB='10000000-0000-4000-8000-000000000001',CLI='10000000-0000-4000-8000-000000000002',OP='10000000-0000-4000-8000-000000000003';
const A='20000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002',Z='20000000-0000-4000-8000-000000000003';
const CA='30000000-0000-4000-8000-000000000001',CB='30000000-0000-4000-8000-000000000002';
const now=Date.parse('2026-10-18T21:30:00Z');
const req=b=>new Request('https://example.invalid/mcp',{method:'POST',headers:{authorization:'Bearer '+'synthetic'.repeat(5)},body:JSON.stringify(b)});
async function rpc(mode,args={}){return(await db.query('select public.sana_mcp_admin_read($1,$2,$3,$4) as value',[SUB,CLI,mode,args])).rows[0].value.data;}
const handler=createAdminHandler({environment:'isolated_synthetic',authenticate:async()=>({subject:SUB,client_id:CLI}),read:async(_,m,a)=>rpc(m,a),readAttachment:async()=>{throw Error('No network in SQL tests');},catalog:{rules:[],sources:{}},now:()=>now});
before(async()=>{await db.exec(await readFile(new URL('./synthetic-schema.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('./admin-access.sql',import.meta.url),'utf8'));});
after(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('truncate sana_mcp_supervision_access,sana_mcp_rule_approvals,sana_mcp_admin_audit,support_access_audit,sana_documents,sana_cases,sana_message_audit,sana_operator_deliveries,sana_outbox,sana_inbox_messages,sana_conversations,support_members cascade;update synthetic_quota set allowed=true;');
 await db.query('insert into support_members values($1,\'admin\',true,\'approved\',array[\'atendimentos\'])',[OP]);
 await db.query("insert into sana_mcp_supervision_access values($1,$2,$3,'panel:santana',$4,array['pending','context','rules','attachment','conversations','contact','messages','files'],true,now()+interval '1 day',now())",[SUB,CLI,OP,[A,B]]);
 for(const id of[A,B,Z])await db.query("insert into sana_conversations(conversation_id,contact_key,state_json)values($1,$2,$3)",[id,'+12025551234',{contact_name:id===A?'Synthetic A':'Synthetic B'}]);
 for(const[id,key]of[[A,'a'],[B,'b'],[Z,'secret']])await db.query("insert into sana_inbox_messages(message_key,conversation_id,inbound_text,created_at)values($1,$2,$3,'2026-10-18T20:00:00Z')",[key,id,'synthetic '+key]);
});
test('real SQL denies anon/authenticated and preserves RLS',async()=>{
 for(const role of['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'public.sana_mcp_admin_read(uuid,uuid,text,jsonb)','execute') as value",[role])).rows[0].value,false);}
 const rows=(await db.query("select relrowsecurity from pg_class where relname in('sana_mcp_supervision_access','sana_mcp_rule_approvals','sana_mcp_admin_audit')")).rows;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.relrowsecurity));
});
test('actual service_role can execute only the scoped read; new tables remain nonpublic',async()=>{
 await db.exec('set role service_role');
 try{assert.equal((await rpc('context',{conversation_id:A})).conversation.conversation_id,A);await assert.rejects(rpc('context',{conversation_id:Z}),/CONVERSATION_DENIED/);}finally{await db.exec('reset role');}
 for(const role of['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'public.sana_mcp_supervision_access','select') as allowed",[role])).rows[0].allowed,false);
});
test('SQL enforces current operator, scope, expiry, revocation and conversation boundary',async()=>{
 await assert.rejects(rpc('context',{conversation_id:Z}),/MCP_ADMIN_CONVERSATION_DENIED/);
 await db.exec("update sana_mcp_supervision_access set operations=array['pending']");await assert.rejects(rpc('context',{conversation_id:A}),/MCP_ADMIN_SCOPE_DENIED/);
 await db.exec('update sana_mcp_supervision_access set is_active=false');await assert.rejects(rpc('pending'),/MCP_ADMIN_GRANT_REQUIRED/);
 await db.exec("update sana_mcp_supervision_access set is_active=true,expires_at=now()-interval '1 second'");await assert.rejects(rpc('pending'),/MCP_ADMIN_GRANT_REQUIRED/);
 await db.exec("update sana_mcp_supervision_access set expires_at=now()+interval '1 hour';update support_members set role='agent'");await assert.rejects(rpc('pending'),/MCP_ADMIN_OPERATOR_REVOKED/);
});
test('no response_text shortcut and no leakage outside granted conversations',async()=>{
 await db.exec("update sana_inbox_messages set response_text='generated but never sent' where message_key='a'");
 const d=await(await handler(req({mode:'pending',date:'2026-10-18'}))).json();assert.equal(d.items.length,2);assert.ok(d.items.every(i=>i.state==='sem_resposta'));assert.doesNotMatch(JSON.stringify(d),/secret/);
});
test('accepted team response clears pending without claiming delivery',async()=>{
 await db.query("insert into sana_inbox_messages(message_key,conversation_id,inbound_text,sender_role,delivery_state,created_at)values('reply',$1,'Synthetic response','team','sent','2026-10-18T21:29:30Z')",[A]);
 const d=await(await handler(req({mode:'pending',date:'2026-10-18'}))).json();assert.equal(d.items.length,1);assert.equal(d.items[0].conversation_id,B);
 const c=await(await handler(req({mode:'context',conversation_id:A}))).json();assert.equal(c.delivery.accepted_by_api,true);assert.equal(c.delivery.delivery_confirmed,false);
});
test('Sana answer must be causally linked; old reply cannot hide new inbound',async()=>{
 const out='40000000-0000-4000-8000-000000000001';
 await db.query("insert into sana_outbox values($1,$2,'Synthetic Sana reply','SENT','2026-10-18T21:29:20Z','2026-10-18T21:29:25Z')",[out,A]);
 await db.query("insert into sana_message_audit(message_key,outbox_id) values('old-message',$1)",[out]);
 let d=await(await handler(req({mode:'pending',date:'2026-10-18'}))).json();assert.equal(d.items.find(i=>i.conversation_id===A).state,'sem_resposta');
 await db.query("update sana_message_audit set message_key='a' where outbox_id=$1",[out]);
 d=await(await handler(req({mode:'pending',date:'2026-10-18'}))).json();assert.equal(d.items.some(i=>i.conversation_id===A),false);
});
test('pending/failed/unknown produce distinct grounded states and never authorize send',async()=>{
 for(const[state,expected]of[['dispatching','envio_em_andamento'],['failed','falha_envio'],['unknown','resultado_desconhecido']]){
  await db.exec("delete from sana_inbox_messages where sender_role='team'");
  await db.query("insert into sana_inbox_messages(message_key,conversation_id,sender_role,delivery_state,created_at)values('reply',$1,'team',$2,'2026-10-18T21:29:30Z')",[A,state]);
  const d=await(await handler(req({mode:'pending',date:'2026-10-18'}))).json();const a=d.items.find(i=>i.conversation_id===A);assert.equal(a.state,expected);assert.equal(a.send_allowed,false);
 }
});
test('today uses Sao Paulo boundaries and cursor covers all authorized candidates',async()=>{
 await db.exec("update sana_inbox_messages set created_at='2026-10-18T01:00:00Z' where message_key='b'");
 const d=await(await handler(req({mode:'pending',date:'2026-10-18',limit:1}))).json();assert.equal(d.items.length,1);assert.equal(d.items[0].conversation_id,A);assert.equal(d.has_more,false);
 await db.exec("update sana_inbox_messages set created_at='2026-10-18T03:00:00Z' where message_key='b'");
 const first=await(await handler(req({mode:'pending',date:'2026-10-18',limit:1}))).json();assert.equal(first.has_more,true);
 const second=await(await handler(req({mode:'pending',date:'2026-10-18',limit:1,...first.next_cursor}))).json();assert.equal(second.items[0].conversation_id,B);assert.equal(second.has_more,false);
});
test('context sections isolate cases, documents and notes, strip private URLs, and paginate',async()=>{
 for(const[id,cid]of[[CA,A],[CB,B]])await db.query("insert into sana_cases values($1,$2,'RECADASTRO','awaiting_human',2,'2026-10-18T20:10:00Z','2026-10-18T20:10:00Z')",[id,cid]);
 await db.query("insert into sana_documents values($1,$2,'received-file','RG','pending','2026-10-18T20:11:00Z')",['50000000-0000-4000-8000-000000000001',CA]);
 for(const[n,k]of[[1,CA],[2,CB]])await db.query("insert into support_access_audit values($1,'human_case_note',$2,$3,'2026-10-18T20:12:00Z')",[n,k,{note:n===1?'Allowed note':'FOREIGN NOTE',storage_path:'do-not-release'}]);
 await db.query("update sana_inbox_messages set attachments=$1 where message_key='a'",[[{artifact_id:'image-a',file_name:'image.png',provider:{mediaKey:'do-not-release'},url:'do-not-release'}]]);
 let d=await(await handler(req({mode:'context',conversation_id:A,limit:1}))).json();assert.equal(d.sections.cases.items[0].case_id,CA);assert.equal(d.sections.notes.items[0].text,'Allowed note');assert.doesNotMatch(JSON.stringify(d),/FOREIGN|do-not-release/);
 await db.query("insert into sana_inbox_messages(message_key,conversation_id,inbound_text,created_at)values('newer',$1,'another','2026-10-18T21:00:00Z')",[A]);
 d=await(await handler(req({mode:'context',conversation_id:A,limit:1}))).json();assert.equal(d.context_complete,false);
 const next=await(await handler(req({mode:'context',conversation_id:A,limit:1,...d.sections.messages.next_cursor}))).json();assert.equal(next.sections.messages.items[0].message_key,'a');
});
test('attachments require exact received message/artifact and recheck revocation',async()=>{
 await db.query("update sana_inbox_messages set attachments=$1,external_message_id='external' where message_key='a'",[[{artifact_id:'image-a',type:'image',provider:{mediaKey:'private-provider-reference'}}]]);
 await assert.rejects(rpc('attachment_reference',{conversation_id:A,message_key:'b',artifact_id:'image-a'}),/MCP_ADMIN_ATTACHMENT_DENIED/);
 assert.equal((await rpc('attachment_reference',{conversation_id:A,message_key:'a',artifact_id:'image-a'})).external_message_id,'external');
 await db.exec('update sana_mcp_supervision_access set is_active=false');await assert.rejects(rpc('attachment_record',{conversation_id:A,message_key:'a',artifact_id:'image-a',sha256:'a'.repeat(64)}),/MCP_ADMIN_GRANT_REQUIRED/);
});
test('audit failure fails closed and rate quota is enforced before release',async()=>{
 await db.exec('update synthetic_quota set allowed=false');assert.equal((await handler(req({mode:'pending',date:'2026-10-18'}))).status,429);
 await db.exec("update synthetic_quota set allowed=true;alter table sana_mcp_admin_audit add constraint synthetic_audit_failure check(operation='never')");
 try{assert.equal((await handler(req({mode:'pending',date:'2026-10-18'}))).status,503);}finally{await db.exec('alter table sana_mcp_admin_audit drop constraint synthetic_audit_failure');}
});
test('context includes actual accepted Sana messages, excludes unsent drafts from the timeline, and reports truncated content',async()=>{
 await db.query("insert into sana_outbox values($1,$2,'ACTUAL SANA ANSWER','SENT','2026-10-18T21:00:00Z','2026-10-18T21:00:05Z')",['40000000-0000-4000-8000-000000000001',A]);
 await db.query("insert into sana_outbox values($1,$2,'UNSENT OUTBOX DRAFT','PENDING','2026-10-18T21:01:00Z',null)",['40000000-0000-4000-8000-000000000002',A]);
 let d=await(await handler(req({mode:'context',conversation_id:A}))).json();
 const sent=d.sections.messages.items.find(m=>m.sender_role==='sana');assert.equal(sent.inbound_text,'ACTUAL SANA ANSWER');assert.equal(sent.accepted_by_api,true);assert.equal(sent.delivery_confirmed,false);assert.doesNotMatch(JSON.stringify(d.sections.messages),/UNSENT OUTBOX DRAFT/);
 await db.query("update sana_inbox_messages set inbound_text=$1 where message_key='a'",['x'.repeat(6001)]);
 d=await(await handler(req({mode:'context',conversation_id:A}))).json();assert.equal(d.content_truncated,true);assert.equal(d.context_complete,false);
});
