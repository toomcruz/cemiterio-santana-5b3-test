import test from 'node:test';import assert from 'node:assert/strict';
import {classifyResponseNeed,classifyDelivery,createAdminHandler} from './admin-core.mjs';
const CID='20000000-0000-4000-8000-000000000001',B='20000000-0000-4000-8000-000000000002';
const at='2026-10-19T10:00:00Z',later='2026-10-19T10:01:00Z';
function c(texts=['Obrigado 🙏'],previous='Obrigado pela confirmação. O pedido já foi encaminhado.'){
 return {conversation_id:CID,last_received_at:later,delivery_evidence:[],response_triage:{complete:true,
 last_response:{conversation_id:CID,created_at:at,confirmed_sent:true,text:previous},
 unanswered:texts.map(text=>({conversation_id:CID,created_at:later,text,has_attachments:false,truncated:false}))}};
}
const classify=x=>classifyResponseNeed(x,classifyDelivery(x.delivery_evidence));
test('gratitude and simple confirmations after an actual response move to informational, without changing delivery',()=>{
 for(const row of[c(),c(['ok obg'],'Certo, esta será a última alteração, pois já encomendei.'),c(['Isso mesmo'],'Localização: QUADRA 11 TERRENO 72'),c(['Blz','Tô indo'],'Pode vir à administração para falar com a equipe.')]){
  assert.equal(classify(row).response_required,false);assert.equal(classifyDelivery(row.delivery_evidence).state,'sem_resposta');
 }
});
test('an offered appointment, unresolved promise, question or correction stays actionable',()=>{
 for(const row of[c(['Pode ser, sem problema'],'Dia 26/11 tenho somente às 08:30'),c(['Confirmado'],'Pode confirmar o horário?'),c(['Obrigado'],'Vou verificar e retornar.'),c(['Obrigado, mas quando fica pronta?']),c(['A data correta é 16/10/46']),c(['Obrigado'],'Entendo')])assert.equal(classify(row).response_required,true);
});
test('attachment, missing real answer, incomplete tail and foreign conversation cannot suppress a pending response',()=>{
 const variants=[c(),c(),c(),c(),c(),c()];
 variants[0].response_triage.unanswered[0].has_attachments=true;
 variants[1].response_triage.last_response.confirmed_sent=false;
 variants[2].response_triage.complete=false;
 variants[3].response_triage.unanswered[0].conversation_id=B;
 variants[4].response_triage.last_response.conversation_id=B;
 variants[5].response_triage.unanswered[0].truncated=true;
 for(const row of variants)assert.equal(classify(row).response_required,true);
});
test('unknown, failed or in-flight delivery is never hidden by a thank-you',()=>{
 for(const state of ['UNKNOWN','PENDING','FAILED']){const row=c();row.delivery_evidence=[{id:state,state,created_at:later,covers_latest:true}];assert.equal(classify(row).response_required,true);}
});
test('an informational-only page keeps its continuation and no raw triage texts leak into output',async()=>{
 const row=c();const handler=createAdminHandler({authenticate:async()=>({}),read:async()=>({date:'2026-10-19',timezone:'America/Sao_Paulo',candidates:[row,{...row,conversation_id:B}]}),catalog:{rules:[],sources:{}}});
 const req=new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer '+'synthetic'.repeat(4)},body:JSON.stringify({mode:'pending',date:'2026-10-19',limit:1})});
 const d=await(await handler(req)).json();assert.equal(d.items.length,0);assert.equal(d.informational_items.length,1);assert.equal(d.has_more,true);assert.ok(d.next_cursor);assert.equal(d.scanned_count,1);assert.equal(d.send_allowed,false);assert.ok(!('response_triage' in d.informational_items[0]));
});
