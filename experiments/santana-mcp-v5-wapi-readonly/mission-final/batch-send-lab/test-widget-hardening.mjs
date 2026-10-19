import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const html=await readFile(new URL('./real-widget.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const digest=b=>createHash('sha256').update(b).digest('hex');
function harness({decodeFails=false}={}){
 const nodes=new Map(),elements=[],intervals=[];let requests=0;
 function node(tag='div'){const e={tagName:tag.toUpperCase(),hidden:true,checked:false,disabled:false,value:'',textContent:'',children:[],naturalWidth:10,naturalHeight:10,append(...x){this.children.push(...x);},replaceChildren(){this.children=[];},async decode(){if(decodeFails)throw Error('decode_failed');}};elements.push(e);return e;}
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 const window={parent:{postMessage(){}},addEventListener(){}};
 const context=vm.createContext({document,window,location:{origin:'https://sandbox.synthetic.invalid'},sessionStorage:{getItem:()=>null,removeItem(){},setItem(){}},crypto:webcrypto,TextEncoder,Uint8Array,Blob,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout(){},setInterval:f=>intervals.push(f),fetch:async()=>{requests++;throw Error('NO_NETWORK');},Date,Map,Set,Promise,Error});
 vm.runInContext(script,context);
 return {context,nodes,elements,intervals,requests:()=>requests,async render(meta){context.fixture=meta;await vm.runInContext('render(fixture).catch(renderError)',context);}};
}
function fixture(extra={}){
 const m={batch_id:'10000000-0000-4000-8000-000000000001',expires_at:Date.now()/1000+300,recipients:[{name:'Fictício 01',phone:'5511999900001',text:'Resposta sintética',attachment:null}]};
 const canonical=JSON.stringify(m);
 return {canonical_manifest:canonical,manifest_sha256:digest(canonical),auth_origin:'https://xdccjulfqcqefykunwtg.supabase.co',batch_state:'prepared',public_key:'synthetic-public-key',media:{},pdf_previews:{},...extra};
}
function change(m,fn){const value=JSON.parse(m.canonical_manifest);fn(value);m.canonical_manifest=JSON.stringify(value);m.manifest_sha256=digest(m.canonical_manifest);return m;}
function mediaFixture(type='image/png'){
 const bytes=Buffer.from(type==='application/pdf'?'%PDF-synthetic-document':'synthetic-image-bytes'),sha=digest(bytes);
 const file={name:type==='application/pdf'?'synthetic.pdf':'synthetic.png',mime_type:type,content_base64:bytes.toString('base64'),sha256:sha,size_bytes:bytes.length};
 const m=fixture({media:{[sha]:file}});change(m,v=>v.recipients[0].attachment={name:file.name,mime_type:type,sha256:sha,size_bytes:bytes.length});return{m,file};
}
const blocked=h=>{assert.equal(h.nodes.get('login').hidden,true);assert.equal(h.nodes.get('approval').hidden,true);assert.equal(h.requests(),0);};
test('valid text preview offers personal login without claiming approval',async()=>{const h=harness();await h.render(fixture());assert.equal(h.nodes.get('login').hidden,false);assert.equal(h.nodes.get('approval').hidden,true);assert.equal(h.requests(),0);});
test('expired and completed operations never offer a new approval',async()=>{for(const mode of ['expired','completed']){const h=harness(),m=fixture();mode==='expired'?change(m,v=>v.expires_at=1):m.batch_state='completed';await h.render(m);blocked(h);}});
test('changed digest and unexpected authentication origin fail closed',async()=>{for(const extra of [{manifest_sha256:'0'.repeat(64)},{auth_origin:'https://evil.invalid'}]){const h=harness();await h.render(fixture(extra));blocked(h);}});
test('an image which cannot be decoded never enables authentication/approval',async()=>{const h=harness({decodeFails:true});await h.render(mediaFixture().m);blocked(h);});
test('PDF without a complete set of pages is blocked',async()=>{const h=harness();await h.render(mediaFixture('application/pdf').m);blocked(h);assert.match(h.nodes.get('status').textContent,/PDF_COMPLETE_PREVIEW_REQUIRED/);});
test('all PDF pages are integrity checked and a shared attachment is shown once',async()=>{const h=harness(),{m,file}=mediaFixture('application/pdf');const jpeg=Buffer.from('synthetic-page-jpeg'),page={page:1,mime_type:'image/jpeg',content_base64:jpeg.toString('base64'),sha256:digest(jpeg),size_bytes:jpeg.length};m.pdf_previews[file.sha256]={status:'ready',complete:true,original_sha256:file.sha256,page_count:1,images:[page]};change(m,v=>v.recipients.push({...v.recipients[0],name:'Fictício 02',phone:'5511999900002'}));await h.render(m);assert.equal(h.nodes.get('login').hidden,false);assert.equal(h.elements.filter(e=>e.tagName==='IMG').length,1);assert.equal(h.elements.filter(e=>e.tagName==='IFRAME').length,0);assert.equal(h.requests(),0);});
test('a changed rendered PDF page is rejected',async()=>{const h=harness(),{m,file}=mediaFixture('application/pdf');m.pdf_previews[file.sha256]={status:'ready',complete:true,original_sha256:file.sha256,page_count:1,images:[{page:1,mime_type:'image/jpeg',content_base64:Buffer.from('bad').toString('base64'),sha256:'a'.repeat(64),size_bytes:3}]};await h.render(m);blocked(h);});
