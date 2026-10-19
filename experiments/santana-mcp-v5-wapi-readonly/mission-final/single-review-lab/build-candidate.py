"""Build an isolated delta. No credentials, deploy call, service control or network."""
from pathlib import Path
import hashlib,json
R=Path(__file__).resolve().parent; C=R/'candidate'; ROOT=R.parent;written=[]
def put(path,body):
    p=C/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(body);written.append(p)
def edit(body,old,new):
    if body.count(old)!=1:raise SystemExit('BASELINE_ANCHOR_CHANGED')
    return body.replace(old,new)
for src,dest in [('single-review-edge.ts','prod-edge/single-review-edge.ts'),('panel-review.sql','database.sql'),('single-review-core.mjs','panel/lib/sana/single-review-core.mjs'),('panel-binding.ts','panel/lib/sana/single-review-binding.ts'),('review-screen.tsx','panel/lib/sana/single-review-screen.tsx'),('panel-page.tsx','panel/app/mcp-review/page.tsx'),('mcp-panel-review.py','mcp/panel_review_provider.py')]:put(dest,(R/src).read_text())
route=(R/'baseline/app/api/runtime/sana-control/route.ts').read_text()
route="import {singleReviewBinding} from '@/lib/sana/single-review-binding';\n"+route
route=edit(route,'"mcp_send", "mcp_status"]);','"mcp_send", "mcp_status", "mcp_review_stage", "mcp_review_status", "mcp_review_list", "mcp_review_preview", "mcp_review_receipt", "mcp_review_approve_send"]);')
anchor='    if (["mcp_authorize","mcp_preview","mcp_send","mcp_status"].includes(String(body.action))) {'
route=edit(route,anchor,'''    if (String(body.action).startsWith('mcp_review_')) {
      if (process.env.SANTANA_SINGLE_REVIEW_READY !== 'verified') return json({error:'MCP_PANEL_REVIEW_DISABLED'},503);
      const clean=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(body)});
      const result=await singleReviewBinding(clean,invoke,{production:process.env.VERCEL_ENV==='production',token:process.env.WAPI_TOKEN??'',instance:process.env.WAPI_INSTANCE_ID??''});
      return json(await result.json(),result.status);
    }
'''+anchor)
route=edit(route,"['operator_mcp_authorize','operator_mcp_prepare'].includes", "['operator_mcp_authorize','operator_mcp_prepare','operator_mcp_review_approve','operator_mcp_review_prepare'].includes")
put('panel/app/api/runtime/sana-control/route.ts',route)
h=(R/'baseline/send-intents-core.mjs').read_text()
h=edit(h,"['prepare','status','human_preview','approve','human_binding_proof','oauth_binding_proof'].includes(b.action)","['prepare','status','human_preview','approve','human_binding_proof','oauth_binding_proof','panel_binding_proof'].includes(b.action)")
h=edit(h,"const bindingProof=['human_binding_proof','oauth_binding_proof'].includes(b.action);","const bindingProof=['human_binding_proof','oauth_binding_proof','panel_binding_proof'].includes(b.action);")
h=edit(h,"   const bindingProof=", "   if(b.action==='panel_binding_proof'&&(!row||row.client_id!==actor.client_id||row.state!=='prepared'||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=now()))return json(404,{status:'intent_not_available'});\n   const bindingProof=")
h=edit(h,"...(human?{attachment_base64:row.attachment_base64}:{}),","...((human||b.action==='panel_binding_proof')?{attachment_base64:row.attachment_base64}:{}),")
put('homolog-edge/send-intents-core.mjs',h)
s=(ROOT/'admin-supervised-send/deployment-delta/mcp/whatsapp-santana-mcp/server.py').read_text()
old='''            result = PROVIDER._call({"mode":"send_intent", "action":"prepare" if name == "preparar_envio" else "status", **args}, access_token)
            if name == 'consultar_envio_preparado':
                from official_send_provider import consult_official_status
                result['official_status']=consult_official_status(args['intent_id'],access_token)'''
