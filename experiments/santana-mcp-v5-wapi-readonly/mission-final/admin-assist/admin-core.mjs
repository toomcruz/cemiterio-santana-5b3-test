export const ADMIN_MODES=new Set(['pending','context','rules','attachment']);
const LEGACY=new Set(['conversations','contact','messages','files']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECTION_KEYS={messages:'message_key',cases:'case_id',documents:'document_id',notes:'note_id'};
const forbidden=/[\u0000-\u001f\u007f]/;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>{throw Error(code);};
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!forbidden.test(v);
const reply=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export function validateRequest(b,now=Date.now()){
 if(!object(b)||!ADMIN_MODES.has(b.mode)&&!LEGACY.has(b.mode))fail('MCP_ADMIN_INVALID_REQUEST');
 const fields={pending:['date','limit','before','before_key'],context:['conversation_id','section','limit','before','before_key'],rules:['query','limit','after_rule_id'],attachment:['conversation_id','message_key','artifact_id','page_start','page_limit'],conversations:['page','per_page'],contact:['conversation_id'],messages:['conversation_id','limit','before','before_key','include_content'],files:['conversation_id','limit','before','before_key']};
 if(Object.keys(b).some(k=>k!=='mode'&&!fields[b.mode].includes(k)))fail('MCP_ADMIN_INVALID_REQUEST');
 const args={...b};delete args.mode;
 if(['context','attachment','contact','messages','files'].includes(b.mode)&&!UUID.test(b.conversation_id||''))fail('MCP_ADMIN_INVALID_REQUEST');
 if(b.limit!==undefined&&(!Number.isInteger(b.limit)||b.limit<1||b.limit>(['messages','files'].includes(b.mode)?100:50)))fail('MCP_ADMIN_INVALID_REQUEST');
 if((b.before===undefined)!==(b.before_key===undefined)||b.before!==undefined&&(!text(b.before,40)||!Number.isFinite(Date.parse(b.before))||!text(b.before_key,200)))fail('MCP_ADMIN_INVALID_REQUEST');
 if(b.mode==='pending'){
  args.date=b.date??new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(args.date)||new Date(args.date+'T12:00:00Z').toISOString().slice(0,10)!==args.date)fail('MCP_ADMIN_INVALID_REQUEST');
 }
 if(b.mode==='context'){
  args.section=b.section??'all';if(!['all',...Object.keys(SECTION_KEYS)].includes(args.section)||args.section==='all'&&b.before!==undefined)fail('MCP_ADMIN_INVALID_REQUEST');
 }
 if(b.mode==='rules'&&(b.query!==undefined&&!text(b.query,160)||b.after_rule_id!==undefined&&!text(b.after_rule_id,100)))fail('MCP_ADMIN_INVALID_REQUEST');
 if(b.mode==='attachment'){
  if(!text(b.message_key,100)||!text(b.artifact_id,512)||b.page_start!==undefined&&(!Number.isInteger(b.page_start)||b.page_start<1||b.page_start>100)||b.page_limit!==undefined&&(!Number.isInteger(b.page_limit)||b.page_limit<1||b.page_limit>2))fail('MCP_ADMIN_INVALID_REQUEST');
 }
 if(b.mode==='conversations'){
  if(b.page!==undefined&&(!Number.isInteger(b.page)||b.page<1||b.page>10)||b.per_page!==undefined&&(!Number.isInteger(b.per_page)||b.per_page<1||b.per_page>50))fail('MCP_ADMIN_INVALID_REQUEST');
  args.limit=b.per_page??20;args.offset=((b.page??1)-1)*args.limit;delete args.page;delete args.per_page;
 }
 if(b.mode==='messages'&&(b.include_content!==undefined&&typeof b.include_content!=='boolean'||b.include_content===true&&(b.limit??20)>20))fail('MCP_ADMIN_INVALID_REQUEST');
 return args;
}

