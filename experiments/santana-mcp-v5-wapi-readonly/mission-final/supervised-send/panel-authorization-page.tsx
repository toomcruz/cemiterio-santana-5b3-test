"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {createSupabaseBrowserClient} from '@/lib/supabase-browser';
import {SANTANA_PANEL_URL,SANTANA_PANEL_PUBLISHABLE_KEY} from '@/lib/santana-panel-config';
const HMG='https://santana-mcp-homolog-consent.vercel.app';
export default function AuthorizeMcp(){
 const supabase=useMemo(()=>createSupabaseBrowserClient(SANTANA_PANEL_URL,SANTANA_PANEL_PUBLISHABLE_KEY),[]);
 const secret=useRef('');const [preview,setPreview]=useState<any>(null),[status,setStatus]=useState('Aguardando a revisão protegida.'),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false);
 const operation=useRef('');
 const call=async(action:string,extra:object={})=>{const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;if(!token)throw Error('Entre no Painel oficial em outra aba e volte a esta tela.');const r=await fetch('/api/runtime/sana-control',{method:'POST',cache:'no-store',headers:{authorization:'Bearer '+token,'x-santana-human-review':secret.current,'content-type':'application/json'},body:JSON.stringify({action,operation_id:operation.current,...extra})});const d=await r.json();if(!r.ok)throw Error(d.error||'Operação indisponível');return d;};
 useEffect(()=>{
  const id=new URLSearchParams(location.search).get('operation')||'',nonce=location.hash.slice(1);operation.current=id;
  if(!/^[0-9a-f-]{36}$/i.test(id)||!nonce||!window.opener){setStatus('Abra esta tela pela revisão protegida do MCP.');return;}
  let active=true;
  const receive=async(event:MessageEvent)=>{if(event.origin!==HMG||event.source!==window.opener||event.data?.type!=='santana-reviewed-session'||event.data.nonce!==nonce||typeof event.data.token!=='string'||event.data.token.length>16384||secret.current)return;secret.current=event.data.token;try{const d=await call('mcp_preview');if(active){setPreview(d);setStatus('Confira antes de autorizar uma única tentativa. Esta tela não envia a mensagem.');}}catch(error){if(active)setStatus(error instanceof Error?error.message:'Prévia indisponível.');}};
  window.addEventListener('message',receive);window.opener.postMessage({type:'santana-session-request',nonce},HMG);
  return()=>{active=false;secret.current='';window.removeEventListener('message',receive);};
 // Deliberately one initialization; no automatic authentication or send retries.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const authorize=async()=>{setBusy(true);try{const d=await call('mcp_authorize',{payload_sha256:preview.payload_sha256,explicit_authorization:'one_real_text_attempt'});setStatus(d.status==='authorized'||d.status==='duplicate'?'Autorização registrada. Volte ao ChatGPT para executar uma única tentativa.':'Autorização não confirmada.');setPreview(null);secret.current='';}catch(error){setStatus(error instanceof Error?error.message:'Autorização não confirmada.');}finally{setBusy(false);}};
 return <main style={{maxWidth:680,margin:'40px auto',padding:24,fontFamily:'system-ui'}}><h1>Autorizar uma mensagem do ChatGPT</h1><p role="status">{status}</p>{preview&&<><p><strong>{preview.payload.recipient.name} · {preview.payload.recipient.phone_mask}</strong></p><p>Operação: {preview.operation_id}</p><pre style={{whiteSpace:'pre-wrap'}}>{preview.payload.text}</pre><p>Sem anexos. Validade: {new Date(preview.expires_at).toLocaleString('pt-BR')}.</p><label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> Autorizo uma única tentativa real para esse destinatário e conteúdo.</label><p><button disabled={!checked||busy} onClick={authorize}>Autorizar uma tentativa — execução pelo ChatGPT</button></p></>}</main>;
}
