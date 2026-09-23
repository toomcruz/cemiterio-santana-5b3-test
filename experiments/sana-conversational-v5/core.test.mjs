import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreview, parsePlan, contextPack, renderDraft, uniqueKnowledge } from './core.ts';
import { geminiModel } from './gemini.ts';

const base = () => ({
  conversationId:'conversation-fixture', seq:2, topic:'EXUMACAO', caseId:'case-1', goalId:'goal-1', humanActive:false,
  facts:[], pending:{key:'surviving_spouse_status',text:'Ele tinha companheira?'}
});
const message = (text = 'Vou jaja tá?') => ({id:'in-fixture',conversationId:'conversation-fixture',sessionId:'session-fixture',role:'user',text});
const input = (body, state=base()) => ({mode:'simulation',state,message:message(body),history:[],correlationId:'correlation-fixture',referenceDate:'2026-09-23',automaticRepliesAllowed:true});
const pause = () => ({action:'PAUSE',interpretation:null,questions:[],askFollowup:false});
const ack = (text='Tudo bem. Quando voltar, continuamos daqui.') => ({parts:[{kind:'ack',text,sourceIds:[]}]});
const knowledge = (status='AVAILABLE') => ({id:'authority:DOCUMENTOS',version:'fixture-not-official',kind:'DOCUMENTOS',status,text: status==='AVAILABLE'?'Orientação fictícia para teste.':'A orientação aplicável ainda precisa ser confirmada.'});
const bridge = (changes={}) => ({
  snapshot: (s) => structuredClone(s), interpretationPrompt: () => 'canonical-fixture',
  preview: async (s) => ({state:s,outcome:'PROPOSED',legacyDraft:null}),
  lookup: async () => knowledge(), ...changes,
});
const scripted = (...values) => ({name:'scripted-not-gemini',generate:async () => {
  assert.ok(values.length,'unexpected extra model call');
  const value=values.shift(); if(value instanceof Error) throw value; return structuredClone(value);
}});
const deps = (...values) => ({bridge:bridge(),model:scripted(...values)});
const answer = (interpretation=null) => ({action:'ANSWER',interpretation,questions:[{kind:'DOCUMENTOS',evidence:'quais documentos'}],askFollowup:false});

