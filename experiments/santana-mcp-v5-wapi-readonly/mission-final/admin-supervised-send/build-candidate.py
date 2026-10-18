"""Delta over verified deployed sources. Does not deploy or call a provider."""
import hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parent
def once(s,a,b):
    if s.count(a)!=1:raise SystemExit('BASELINE_DRIFT: '+a[:80])
    return s.replace(a,b,1)
def build():
    o=R/'candidate';o.mkdir(exist_ok=True)
    sql=(R/'baseline-coordinator.sql').read_text()
    sql=once(sql,"kind text=p->>'operation';","kind text=p->>'operation'; admin_scope boolean=false;")
    sql=once(sql," if kind='status' then", " if kind in ('authorize','prepare') then\n  admin_scope=public.sana_mcp_supervised_scope(sub,cli,actor,cid,true);\n end if;\n if kind='status' then")
    sql=once(sql," if not exists(select 1 from public.sana_mcp_send_permissions", " if not admin_scope and not exists(select 1 from public.sana_mcp_send_permissions")
    sql=once(sql," if not exists(select 1 from public.sana_mcp_read_access", " if not admin_scope and not exists(select 1 from public.sana_mcp_read_access")
    sql=once(sql," if kind='authorize' then\n  if not sana_mcp_private.session_active", " if kind='authorize' then\n  if admin_scope and p->'payload'->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(cid) then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;\n  if not sana_mcp_private.session_active")
    sql=once(sql," if o.expires_at<=clock_timestamp()", " if admin_scope and o.payload->'conversation_watermark' is distinct from public.sana_mcp_conversation_watermark(cid) then raise exception 'MCP_RECENT_MESSAGES_CHANGED';end if;\n if o.expires_at<=clock_timestamp()")
    read=(R.parent/'admin-assist/context-timeline-upgrade.sql').read_text()
    read=once(read,"'contact_key','+••••••'||right(c.contact_key,4),'revision',c.revision,", "'contact_key','+••••••'||right(c.contact_key,4),'message_watermark',public.sana_mcp_conversation_watermark(cid),'revision',c.revision,")
    (o/'database.sql').write_text('begin;\nset local lock_timeout=\'3s\';\nset local statement_timeout=\'15s\';\n'+(R/'access-candidate.sql').read_text()+'\n'+sql+'\n'+read+'\ncommit;\n')
    edge=(R/'baseline-edge-operations.ts').read_text()
    anchor="   const binding=await service.from('sana_mcp_read_access')"
    edge=once(edge,anchor,"   const supervised=await service.rpc('sana_mcp_supervised_scope',{p_subject:proof.actor.id,p_client:CLIENT,p_operator:operator.id,p_conversation:proof.payload.conversation_id,p_live:b.action==='operator_mcp_authorize'});\n   if(supervised.error)throw Error(/^MCP_[A-Z_]+$/.test(supervised.error.message||'')?supervised.error.message:'MCP_SUPERVISED_SCOPE_UNAVAILABLE');\n   const administrative=supervised.data===true;\n   const binding=administrative?{data:{operator_id:operator.id},error:null}:await service.from('sana_mcp_read_access')")
    edge=once(edge,"   const permission=await service.from('sana_mcp_send_permissions')", "   const permission=administrative?{data:{live_enabled:true},error:null}:await service.from('sana_mcp_send_permissions')")
    (o/'mcp-official-operations.ts').write_text(edge)
    intent=(R.parent/'supervised-send/homolog/send-intents-core.mjs').read_text()
    intent=once(intent,"expected_revision:c.revision,text:b.text,", "expected_revision:c.revision,...(c.message_watermark?{conversation_watermark:c.message_watermark}:{}),text:b.text,")
    (o/'send-intents-core.mjs').write_text(intent)
    provider=(R.parent/'supervised-send/official_send_provider.py').read_text()+'\n'+(R/'status-client.py').read_text()
    (o/'official_send_provider.py').write_text(provider)
    server=(R.parent/'admin-assist/candidate/homolog-mcp/whatsapp-santana-mcp/server.py').read_text()
    marker='        elif name in READ_TOOLS:'
    server=once(server,marker,"            if name == 'consultar_envio_preparado':\n                from official_send_provider import consult_official_status\n                result['official_status']=consult_official_status(args['intent_id'],access_token)\n"+marker)
    (o/'server.py').write_text(server)
    # Same payload hash binds the watermark, recipient, full content, attachment and operation.
    manifest={'status':'ISOLATED_NOT_DEPLOYED','production_approval_required':True,'real_messages_sent':0,'new_write_grants':0,'baselines':{'prod_edge_version':42,'homolog_edge_version':14,'mcp_deployment':'dpl_8dfbsPTvZ6eDzsmmXBEN3Pnjf2Am','panel_commit':'58a242926cbae6213e079f18234cad8eb87e0f59','coordinator_sha256':hashlib.sha256((R/'baseline-coordinator.sql').read_bytes()).hexdigest(),'official_edge_sha256':hashlib.sha256((R/'baseline-edge-operations.ts').read_bytes()).hexdigest()},'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(o.glob('*')) if p.is_file()}}
    (R/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
if __name__=='__main__':build()