new='''            from panel_review_provider import panel_review
            if name == 'preparar_envio':
                context = PROVIDER._call({"mode":"context","conversation_id":args.get('conversation_id'),"section":"messages","limit":20},access_token)
                if context.get('status') != 'ready' or context.get('conversation',{}).get('conversation_id') != args.get('conversation_id'):
                    raise MCPError(-32003,'Contexto atualizado indisponível; nenhuma revisão foi liberada.')
                result = PROVIDER._call({"mode":"send_intent", "action":"prepare", **args}, access_token)
                if result.get('status') == 'ready':
                    current = context['conversation']
                    payload = result.get('payload',{})
                    if current.get('revision') != payload.get('expected_revision') or not current.get('message_watermark') or current['message_watermark'] != payload.get('conversation_watermark'):
                        raise MCPError(-32003,'O atendimento mudou durante a preparação. Consulte o contexto novamente; nada foi enviado.')
                    staged = panel_review('stage',result['intent_id'],access_token,result['payload_sha256'])
                    result.pop('approval_url',None)
                    result['refreshed_context'] = context
                    result['panel_review'] = staged
                    result['review_ready'] = staged.get('status') == 'ready'
                    if result['review_ready']:result['approval_url'] = staged['review_url']
            else:
                result = panel_review('status',args['intent_id'],access_token)
                # Old operations retain the previously validated path. An outage
                # or permission error must never be mistaken for not-found.
                if result.get('error') == 'MCP_PANEL_DRAFT_NOT_AVAILABLE':
                    result = PROVIDER._call({"mode":"send_intent", "action":"status", **args}, access_token)
                    from official_send_provider import consult_official_status
                    result['official_status']=consult_official_status(args['intent_id'],access_token)'''
s=edit(s,old,new)
s=edit(s,'Registra preparação e prévia integral para uma única conversa autorizada. Não envia; revisão humana independente e coordenação continuam obrigatórias. Anexos PNG/JPEG/PDF até 512 KiB.','Prepara resposta e contexto atualizado. Abra approval_url no Painel; a sessão individual revisa e aciona uma única tentativa no botão Aprovar e enviar. Esta ferramenta não envia. Anexos PNG/JPEG/PDF até 512 KiB.')
s=edit(s,'Consulta somente sua preparação e revisão. Não executa envio nem confirma entrega.','Consulta a preparação e o recibo oficial após Aprovar e enviar no Painel. Distingue aceite e entrega confirmada; não envia nem repete tentativas.')
put('mcp/server.py',s)
# Mount the new handler behind the existing PROD caller gate. The full private
# Edge source is not duplicated into this repository; deployment applies this
# exact anchored patch to its fresh hash-verified backup.
put('prod-edge/mount.json',json.dumps({'import':"import {singleReviewOperation} from './single-review-edge.ts';\n",'anchor':"  if (['operator_mcp_identity','operator_mcp_preview','operator_mcp_authorize','operator_mcp_prepare','operator_mcp_settle','operator_mcp_status'].includes(action)) return mcpOfficialOperation(request,body,service);",'insert_before':"  if (['operator_mcp_review_stage','operator_mcp_review_status','operator_mcp_review_list','operator_mcp_review_preview','operator_mcp_review_approve','operator_mcp_review_prepare','operator_mcp_review_settle','operator_mcp_review_receipt'].includes(action)) return singleReviewOperation(request,body,service);\n"},indent=2)+'\n')
manifest={str(p.relative_to(C)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(written)}
(R/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'status':'CANDIDATE_ONLY','files':len(manifest),'manifest_sha256':hashlib.sha256((R/'candidate-manifest.json').read_bytes()).hexdigest(),'production_changes':0,'real_sends':0}))
# Local fixtures import the actual deployed identity/media/sender code unchanged.
T=R/'test-runtime';T.mkdir(exist_ok=True)
for src,dest in [(R/'single-review-edge.ts','single-review-edge.ts'),(R/'baseline/prod-mcp-official-operations.ts','mcp-official-operations.ts'),(R/'baseline/media-attachments.mjs','media-attachments.mjs')]:
    (T/dest).write_bytes(src.read_bytes())
