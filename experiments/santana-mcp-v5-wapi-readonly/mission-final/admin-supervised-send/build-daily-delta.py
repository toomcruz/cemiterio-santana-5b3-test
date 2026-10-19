"""One reviewable delta over the existing components. Never deploys or grants."""
import hashlib,json,shutil
from pathlib import Path
R=Path(__file__).resolve().parent;A=R.parent/'admin-assist'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    out=R/'deployment-delta';out.mkdir(exist_ok=True)
    sources={
      'database.sql':R/'candidate/database.sql',
      'prod-edge/mcp-admin-core.mjs':A/'candidate/prod-edge/mcp-admin-core.mjs',
      'prod-edge/mcp-admin-assist.ts':A/'candidate/prod-edge/mcp-admin-assist.ts',
      'prod-edge/mcp-official-operations.ts':R/'candidate/mcp-official-operations.ts',
      'panel/lib/sana/mcp-read-media.mjs':A/'candidate/panel/lib/sana/mcp-read-media.mjs',
      'homolog-edge/send-intents-core.mjs':R/'candidate/send-intents-core.mjs',
      'mcp/whatsapp-santana-mcp/server.py':R/'candidate/server.py',
      'mcp/whatsapp-santana-mcp/official_send_provider.py':R/'candidate/official_send_provider.py',
      'mcp/whatsapp-santana-mcp/sana_read_provider.py':A/'candidate/homolog-mcp/whatsapp-santana-mcp/sana_read_provider.py',
      'mcp/whatsapp-santana-mcp/admin_assist_tools.py':A/'candidate/homolog-mcp/whatsapp-santana-mcp/admin_assist_tools.py',
    }
    for name,source in sources.items():
        dest=out/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
    manifest={'status':'AWAITING_EXPLICIT_PRODUCTION_APPROVAL','production_changes':0,'real_messages_sent':0,
      'scope':{'read_grant_expanded':False,'new_grant':'individual_supervised_send_for_current_operator_and_read_scope_only','per_operation_independent_review':True,'batch_send_enabled':False,'autonomous_send_enabled':False,'expiry':'inherit current administrative read grant; never extend it'},
      'baseline':{'prod_edge_version':42,'homolog_edge_version':15,'panel_deployment':'dpl_9dNM9kTUwfnudfBb7oqMbmXzRNcg','panel_commit':'58a242926cbae6213e079f18234cad8eb87e0f59','mcp_deployment':'dpl_8dfbsPTvZ6eDzsmmXBEN3Pnjf2Am',
       'coordinator_sha256':digest(A/'current-baseline/coordinator.sql'),'admin_read_sha256':digest(A/'current-baseline/admin_read.sql'),
       'prod_module_sha256':{name:digest(A/'current-baseline'/name) for name in ['mcp-admin-core.mjs','mcp-admin-assist.ts','mcp-official-operations.ts']},
       'homolog_core_sha256':digest(A/'current-baseline/homolog-send-intents-core.mjs'),
       'mcp_raw_sha1':{'server.py':'b4f55e4ec5cef8c21cca405d8667e8a111a426fb','official_send_provider.py':'f9f007d97d1f14ede1aaa19c78861694cfd0ae9d','sana_read_provider.py':'becc9f1ad46036f2d1eeac22684f8e0b2068e6a1','admin_assist_tools.py':'90cde295cead2f6be5293f1486f25c166aad8aa6'}},
      'files':{name:digest(out/name) for name in sorted(sources)}}
    release=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    activation=(R/'activate-after-approval.sql').read_text()
    import re
    activation=re.sub(r'd183abaab3ed104f66d65886c902fc52a4c446e7e946a510cfb285cce384ed6b',release,activation)
    (out/'activate-after-approval.sql').write_text(activation)
    manifest.update(release_sha256=release,activation_sha256=digest(out/'activate-after-approval.sql'))
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'status':manifest['status'],'deployment_files':len(sources),'release_sha256':release,'production_changes':0,'real_messages_sent':0}))
if __name__=='__main__':main()