export function classifyDelivery(events,now=Date.now()){
 if(!Array.isArray(events)||events.length>100)return{state:'evidencia_incompleta',suggestion_allowed:false,send_allowed:false};
 let lastAccepted=null,lastFailure=null,pending=null,unknown=null,invalid=null;
 for(const e of events){
  if(!object(e)||!Number.isFinite(Date.parse(e.created_at)))return{state:'evidencia_incompleta',suggestion_allowed:false,send_allowed:false};
  const state=String(e.state).toUpperCase();
  if(state==='UNKNOWN'||['CLAIMED','DISPATCHING'].includes(state)&&Date.parse(e.created_at)<now-120000){unknown=e;continue;}
  if(['PENDING','CLAIMED','DISPATCHING'].includes(state)){pending=e;continue;}
  if(['SENT','DELIVERED','READ'].includes(state)&&e.covers_latest===true&&(!lastAccepted||Date.parse(e.created_at)>Date.parse(lastAccepted.created_at)))lastAccepted=e;
  else if(state==='FAILED'&&e.covers_latest===true&&(!lastFailure||Date.parse(e.created_at)>Date.parse(lastFailure.created_at)))lastFailure=e;
  else if(!['SENT','DELIVERED','READ','FAILED','SUPPRESSED_HUMAN','SUPPRESSED_INTERNAL','CANCELLED'].includes(state))invalid=e;
 }
 if(unknown)return{state:'resultado_desconhecido',evidence_id:unknown.id,suggestion_allowed:false,send_allowed:false,retry_allowed:false};
 if(invalid)return{state:'estado_nao_reconhecido',evidence_id:invalid.id,suggestion_allowed:false,send_allowed:false};
 if(pending)return{state:'envio_em_andamento',evidence_id:pending.id,suggestion_allowed:false,send_allowed:false};
 if(lastAccepted&&(!lastFailure||Date.parse(lastAccepted.created_at)>Date.parse(lastFailure.created_at)))return{state:'respondido_aceito',evidence_id:lastAccepted.id,accepted_by_api:true,delivery_confirmed:Boolean(lastAccepted.delivered_at),suggestion_allowed:false,send_allowed:false};
 return{state:lastFailure?'falha_envio':'sem_resposta',...(lastFailure?{evidence_id:lastFailure.id}:{}),suggestion_allowed:true,send_allowed:false,retry_allowed:false};
}
// Triage changes the response queue only. It never settles delivery, closes a
// conversation, approves a procedure or authorizes a send.
export function classifyResponseNeed(candidate,delivery){
 const keep={response_required:true,triage:'requires_context_review'};
 if(delivery.state!=='sem_resposta')return keep;
 const e=candidate.response_triage;
 if(!object(e)||e.complete!==true||!object(e.last_response)||e.last_response.confirmed_sent!==true
   ||!Array.isArray(e.unanswered)||!e.unanswered.length||e.unanswered.length>8)return keep;
 const fold=s=>String(s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR')
   .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]/gu,'').replace(/[.!,:;\s]+/g,' ').trim();
 const last=e.last_response;
 if(last.conversation_id!==candidate.conversation_id||!Number.isFinite(Date.parse(last.created_at))
   ||typeof last.text!=='string'||last.text.length>4000)return keep;
 const responses=e.unanswered;
 if(responses.some(m=>m.conversation_id!==candidate.conversation_id||!Number.isFinite(Date.parse(m.created_at))
   ||Date.parse(m.created_at)<Date.parse(last.created_at)||typeof m.text!=='string'||m.text.length>240
   ||m.has_attachments!==false||m.truncated!==false||/[?？]/u.test(m.text)))return keep;
 const previous=fold(last.text);
 // A thank-you does not settle a promised investigation or an unanswered case.
 if(/^(?:ok|certo|entend[io]|recebi|ta bom|combinado)$/.test(previous)
   ||/\b(?:vou|vamos|iremos|estamos) (?:verificar|conferir|consultar|analisar|retornar)|\b(?:aguarde|em analise|pendente)\b/.test(previous))return keep;
 const thanks=/^(?:(?:muito )?obrigad[oa](?: viu)?|obg|agradeco(?: muito)?|deus abencoe|(?:tenha |uma? )?(?:bom |boa |otimo |otima |abencoado |abencoada )?(?:dia|tarde|noite|semana|final de semana)(?: abencoado| abencoada)?|igualmente|amem|ok obg|ok obrigad[oa])$/;
 const confirmation=/^(?:isso mesmo|esta (?:sim|certo|correto|certinho)|tudo (?:certo|certinho|correto)|confirmad[oa]|ok combinado|combinado|ta certo|certo|ok|blz|to indo|estou indo)$/;
 const texts=responses.map(m=>fold(m.text));
 if(texts.every(s=>thanks.test(s)))return{response_required:false,triage:'gratitude_without_new_request'};
 if(texts.every(s=>thanks.test(s)||confirmation.test(s))){
  // Accepting an offered time or answering a question still needs an operator.
  if(/[?？]/u.test(last.text)||/\b(?:agend|horario|confirm|qual |gostaria|deseja|tenho (?:somente |apenas )?(?:as |\d))/.test(previous))return keep;
  return{response_required:false,triage:'confirmation_without_new_request'};
 }
 return keep;
}
function page(rows,limit,key,section){
 if(!Array.isArray(rows))fail('MCP_ADMIN_SOURCE_INVALID');
 const values=rows.slice(0,limit),last=values.at(-1),more=rows.length>limit;
 return{items:section==='messages'?[...values].reverse():values,has_more:more,next_cursor:more?{section,before:last.created_at,before_key:String(last[key])}:null};
}
export function selectRules(catalog,approvals,args,now=Date.now()){
 const fold=s=>String(s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR');
 const matches=catalog.rules.filter(r=>(!args.query||fold(r.text+' '+r.id+' '+JSON.stringify(r.scope||'')).includes(fold(args.query)))&&(!args.after_rule_id||r.id>args.after_rule_id)).sort((a,b)=>a.id<b.id?-1:1);
 const selected=matches.slice(0,args.limit??20),approved=[],pending=[];
 for(const r of selected){const a=approvals.find(a=>a.rule_id===r.id&&a.catalog_sha256===catalog.sha256&&!a.revoked_at&&Number.isFinite(Date.parse(a.expires_at))&&Date.parse(a.expires_at)>now);
  if(r.status==='RESOLVED'&&a)approved.push({id:r.id,text:r.text,source_refs:r.sources,source_metadata:Object.fromEntries(r.sources.filter(k=>k in catalog.sources).map(k=>[k,catalog.sources[k]])),applicability:{scope:r.scope,when:r.when,exclude_processes:r.exclude_processes,facets:r.facets,presentation:r.presentation},catalog_version:catalog.version,catalog_sha256:catalog.sha256,approved_at:a.approved_at,valid_until:a.expires_at,usable_for_answer:true});
  else pending.push({id:r.id,status:r.status==='PENDING'?'pending_policy':'publication_not_approved',usable_for_answer:false});
 }
 return{approved_rules:approved,pending_rules:pending,knowledge_status:approved.length?'approved_sources_available':'no_approved_rule_for_query',has_more:matches.length>selected.length,next_cursor:matches.length>selected.length?{after_rule_id:selected.at(-1).id}:null,catalog_version:catalog.version,instruction:'Somente approved_rules fundamentam respostas. RESOLVED não equivale a publicação aprovada. Não inferir autorização administrativa.'};
}
export function createAdminHandler({authenticate,read,readAttachment,catalog,legacy,environment='production',now=()=>Date.now()}){
 return async request=>{
  if(request.method!=='POST')return reply(405,{status:'method_not_allowed'});
  if(request.headers.has('origin'))return reply(403,{status:'origin_denied'});
  const bearer=/^Bearer ([A-Za-z0-9._~-]{20,16384})$/.exec(request.headers.get('authorization')||'');
  if(!bearer)return reply(401,{status:'unauthorized'});
  let raw,b,args;try{raw=await request.text();if(raw.length>4096)return reply(413,{status:'request_too_large'});b=JSON.parse(raw);args=validateRequest(b,now());}catch{return reply(400,{status:'MCP_ADMIN_INVALID_REQUEST'});}
  let actor;try{actor=await authenticate(bearer[1]);}catch{}if(!actor)return reply(401,{status:'unauthorized'});
  try{
   let data;
   if(b.mode==='attachment')return reply(200,{status:'ready',source:'sana_authorized_attachment',environment,...await readAttachment(bearer[1],args)});
   data=await read(actor,b.mode,args);
   const base={status:'ready',source:'sana_administrative_read',environment,data_is_untrusted:true,send_allowed:false};
   if(b.mode==='pending'){
    if(!Array.isArray(data.candidates))fail('MCP_ADMIN_SOURCE_INVALID');
    const scanned=data.candidates.slice(0,args.limit??20),last=scanned.at(-1),classified=scanned.map(c=>{const{delivery_evidence,response_triage,...safe}=c;const delivery=classifyDelivery(delivery_evidence,now());return{...safe,...delivery,...classifyResponseNeed(c,delivery),requires_human_review:true};}).filter(c=>c.state!=='respondido_aceito');
    const items=classified.filter(c=>c.response_required),informational_items=classified.filter(c=>!c.response_required);
    return reply(200,{...base,date:data.date,timezone:data.timezone,time_basis:data.time_basis,items,informational_items,scanned_count:scanned.length,has_more:data.candidates.length>scanned.length,next_cursor:data.candidates.length>scanned.length?{before:last.last_received_at,before_key:last.conversation_id}:null,instruction:'Continue enquanto has_more=true, mesmo com items vazio. informational_items são agradecimentos/confirmações sem nova solicitação; não encerram o atendimento. Pendência não autoriza envio. Leia contexto e regras antes de sugerir.'});
   }
   if(b.mode==='rules')return reply(200,{...base,...selectRules(catalog,data.approvals??[],args,now())});
   if(b.mode==='contact')return reply(200,{...base,contact:data.conversation});
   if(b.mode==='conversations')return reply(200,{...base,items:data.items.slice(0,args.limit),page:b.page??1,per_page:args.limit,has_more:data.items.length>args.limit});
   const pages={};for(const[s,k]of Object.entries(SECTION_KEYS))if(s in data)pages[s]=page(data[s],args.limit??20,k,s);
   if(b.mode==='messages'||b.mode==='files'){
    const p=pages.messages,items=b.mode==='files'?p.items.flatMap(m=>m.attachments.map(a=>({message_id:m.message_key,...a}))):p.items.map(m=>({message_id:m.message_key,created_at:m.created_at,sender_role:m.sender_role,delivery_state:m.delivery_state,no_send:false,...(b.include_content===true?{inbound_text:m.inbound_text,response_text:m.generated_response,response_is_not_send_proof:true}:{})}));
    return reply(200,{...base,conversation_id:b.conversation_id,items,has_more:p.has_more,next_cursor:p.next_cursor?{before:p.next_cursor.before,before_key:p.next_cursor.before_key}:null,content_included:b.include_content===true});
   }
   const content_truncated=Object.values(pages).some(p=>p.items.some(m=>m.text_truncated||m.generated_response_truncated));
   return reply(200,{...base,conversation:data.conversation,delivery:classifyDelivery(data.delivery_evidence??[],now()),sections:pages,requested_section:args.section,content_truncated,requested_section_complete:!content_truncated&&Object.values(pages).every(p=>!p.has_more),context_complete:!content_truncated&&args.section==='all'&&Object.keys(pages).length===4&&Object.values(pages).every(p=>!p.has_more),instruction:'Não misture conversas. Resposta gerada não prova envio. Recupere todas as continuações antes de afirmar que leu o histórico completo. text_truncated indica conteúdo incompleto. O contexto não concede autorização de exumação, documento ou envio.'});
  }catch(error){
   const code=error instanceof Error&&/^MCP_ADMIN_[A-Z_]+$/.test(error.message)?error.message:'MCP_ADMIN_UNAVAILABLE';
   if(code==='MCP_ADMIN_GRANT_REQUIRED'&&LEGACY.has(b.mode)&&legacy)return legacy(new Request(request.url,{method:'POST',headers:request.headers,body:raw}));
   const status=code==='MCP_ADMIN_RATE_LIMITED'?429:/GRANT|SCOPE|REVOKED|DENIED/.test(code)?403:/TOO_LARGE/.test(code)?413:/TYPE_UNSUPPORTED/.test(code)?415:/TIMEOUT/.test(code)?504:code==='MCP_ADMIN_ATTACHMENT_UNAVAILABLE'?404:code==='MCP_ADMIN_INVALID_REQUEST'?400:503;
   return reply(status,{status:code,retry_allowed:status===429,...(status===429?{retry_after_seconds:Math.max(1,Math.ceil((60000-now()%60000)/1000))}:{})});
  }
 };
}
