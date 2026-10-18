// Reuses the Panel's immutable attachment bucket and native staging RPC.
// No WhatsApp transport, provider credentials or public upload endpoints.
export const BUCKET='sana-operator-attachments';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXT={'image/png':'png','image/jpeg':'jpg','application/pdf':'pdf'};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function validMedia(a){
 return !!a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).sort().join(',')==='mime_type,name,sha256,size_bytes'
  &&typeof a.name==='string'&&a.name===a.name.trim()&&a.name.length>0&&a.name.length<=100&&!/[\x00-\x1f\x7f/\\]/.test(a.name)
  &&Object.hasOwn(EXT,a.mime_type)&&Number.isSafeInteger(a.size_bytes)&&a.size_bytes>=16&&a.size_bytes<=524288&&/^[a-f0-9]{64}$/.test(a.sha256||'');
}
export function attemptKind(a){if(a===null)return 'one_real_text_attempt';if(!validMedia(a))throw Error('MCP_ATTACHMENT_INVALID');return a.mime_type==='application/pdf'?'one_real_document_attempt':'one_real_image_attempt';}
async function checkBytes(file,a){
 if(!validMedia(a)||file.size!==a.size_bytes||file.type.split(';')[0]!==a.mime_type)throw Error('MCP_ATTACHMENT_CONTENT_MISMATCH');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const magic=a.mime_type==='image/png'?[137,80,78,71,13,10,26,10]:a.mime_type==='image/jpeg'?[255,216,255]:[37,80,68,70,45];
 if(!magic.every((n,i)=>bytes[i]===n)||await digest(bytes)!==a.sha256)throw Error('MCP_ATTACHMENT_CONTENT_MISMATCH');
 return bytes;
}
export async function reviewedBytes(proof){
 const a=proof.payload?.attachment,b64=proof.attachment_base64;
 if(!validMedia(a)||typeof b64!=='string'||b64.length>700000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64))throw Error('MCP_ATTACHMENT_CONTENT_MISMATCH');
 const bytes=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));
 await checkBytes(new Blob([bytes],{type:a.mime_type}),a);return bytes;
}
function manifest(a,row,actor,cid,op){
 if(!UUID.test(row?.artifact_id||'')||row.actor_id!==actor||row.conversation_id!==cid||row.action_id!==op
  ||row.file_name!==a.name||row.mime_type!==a.mime_type||row.size_bytes!==a.size_bytes||row.sha256!==a.sha256
  ||row.storage_path!==`${actor}/${cid}/${op}.${EXT[a.mime_type]}`||Date.parse(row.created_at)<Date.now()-7200000||!Number.isFinite(Date.parse(row.created_at)))throw Error('MCP_ATTACHMENT_BINDING_CHANGED');
}
export async function stageApprovedMedia(service,proof,actor,op){
 const a=proof.payload.attachment,bytes=await reviewedBytes(proof),cid=proof.payload.conversation_id;
 const staged=await service.rpc('sana_stage_operator_attachment',{p_actor:actor,p_conversation:cid,p_action:op,p_name:a.name,p_mime:a.mime_type,p_size:a.size_bytes,p_hash:a.sha256});
 if(staged.error||staged.data?.status!=='ready'||!UUID.test(staged.data.artifact_id||''))throw Error('MCP_ATTACHMENT_STAGE_FAILED');
 const lookup=await service.from('sana_operator_attachments').select('*').eq('artifact_id',staged.data.artifact_id).eq('actor_id',actor).eq('action_id',op).maybeSingle();
 if(lookup.error||!lookup.data)throw Error('MCP_ATTACHMENT_STAGE_FAILED');
 const row=lookup.data;manifest(a,row,actor,cid,op);const bucket=service.storage.from(BUCKET);
 let stored=await bucket.download(row.storage_path);
 if(stored.error){
  if(String(stored.error.statusCode??stored.error.status)!=='404')throw Error('MCP_ATTACHMENT_STORAGE_UNAVAILABLE');
  const upload=await bucket.upload(row.storage_path,bytes,{contentType:a.mime_type,upsert:false,cacheControl:'300'});
  if(upload.error)throw Error('MCP_ATTACHMENT_UPLOAD_FAILED');
  stored=await bucket.download(row.storage_path);
 }
 if(stored.error||!stored.data)throw Error('MCP_ATTACHMENT_STORAGE_UNAVAILABLE');
 await checkBytes(stored.data,a);
 const verified=await service.from('sana_operator_attachments').update({verified_at:new Date().toISOString()}).eq('artifact_id',row.artifact_id).eq('actor_id',actor).eq('conversation_id',cid).eq('action_id',op).select('artifact_id').maybeSingle();
 if(verified.error||verified.data?.artifact_id!==row.artifact_id)throw Error('MCP_ATTACHMENT_STAGE_FAILED');
 return row.artifact_id;
}
export async function officialMediaReceipt(service,operation){
 const a=operation.payload?.attachment;
 if(!validMedia(a)||!UUID.test(operation.attachment_id||''))throw Error('MCP_ATTACHMENT_BINDING_CHANGED');
 const found=await service.from('sana_operator_attachments').select('*').eq('artifact_id',operation.attachment_id).eq('actor_id',operation.operator_id).eq('action_id',operation.operation_id).maybeSingle();
 if(found.error||!found.data?.verified_at)throw Error('MCP_ATTACHMENT_NOT_READY');
 const row=found.data;manifest(a,row,operation.operator_id,operation.conversation_id,operation.operation_id);
 const bucket=service.storage.from(BUCKET),stored=await bucket.download(row.storage_path);
 if(stored.error||!stored.data)throw Error('MCP_ATTACHMENT_STORAGE_UNAVAILABLE');await checkBytes(stored.data,a);
 const signed=await bucket.createSignedUrl(row.storage_path,300);
 if(signed.error||!signed.data?.signedUrl)throw Error('MCP_ATTACHMENT_NOT_READY');
 const url=new URL(signed.data.signedUrl);
 if(url.origin!=='https://sfoygvjtnwqvudrbgoom.supabase.co'||url.pathname!==`/storage/v1/object/sign/${BUCKET}/${row.storage_path}`||!url.searchParams.get('token')||url.hash||url.username||url.password)throw Error('MCP_ATTACHMENT_NOT_READY');
 return {artifact_id:row.artifact_id,url:url.href,file_name:a.name,mime_type:a.mime_type,extension:EXT[a.mime_type]};
}