test('pure pause does not invoke reducer, lookup or repeat pending question', async () => {
  const d=deps(pause(),ack());
  d.bridge.preview=d.bridge.lookup=async()=>{throw new Error('must not execute');};
  const r=await runPreview(input(),d);
  assert.equal(r.status,'DRAFT'); assert.equal(r.text,ack().parts[0].text);
  assert.deepEqual(r.stateCandidate,base()); assert.equal(r.telemetry.modelCalls,2);
});
test('human-owned conversation never invokes the model',async()=>{
  const state={...base(),humanActive:true};
  const r=await runPreview(input('Oi',state),deps()); assert.equal(r.status,'HUMAN_ACTIVE'); assert.equal(r.telemetry.modelCalls,0);
});
test('automation disabled never invokes the model',async()=>{
  const r=await runPreview({...input('Oi'),automaticRepliesAllowed:false},deps()); assert.equal(r.text,null);
});
test('reject production invocation',async()=>{
  await assert.rejects(runPreview({...input(),mode:'production'},deps()),/SIMULATION_ONLY/);
});
test('reject oversized current message rather than truncate evidence',async()=>{
  await assert.rejects(runPreview(input('x'.repeat(4001)),deps()),/INVALID_MESSAGE/);
});
test('context excludes other sessions and conversations',()=>{
  const history=[{...message('previous'),id:'prev'}, {...message('other-session'),id:'x',sessionId:'other'}, {...message('other-contact'),id:'y',conversationId:'other'}];
  const p=contextPack(base(),message(),history);assert.equal(p.history.length,1);assert.equal(p.history[0].text,'previous');
});
test('context keeps scopes, drops facts belonging to another case or goal',()=>{
  const fact={id:'f',key:'name',value:'fictional',caseId:'case-1',goalId:null,source:'USER_EXPLICIT',conflict:false};
  const p=contextPack({...base(),facts:[fact,{...fact,id:'f2',caseId:'case-2'},{...fact,id:'f3',goalId:'other'}]},message(),[]);
  assert.deepEqual(p.facts,[fact]);
});
test('context uses at most eight prior messages and marks truncation',()=>{
  const p=contextPack(base(),message(),Array.from({length:12},(_,i)=>({...message('x'.repeat(1700)),id:`old-${i}`})));
  assert.equal(p.history.length,8);assert.equal(p.history[0].truncated,true);assert.equal(p.omittedHistory,4);
});
test('oversized fact context is rejected instead of silently losing known facts',()=>{
  assert.throws(()=>contextPack({...base(),facts:Array(81).fill({caseId:null,goalId:null})},message(),[]),/CONTEXT_FACT_LIMIT/);
});
test('unknown planner action is rejected',()=>assert.throws(()=>parsePlan({...pause(),action:'EXECUTE_SQL'},'hello'),/UNKNOWN_ACTION/));
test('nonliteral knowledge query is rejected',()=>assert.throws(()=>parsePlan(answer(),'hello'),/NON_LITERAL_QUESTION/));
test('pause cannot hide a proposed fact update',()=>assert.throws(()=>parsePlan({...pause(),interpretation:{facts:[]}},'hello'),/INVALID_PAUSE/));
test('unknown planner fields such as private reasoning are rejected',()=>assert.throws(()=>parsePlan({...pause(),reasoning:'private'},'hello'),/INVALID_FIELDS/));
test('continue needs a canonical interpretation',()=>assert.throws(()=>parsePlan({...pause(),action:'CONTINUE'},'hello'),/MISSING_INTERPRETATION/));
test('mixed answer applies facts BEFORE looking up knowledge and writing',async()=>{
  const original=base(), events=[];
  const d={bridge:bridge({
    preview:async(s)=>{events.push('engine');s.facts.push({id:'f1',key:'surviving_spouse_status',value:'INEXISTENTE',caseId:'case-1',goalId:null,source:'USER_EXPLICIT',conflict:false});s.pending=null;return {state:s,outcome:'PROPOSED',legacyDraft:null};},
    lookup:async(s)=>{events.push('knowledge');assert.equal(s.facts[0].value,'INEXISTENTE');return knowledge();}
  }),model:{name:'scripted',generate:async(_policy,data)=>{
    if(!events.length)return answer({canonical:'fixture'});
    events.push('writer');assert.equal(data.context.pending,null);
    return {parts:[{kind:'information',text:knowledge().text,sourceIds:[knowledge().id]}]};
  }}};
  const r=await runPreview(input('Não tinha companheira, e quais documentos eu levo?',original),d);
  assert.equal(r.status,'DRAFT');assert.deepEqual(events,['engine','knowledge','writer']);assert.deepEqual(original,base());
});
test('pure information does not open a service request or run the reducer',async()=>{
  const d=deps(answer(),{parts:[{kind:'information',text:knowledge().text,sourceIds:[knowledge().id]}]});
  d.bridge.preview=async()=>{throw new Error('not allowed');};
  const r=await runPreview(input('quais documentos'),d);assert.equal(r.status,'DRAFT');assert.deepEqual(r.stateCandidate,base());
});
test('duplicate paragraphs are rendered only once',()=>{
  const draft={parts:[{kind:'information',text:'Orientação fictícia.\n\nOrientação fictícia.',sourceIds:[knowledge().id]}]};
  assert.equal(renderDraft(draft,answer(),base(),[knowledge()]),'Orientação fictícia.');
});
test('writer cannot cite an unknown source',()=>{
  assert.throws(()=>renderDraft({parts:[{kind:'information',text:'Invented',sourceIds:['unknown']}]},answer(),base(),[]),/UNKNOWN_SOURCE/);
});
test('unavailable source cannot authorize a factual answer',()=>{
  assert.throws(()=>renderDraft({parts:[{kind:'information',text:'Invented',sourceIds:[knowledge().id]}]},answer(),base(),[knowledge('NOT_AVAILABLE')]),/UNAVAILABLE_SOURCE/);
});
test('source absence returns only gateway absence text, no legacy catalog fallback',async()=>{
  const d=deps(answer(),ack('Entendi sua dúvida.')); d.bridge.lookup=async()=>knowledge('NOT_AVAILABLE');
  const r=await runPreview(input('quais documentos'),d);assert.equal(r.status,'DRAFT');assert.match(r.text,/precisa ser confirmada/);assert.doesNotMatch(r.text,/Ele tinha/);
});
test('writer must cover each available requested source',()=>assert.throws(()=>renderDraft(ack(),answer(),base(),[knowledge()]),/INFORMATION_NOT_ANSWERED/));
test('writer cannot repeat a question already removed by the reducer',()=>{
  assert.throws(()=>renderDraft({parts:[{kind:'question',text:'Ele tinha companheira?',sourceIds:[]}]},{...pause(),action:'CONTINUE',askFollowup:true},{...base(),pending:null},[]),/UNPERMITTED_QUESTION/);
});
test('pause rejects question hidden inside acknowledgement',()=>assert.throws(()=>renderDraft(ack('Ele tinha companheira?'),pause(),base(),[]),/PAUSE_REPEATS_QUESTION/));
test('same knowledge ID with different text fails closed',()=>assert.throws(()=>uniqueKnowledge([knowledge(),{...knowledge(),text:'different'}]),/KNOWLEDGE_ID_CONFLICT/));
test('same knowledge entry is deduplicated',()=>assert.equal(uniqueKnowledge([knowledge(),knowledge()]).length,1));
test('canonical interpretation rejection does not advance state',async()=>{
  const d=deps(answer({invalid:true}));d.bridge.preview=async(s)=>({state:s,outcome:'INTERPRETATION_UNAVAILABLE',legacyDraft:null});
  const r=await runPreview(input('quais documentos'),d);assert.deepEqual(r.stateCandidate,base());assert.equal(r.telemetry.reason,'CANONICAL_INTERPRETATION_REJECTED');
});
test('writer failure on pause uses noninterrogative fallback',async()=>{
  const r=await runPreview(input(),deps(pause(),new Error('provider raw secret should not leak')));
  assert.equal(r.status,'FALLBACK');assert.equal(r.telemetry.reason,'DEPENDENCY_FAILURE');assert.doesNotMatch(JSON.stringify(r),/provider raw secret/);
});
test('global deadline cancels even a provider ignoring AbortSignal',async()=>{
  const d={bridge:bridge(),model:{name:'hanging',generate:()=>new Promise(()=>{})}};
  const r=await runPreview({...input(),deadlineMs:5},d);assert.equal(r.status,'BLOCKED');assert.equal(r.text,null);assert.equal(r.telemetry.modelCalls,1);
});
test('pre-aborted request makes no external call',async()=>{
  const c=new AbortController();c.abort();let calls=0;
  const d={bridge:bridge(),model:{name:'fake',generate:async()=>{calls++;return pause();}}};
  const r=await runPreview({...input(),signal:c.signal},d);assert.equal(r.status,'BLOCKED');assert.equal(calls,0);
});
test('handoff requires canonical proposed human state',async()=>{
  const d=deps({action:'HANDOFF',interpretation:{fixture:true},questions:[],askFollowup:false});
  const r=await runPreview(input('Quero falar com atendente'),d);assert.equal(r.telemetry.reason,'HANDOFF_NOT_VALIDATED');
});
test('all successful results are unpersisted review-only drafts',async()=>{
  const r=await runPreview(input(),deps(pause(),ack()));
  assert.equal(r.persisted,false);assert.equal(r.draftOnly,true);assert.equal(r.requiresHumanReview,true);assert.deepEqual(r.externalEffects,[]);
});
test('telemetry does not contain message, fact values or raw prompts',async()=>{
  const r=await runPreview(input('mensagem confidencial'),deps(pause(),ack()));
  assert.doesNotMatch(JSON.stringify(r.telemetry),/confidencial|canonical-fixture|Ele tinha/);assert.equal(r.telemetry.correlationId,'correlation-fixture');
});
test('Gemini HTTP adapter uses header key, fixed host, JSON mode and supplied abort signal',async()=>{
  let captured;
  const response={candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private'},{text:JSON.stringify(pause())}]}}]};
  const m=geminiModel({apiKey:'fixture-key-not-real',model:'fixture-model',fetcher:async(url,options)=>{captured={url,options};return Response.json(response);}});
  const c=new AbortController();assert.deepEqual(await m.generate('policy',{example:true},c.signal),pause());
  assert.equal(captured.options.headers['x-goog-api-key'],'fixture-key-not-real');assert.equal(captured.options.signal,c.signal);
  assert.equal(captured.options.redirect,'error');assert.doesNotMatch(captured.url,/fixture-key/);
  assert.equal(JSON.parse(captured.options.body).generationConfig.responseMimeType,'application/json');
});
test('Gemini adapter does not retry provider errors',async()=>{
  let calls=0;const m=geminiModel({apiKey:'fixture',model:'fixture',fetcher:async()=>{calls++;return new Response('private error',{status:429});}});
  await assert.rejects(m.generate('p',{},new AbortController().signal),/MODEL_HTTP_429/);assert.equal(calls,1);
});
test('Gemini adapter rejects truncated output',async()=>{
  const m=geminiModel({apiKey:'fixture',model:'fixture',fetcher:async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]})});
  await assert.rejects(m.generate('p',{},new AbortController().signal),/MODEL_INCOMPLETE_RESPONSE/);
});
test('Gemini adapter rejects oversized response',async()=>{
  const m=geminiModel({apiKey:'fixture',model:'fixture',fetcher:async()=>new Response('x'.repeat(131073))});
  await assert.rejects(m.generate('p',{},new AbortController().signal),/MODEL_RESPONSE_TOO_LARGE/);
});
test('Gemini adapter rejects arbitrary model URL injection',()=>assert.throws(()=>geminiModel({apiKey:'fixture',model:'../elsewhere?key=x',fetcher:fetch}),/INVALID_MODEL_CONFIG/));
