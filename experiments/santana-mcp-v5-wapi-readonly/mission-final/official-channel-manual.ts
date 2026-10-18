type Value = Record<string, unknown>;
type Invoke = (body: Value) => Promise<{ response: Response; data: Value }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Value => Boolean(v && typeof v === 'object' && !Array.isArray(v));
function providerAttachment(value: unknown, id: unknown): Value | null {
 if (!object(value) || value.artifact_id !== id || typeof value.file_name !== 'string' || !value.file_name || value.file_name.length > 180
  || /[\u0000-\u001f\u007f/\\]/.test(value.file_name) || !['jpg','png','webp','gif','pdf','doc','docx','txt'].includes(String(value.extension))) return null;
 try {
  const url = new URL(String(value.url));
  if (url.origin !== 'https://sfoygvjtnwqvudrbgoom.supabase.co' || !/^\/storage\/v1\/object\/sign\/sana-operator-attachments\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|pdf|doc|docx|txt)$/.test(url.pathname)
   || !url.searchParams.get('token') || url.hash || url.username || url.password) return null;
  return value;
 } catch { return null; }
}
export async function sendManualWhatsApp(body: Value, invoke: Invoke, config: { production: boolean; token: string; instance: string }, transport: typeof fetch = fetch) {
 if (!config.production) return { body: { error: 'PRODUCTION_REQUIRED' }, status: 403 };
 if (!UUID.test(String(body.conversation_id ?? '')) || !UUID.test(String(body.action_id ?? '')) || !Number.isSafeInteger(body.expected_revision)
   || Number(body.expected_revision)<0 || typeof body.text !== 'string' || (!body.text.trim() && !body.attachment_id) || body.text.length > 3000
   || body.attachment_id !== undefined && !UUID.test(String(body.attachment_id))
   || body.attachment_as_document !== undefined && typeof body.attachment_as_document !== 'boolean'
   || body.attachment_as_document === true && !body.attachment_id) return { body: { error: 'INVALID_REPLY' }, status: 400 };
 if (!config.token || !/^[A-Za-z0-9_-]{1,80}$/.test(config.instance)) return { body: { error: 'WAPI_BINDING_UNAVAILABLE' }, status: 503 };
 const prepared = await invoke({ action: 'operator_manual_prepare', conversation_id: body.conversation_id, action_id: body.action_id, expected_revision: body.expected_revision, text: body.text, ...(body.attachment_id ? {attachment_id:body.attachment_id} : {}) });
 if (!prepared.response.ok) return { body: prepared.data, status: prepared.response.status };
 const p = prepared.data;
 const safe = (state: unknown) => ({ status: 'recorded', delivery_state: state, delivery_confirmed: false });
 if (p.status === 'duplicate') return { body: safe(p.delivery_state), status: 200 };
 if (p.status !== 'prepared' || typeof p.no_send !== 'boolean') return { body: { error: 'INVALID_RUNTIME_RECEIPT' }, status: 502 };
 if (p.no_send) return p.delivery_state === 'test' ? { body: safe('test'), status: 200 } : { body: { error: 'INVALID_RUNTIME_RECEIPT' }, status: 502 };
 if (p.delivery_state !== 'dispatching' || !UUID.test(String(p.claim_token ?? '')) || typeof p.recipient_e164 !== 'string'
   || !/^(?:\+[1-9][0-9]{7,14}|[1-9][0-9]{5,19}@lid)$/.test(p.recipient_e164) || p.recipient_e164.startsWith('+120255501') || p.text !== body.text.trim())
   return { body: { error: 'INVALID_RUNTIME_RECEIPT' }, status: 502 };
 const attachment = body.attachment_id ? providerAttachment(p.attachment,body.attachment_id) : null;
 if (body.attachment_id && (!attachment || p.attachment_id !== body.attachment_id)) return {body:{error:'INVALID_RUNTIME_RECEIPT'},status:502};
 // A media message carries its caption in the same provider request. We never
 // send a separate text and attachment that could partially succeed on retry.
 const phone = p.recipient_e164.startsWith('+') ? p.recipient_e164.slice(1) : p.recipient_e164;
 // Document mode forwards the original private object, without the photo pipeline.
 const image = attachment && body.attachment_as_document !== true && ['jpg','png'].includes(String(attachment.extension));
 const endpoint = attachment ? image ? 'send-image' : 'send-document' : 'send-text';
 const payload = attachment ? image ? {phone,image:attachment.url,caption:p.text,delayMessage:1}
  : {phone,document:attachment.url,extension:attachment.extension,fileName:attachment.file_name,caption:p.text,delayMessage:1}
  : {phone,message:p.text,delayMessage:1};
 let outcome = 'unknown'; let providerMessageId: string | null = null;
 try {
  const r = await transport('https://api.w-api.app/v1/message/' + endpoint + '?instanceId=' + encodeURIComponent(config.instance), {
   method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(attachment ? 20000 : 8000),
   headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
   body: JSON.stringify(payload),
  });
  if (!r.ok) outcome = r.status >= 500 ? 'unknown' : 'failed';
  else {
   const v: unknown = await r.json();
   if (object(v)) {
    const nested = object(v.data) ? v.data : {};
    const id = v.messageId ?? nested.messageId; const instance = v.instanceId ?? nested.instanceId;
    if (v.error === true || nested.error === true || v.success === false || nested.success === false) outcome = 'failed';
    else if (typeof id === 'string' && /^[A-Za-z0-9._:@-]{1,200}$/.test(id) && (!instance || instance === config.instance)) { outcome = 'sent'; providerMessageId = id; }
   }
  }
 } catch { /* Ambiguous outcomes are persisted and never automatically resent. */ }
 try {
  const settled = await invoke({ action: 'operator_manual_settle', action_id: body.action_id, claim_token: p.claim_token, outcome, provider_message_id: providerMessageId });
  if (!settled.response.ok || !['committed','duplicate'].includes(String(settled.data.status))) return { body: safe('unknown'), status: 200 };
  return { body: safe(settled.data.delivery_state), status: 200 };
 } catch { return { body: safe('unknown'), status: 200 }; }
}


