import test,{before,beforeEach,after} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createAdminHandler} from './admin-core.mjs';
const {PGlite}=await import(process.env.SANTANA_PGLITE_MODULE||'/tmp/santana-admin-test-deps/node_modules/@electric-sql/pglite/dist/index.js');const db=new PGlite();
const SUB='10000000-0000-4000-8000-000000000001',CLI='10000000-0000-4000-8000-000000000002',OP='10000000-0000-4000-8000-000000000003',CID='20000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002';
const q=(sql,args=[])=>db.query(sql,args);
const handler=createAdminHandler({authenticate:async()=>({}),read:async(_,mode,args)=>(await q('select sana_mcp_admin_read($1,$2,$3,$4) v',[SUB,CLI,mode,args])).rows[0].v.data,catalog:{rules:[],sources:{}}});
const pending=async()=>{const req=new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer '+'synthetic'.repeat(4)},body:JSON.stringify({mode:'pending',date:'2026-10-19',limit:50})});return(await handler(req)).json();};
before(async()=>{
 await db.exec(await readFile(new URL('./synthetic-schema.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./admin-access.sql',import.meta.url),'utf8'));
 await db.exec('create schema sana_mcp_private;grant usage on schema sana_mcp_private to service_role');
 await db.exec(await readFile(new URL('./triage-evidence.sql',import.meta.url),'utf8'));
 const source=(await readFile(new URL('./current-baseline/admin_read.sql',import.meta.url),'utf8')).replace("'has_attachments',jsonb_array_length(i.attachments)>0,","'has_attachments',jsonb_array_length(i.attachments)>0,'response_triage',sana_mcp_private.response_triage(v.conversation_id),");
 await db.exec(source);
});
after(async()=>db.close());
beforeEach(async()=>{
 await db.exec('truncate sana_mcp_supervision_access,sana_mcp_admin_audit,sana_message_audit,sana_operator_deliveries,sana_inbox_messages,sana_outbox,sana_conversations,support_members cascade;');
 await q("insert into support_members values($1,'admin',true,'approved',array['atendimentos'])",[OP]);
 await q("insert into sana_mcp_supervision_access values($1,$2,$3,'panel:santana',$4,array['pending','context'],true,now()+interval '1 day',now())",[SUB,CLI,OP,[CID]]);
 for(const id of [CID,B])await q("insert into sana_conversations(conversation_id,contact_key) values($1,'+12025551234')",[id]);
});
async function message(key,text,role='citizen',attachments=[]){await q("insert into sana_inbox_messages(message_key,conversation_id,inbound_text,sender_role,delivery_state,created_at,attachments) values($1,$2,$3,$4,$5,$6,$7)",[key,CID,text,role,role==='team'?'sent':'received',role==='team'?'2026-10-19T10:00:00Z':'2026-10-19T10:01:00Z',attachments]);}
test('scoped SQL evidence recognizes actual team responses and keeps unknown delivery visible',async()=>{
 await message('response','Localização: quadra 11 terreno 72','team');await message('answer','Isso mesmo');
 let d=await pending();assert.equal(d.items.length,0);assert.equal(d.informational_items[0].triage,'confirmation_without_new_request');
 await q("insert into sana_outbox(outbox_id,conversation_id,delivery_state,created_at) values(gen_random_uuid(),$1,'UNKNOWN','2026-10-19T10:02:00Z')",[CID]);
 d=await pending();assert.equal(d.items[0].state,'resultado_desconhecido');assert.equal(d.informational_items.length,0);
});
test('generated response is never sent-response evidence, and new image prevents false closure',async()=>{
 await message('question','Preciso de retorno');await q("update sana_inbox_messages set response_text='Resposta apenas gerada'");await message('thanks','Obrigado');
 let d=await pending();assert.equal(d.items.length,1);assert.equal(d.informational_items.length,0);
 await message('response','O pedido já foi conferido.','team');await q("delete from sana_inbox_messages where message_key='question'");await q("update sana_inbox_messages set attachments=$1 where message_key='thanks'",[[{artifact_id:'synthetic-image'}]]);
 d=await pending();assert.equal(d.items.length,1);
});
test('actual Sana acceptance is usable; foreign conversation and incomplete tails stay protected',async()=>{
 await q("insert into sana_outbox(outbox_id,conversation_id,delivery_state,response_text,created_at) values(gen_random_uuid(),$1,'SENT','O pedido foi encaminhado.','2026-10-19T10:00:00Z')",[CID]);
 await message('thanks','Obrigado');let d=await pending();assert.equal(d.informational_items.length,1);
 for(let i=0;i<9;i++)await message('tail-'+i,'Obrigado');d=await pending();assert.equal(d.items.length,1);
 await q("insert into sana_inbox_messages(message_key,conversation_id,inbound_text,created_at) values('FOREIGN',$1,'FOREIGN_CONTEXT','2026-10-19T11:00:00Z')",[B]);d=await pending();assert.doesNotMatch(JSON.stringify(d),/FOREIGN/);
 await db.exec('set role authenticated');try{await assert.rejects(q('select sana_mcp_private.response_triage($1)',[B]),/permission denied/);}finally{await db.exec('reset role');}
});
