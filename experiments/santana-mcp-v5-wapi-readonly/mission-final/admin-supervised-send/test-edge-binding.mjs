import test from 'node:test';import assert from 'node:assert/strict';import{readFile,writeFile,mkdtemp,copyFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';
import{createIntentHandler}from'./candidate/send-intents-core.mjs';
const stage=await mkdtemp(join(tmpdir(),'santana-scoped-edge-'));
await copyFile(new URL('./candidate/mcp-official-operations.ts',import.meta.url),join(stage,'edge.ts'));
await copyFile(new URL('../supervised-send/media-attachments.mjs',import.meta.url),join(stage,'media-attachments.mjs'));
let original=await readFile(new URL('../supervised-send/test-binding.mjs',import.meta.url),'utf8');
original=original.replace("'./edge-operations.ts'",JSON.stringify(pathToFileURL(join(stage,'edge.ts')).href))
 .replace("'./homolog/send-intents-core.mjs'",JSON.stringify(new URL('./candidate/send-intents-core.mjs',import.meta.url).href))
 .replace("'./vercel-binding.ts'",JSON.stringify(new URL('../supervised-send/vercel-binding.ts',import.meta.url).href))
 .replace("new URL('./media-fixtures/fixtures.json',import.meta.url)",'new URL('+JSON.stringify(new URL('../supervised-send/media-fixtures/fixtures.json',import.meta.url).href)+')');
original=original.replace('function setup(options={})','export function setup(options={})').replace('const {p}=args;',"const {p}=args;if(name==='sana_mcp_supervised_scope'){if(options.adminRevoked||options.admin&&options.disabled&&args.p_live)return{error:{message:'MCP_SUPERVISED_PERMISSION_DISABLED'}};return{data:options.admin===true,error:null};}");
const {setup}=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
test('administrative grant reuses verified human review and official transport without a per-contact grant',async()=>{const s=setup({admin:true,wrongBinding:true});assert.equal((await s.call('authorize')).status,200);const r=await(await s.call('send')).json();assert.equal(r.delivery_state,'sent');assert.equal(r.delivery_confirmed,false);assert.equal(s.count(),1);await s.call('send');assert.equal(s.count(),1);});
test('revoked or live-disabled administrative permission never falls back to a legacy grant or reaches transport',async()=>{for(const options of[{admin:true,adminRevoked:true},{admin:true,disabled:true}]){const s=setup(options);assert.notEqual((await s.call('authorize')).status,200);assert.equal(s.count(),0);}});
test('administrative grant cannot replace independent human authorization',async()=>{const s=setup({admin:true});const r=await(await s.call('send')).json();assert.notEqual(r.delivery_state,'sent');assert.equal(s.count(),0);});
test('the independently reviewed payload hash includes the recent-message watermark',async()=>{
 const cid='10000000-0000-4000-8000-000000000004',sub='10000000-0000-4000-8000-000000000002';let saved;
 async function prepare(key){const handler=createIntentHandler({authenticate:async()=>({sub,oauth:true,client_id:'ccb5e1fc-2a61-4296-943a-a85c103e9313'}),contact:async()=>({conversation_id:cid,contact_key:'***0200',revision:7,human_paused:true,message_watermark:{inbox:{id:key},sana:null}}),save:async row=>(saved=row),audit:async()=>{}});return(await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer '+'synthetic'.repeat(4)},body:JSON.stringify({action:'prepare',conversation_id:cid,idempotency_key:'10000000-0000-4000-8000-000000000005',text:'Synthetic draft'})}))).json();}
 const a=await prepare('one'),b=await prepare('two');assert.notEqual(a.payload_sha256,b.payload_sha256);assert.equal(b.payload.conversation_watermark.inbox.id,'two');assert.equal(saved.state,'prepared');assert.equal(b.real_dispatch_enabled,false);
});
test.after(async()=>rm(stage,{recursive:true,force:true}));
