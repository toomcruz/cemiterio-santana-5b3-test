import {readFile} from 'node:fs/promises';
import {PGlite} from '/tmp/santana-single-review-deps/node_modules/@electric-sql/pglite/dist/index.js';
export const ACT='10000000-0000-4000-8000-000000000001',SUB='10000000-0000-4000-8000-000000000002',SID='10000000-0000-4000-8000-000000000003',CID='10000000-0000-4000-8000-000000000004',OP='10000000-0000-4000-8000-000000000005',B='10000000-0000-4000-8000-000000000006',CLI='ccb5e1fc-2a61-4296-943a-a85c103e9313';
export async function database(){
 const db=new PGlite();const q=(s,a=[])=>db.query(s,a);const rpc=async p=>(await q('select sana_mcp_panel_review($1) v',[p])).rows[0].v;
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 const root=new URL('../',import.meta.url);
 let bootstrap=(await readFile(new URL('supervised-send/qualify-media.sql',root),'utf8')).split('do $test$')[0].replace(/^begin;/,'').replaceAll('create temporary table','create table').replaceAll('pg_temp.','public.');
 await db.exec(bootstrap);
 await db.exec("alter table support_members add column role text default 'admin';alter table sana_outbox add column created_at timestamptz default now(),add column settled_at timestamptz;create table sana_operator_deliveries(outbox_id uuid,no_send boolean);create table sana_message_audit(outbox_id uuid,no_send boolean);create table sana_mcp_supervision_access(subject_id uuid,client_id uuid,operator_id uuid,scope_key text,conversation_ids uuid[],operations text[],is_active boolean,expires_at timestamptz);create table sana_mcp_admin_audit(subject_id uuid,client_id uuid,operator_id uuid,operation text,conversation_id uuid,item_count integer,details jsonb);create schema sana_mcp_private;create function sana_mcp_private.session_active(uuid,uuid) returns boolean language sql as $$select public.session_active($1,$2)$$;create function sana_mcp_private.attachment_matches(jsonb,uuid,uuid,uuid,uuid) returns boolean language sql as $$select public.attachment_matches($1,$2,$3,$4,$5)$$;");
 await db.exec(await readFile(new URL('admin-supervised-send/access-candidate.sql',root),'utf8'));
 let full=await readFile(new URL('admin-supervised-send/deployment-delta/database.sql',root),'utf8');let coordinator=full.slice(full.indexOf('CREATE OR REPLACE FUNCTION public.sana_mcp_coordinated_send'),full.indexOf('-- Internal, bounded evidence only;')).trim()+';';
 await db.exec(coordinator);await db.exec(await readFile(new URL('./panel-review.sql',import.meta.url),'utf8'));
 const wm=async cid=>(await q('select sana_mcp_conversation_watermark($1) v',[cid])).rows[0].v;
 const reset=async()=>{
  await db.exec('truncate sana_mcp_panel_reviews,sana_mcp_supervised_send_access,sana_mcp_supervision_access,sana_mcp_admin_audit,sana_mcp_send_operations,sana_mcp_send_events,sana_mcp_send_permissions,sana_mcp_read_access,sana_operator_attachments,sana_inbox_messages,sana_outbox,sana_conversations,sana_events,support_members,test_auth_sessions cascade;');
  await q("insert into support_members(user_id,is_active,approval_status,permissions,role) values($1,true,'approved',array['atendimentos'],'admin')",[ACT]);await q("insert into test_auth_sessions values($1,$2,now()+interval '1 hour')",[SID,ACT]);
  for(const cid of[CID,B])await q('insert into sana_conversations(conversation_id,contact_key) values($1,$2)',[cid,'+12025550200']);
  await q("insert into sana_mcp_supervision_access values($1,$2,$3,'panel:santana',null,array['contact'],true,now()+interval '1 hour')",[SUB,CLI,ACT]);
  await q("insert into sana_mcp_supervised_send_access(subject_id,client_id,operator_id,scope_key,is_active,live_enabled,expires_at) values($1,$2,$3,'panel:santana',true,true,now()+interval '1 hour')",[SUB,CLI,ACT]);
 };
 const stage=async(op=OP,cid=CID,attachment=null,bytes=null)=>rpc({operation:'stage',operation_id:op,subject_id:SUB,client_id:CLI,recipient_e164:'+12025550200',payload_sha256:'a'.repeat(64),source_payload_sha256:'b'.repeat(64),expires_at:new Date(Date.now()+900000).toISOString(),attachment_base64:bytes,payload:{conversation_id:cid,recipient:{name:'Pessoa fictícia',phone_mask:'***0200'},expected_revision:0,conversation_watermark:await wm(cid),text:'Resposta fictícia para revisão.',attachment}});
 const human={operator_id:ACT,operator_session_id:SID};
 return{db,q,rpc,wm,reset,stage,human,coordinated:async p=>(await q('select sana_mcp_coordinated_send($1) v',[p])).rows[0].v};
}
