import test from'node:test';import assert from'node:assert/strict';import{mcpReadMedia}from'./mcp-read-media.mjs';
const ID='20000000-0000-4000-8000-000000000001';
const body={conversation_id:ID,message_key:'synthetic-message',artifact_id:'synthetic-image'};
const req=(b=body)=>new Request('https://panel.invalid/api/runtime/sana-media',{method:'POST',headers:{authorization:'Bearer '+'synthetic'.repeat(5)},body:JSON.stringify(b)});
function setup(o={}){
 const calls=[],bytes=new Uint8Array([137,80,78,71]);
 const d={environment:'production',caller:'synthetic-internal-caller',instance:'synthetic-instance',token:'synthetic-provider-key',
  mediaReference:()=>({mimetype:'image/png',type:'image'}),recoverMediaReference:async()=>{throw Error('unexpected recovery')},downloadMedia:async()=>{calls.push('download');return o.evil?'https://127.0.0.1/private':'https://api.w-api.app/media/file/synthetic';},
  imageBytes:async()=>({bytes,type:'image/png'}),pdfBytes:async()=>({bytes,type:'application/pdf'}),
  transport:async(url,options={})=>{calls.push({url:String(url),options});if(String(url).endsWith('sana-panel-preview-login')){const input=JSON.parse(options.body);if(o.denied||o.revoked&&input.action==='operator_mcp_attachment_record')return Response.json({status:'denied'},{status:403});return Response.json(input.action==='operator_mcp_attachment_record'?{authorized:true}:{phone:'+12025551234',external_message_id:'synthetic-external',type:'image',provider:{private:'synthetic'},sha256:o.badSha?'a'.repeat(64):null});}return new Response(bytes,{headers:{'content-type':'image/png'}});}};
 return{d,calls};
}
test('native media helpers run only after scope validation, then file audit commits before bytes release',async()=>{
 const{d,calls}=setup();const r=await mcpReadMedia(req(),d);assert.equal(r.status,200);assert.ok(r.headers.get('x-santana-artifact-sha256'));
 const actions=calls.filter(c=>typeof c==='object'&&c.options.body).map(c=>JSON.parse(c.options.body).action);assert.deepEqual(actions,['operator_mcp_attachment_reference','operator_mcp_attachment_record']);assert.equal(calls.filter(c=>c==='download').length,1);
 assert.doesNotMatch(JSON.stringify([...r.headers]),/synthetic-provider-key|synthetic-internal-caller|phone|mediaKey/);
});
test('denied scope never calls provider; arbitrary URLs and identity fields are refused',async()=>{
 const{d,calls}=setup({denied:true});assert.equal((await mcpReadMedia(req(),d)).status,503);assert.equal(calls.includes('download'),false);
 assert.equal((await mcpReadMedia(req({...body,url:'https://evil.invalid'}),setup().d)).status,400);
 assert.equal((await mcpReadMedia(req({...body,operator_id:'forged'}),setup().d)).status,400);
});
test('provider SSRF/redirect targets, revoked scope at release and hash mismatch fail closed',async()=>{
 for(const opts of[{evil:true},{revoked:true},{badSha:true}]){const{d,calls}=setup(opts);const r=await mcpReadMedia(req(),d);assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private|synthetic-provider-key/);if(opts.evil)assert.equal(calls.some(c=>typeof c==='object'&&c.url.includes('127.0.0.1')),false);}
});
test('this media extension is disabled in preview and rejects browser-origin requests',async()=>{
 const s=setup();s.d.environment='preview';assert.equal((await mcpReadMedia(req(),s.d)).status,403);assert.equal(s.calls.length,0);
 const request=req();request.headers.set('origin','https://evil.invalid');assert.equal((await mcpReadMedia(request,setup().d)).status,403);
});
