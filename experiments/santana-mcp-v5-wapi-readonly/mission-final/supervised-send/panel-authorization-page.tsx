"use client";
import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {createSupabaseBrowserClient} from '@/lib/supabase-browser';
import {SANTANA_PANEL_URL,SANTANA_PANEL_PUBLISHABLE_KEY} from '@/lib/santana-panel-config';
const HMG='https://santana-mcp-homolog-consent.vercel.app';
async function boundedSession<T>(pending:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('A sessão do Painel não respondeu. Volte ao ChatGPT para conferir; nenhuma tentativa será repetida automaticamente.')),10000);})]);}finally{clearTimeout(timer!);}}
export default function AuthorizeMcp(){
 const supabase=useMemo(()=>createSupabaseBrowserClient(SANTANA_PANEL_URL,SANTANA_PANEL_PUBLISHABLE_KEY),[]);
 const secret=useRef(''),operation=useRef(''),submitting=useRef(false),consent=useRef<HTMLInputElement>(null);
 const [preview,setPreview]=useState<any>(null),[status,setStatus]=useState('Aguardando a revisão protegida.'),[busy,setBusy]=useState(false),[complete,setComplete]=useState(false);
 const call=async(action:string,extra:object={})=>{
  if(!supabase)throw Error('A conexão do Painel está indisponível.');
  const session=await boundedSession(supabase.auth.getSession());const token=session.data.session?.access_token;
  if(!token)throw Error('Entre no Painel oficial em outra aba e volte a esta tela.');
  const r=await fetch('/api/runtime/sana-control',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,'x-santana-human-review':secret.current,'content-type':'application/json'},body:JSON.stringify({action,operation_id:operation.current,...extra})});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Operação indisponível');return d;
 };
 useEffect(()=>{
  const id=new URLSearchParams(location.search).get('operation')||'',nonce=location.hash.slice(1);operation.current=id;
  if(!/^[0-9a-f-]{36}$/i.test(id)||!nonce||!window.opener){setStatus('Abra esta tela pela revisão protegida do MCP.');return;}
  let active=true;
  const receive=async(event:MessageEvent)=>{if(event.origin!==HMG||event.source!==window.opener||event.data?.type!=='santana-reviewed-session'||event.data.nonce!==nonce||typeof event.data.token!=='string'||event.data.token.length>16384||secret.current)return;secret.current=event.data.token;try{const d=await call('mcp_preview');if(active){setPreview(d);setStatus('Confira o conteúdo, marque a caixa e use o botão verde para registrar a autorização.');}}catch(error){if(active)setStatus(error instanceof Error?error.message:'Prévia indisponível.');}};
  window.addEventListener('message',receive);window.opener.postMessage({type:'santana-session-request',nonce},HMG);
  return()=>{active=false;secret.current='';window.removeEventListener('message',receive);};
 // One handshake per document; no automatic authentication or send retries.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const authorize=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(submitting.current||!preview)return;
  if(consent.current?.checked!==true){setStatus('Marque a caixa para autorizar este destinatário e conteúdo.');return;}
  submitting.current=true;setBusy(true);setStatus('Registrando sua autorização no Painel…');
  try{
   const d=await call('mcp_authorize',{payload_sha256:preview.payload_sha256,explicit_authorization:'one_real_text_attempt'});
   if(d.status!=='authorized'&&!(d.status==='duplicate'&&d.state==='authorized'))throw Error('Autorização não confirmada. Volte ao ChatGPT para consultar esta operação.');
   setStatus('Autorização registrada. Volte ao ChatGPT para executar a única tentativa autorizada. Nenhuma mensagem foi enviada por esta tela.');setComplete(true);setPreview(null);secret.current='';
  }catch(error){setStatus(error instanceof Error&&error.name!=='TimeoutError'?error.message:'Não foi possível confirmar o registro no prazo. Volte ao ChatGPT para conferir esta operação antes de tentar novamente.');}
  finally{submitting.current=false;setBusy(false);}
 };
 return <main style={{maxWidth:680,margin:'40px auto',padding:28,fontFamily:'system-ui',background:'#fff',border:'1px solid #dbe4df',borderRadius:12,color:'#172421'}}>
  <h1 style={{fontSize:26,fontWeight:650,marginBottom:16}}>Autorizar uma mensagem do ChatGPT</h1>
  <p role="status" aria-live="polite" style={{padding:16,background:complete?'#e5f4ec':'#f1f5f3',borderRadius:8,marginBottom:20}}>{status}</p>
  {preview&&<><p><strong>{preview.payload.recipient.name} · {preview.payload.recipient.phone_mask}</strong></p><p style={{margin:'12px 0',fontSize:14,overflowWrap:'anywhere'}}>Operação: {preview.operation_id}</p><pre style={{whiteSpace:'pre-wrap',padding:16,background:'#f5f7f6',lineHeight:1.6,borderRadius:8}}>{preview.payload.text}</pre><p style={{margin:'16px 0'}}>Sem anexos. Validade: {new Date(preview.expires_at).toLocaleString('pt-BR')}.</p>
   <form onSubmit={authorize} aria-busy={busy}>
    <label style={{display:'flex',alignItems:'flex-start',gap:12,padding:'16px 0',cursor:'pointer'}}><input ref={consent} name="singleAttempt" type="checkbox" required disabled={busy} style={{width:20,height:20,flexShrink:0,marginTop:2,accentColor:'#176b50'}}/><span>Autorizo uma única tentativa real para esse destinatário e conteúdo.</span></label>
    <button type="submit" disabled={busy} style={{display:'block',width:'100%',minHeight:48,padding:'14px 20px',border:'1px solid #176b50',borderRadius:8,background:'#176b50',color:'#fff',fontSize:17,fontWeight:650,cursor:busy?'wait':'pointer',opacity:busy?0.7:1}}>{busy?'Registrando autorização…':'Confirmar autorização'}</button>
    <p style={{fontSize:14,lineHeight:1.5,marginTop:12}}>Este botão registra sua autorização. A execução será feita pelo ChatGPT; esta tela não envia a mensagem.</p>
   </form></>}
 </main>;
}
