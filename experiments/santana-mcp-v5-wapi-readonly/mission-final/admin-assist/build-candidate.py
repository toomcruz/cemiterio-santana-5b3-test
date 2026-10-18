"""Build only reviewable overlays. Never deploy, invoke providers or change ACLs."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent
def replace_once(s,old,new):
    if s.count(old)!=1:raise SystemExit('BASELINE_DRIFT: '+old[:70])
    return s.replace(old,new,1)
def sha(b):return hashlib.sha256(b).hexdigest()
def build():
    out=ROOT/'candidate';out.mkdir(exist_ok=True)
    for d in ('prod-edge','homolog-edge','homolog-mcp/api','homolog-mcp/whatsapp-santana-mcp','panel/lib/sana','panel/app/api/runtime/sana-media'):(out/d).mkdir(parents=True,exist_ok=True)
    for source,target in [('admin-core.mjs','prod-edge/mcp-admin-core.mjs'),('identity-core.mjs','prod-edge/mcp-admin-identity.mjs'),('mcp-admin-assist.ts','prod-edge/mcp-admin-assist.ts'),('mcp-read-media.mjs','panel/lib/sana/mcp-read-media.mjs'),('admin_assist_tools.py','homolog-mcp/whatsapp-santana-mcp/admin_assist_tools.py'),('attachment_worker.py','homolog-mcp/whatsapp-santana-mcp/attachment_worker.py'),('requirements.txt','homolog-mcp/requirements.txt')]:
        shutil.copyfile(ROOT/source,out/target)
    catalog=json.loads((ROOT/'baseline-rules.v2.json').read_text());catalog['sha256']=sha((ROOT/'baseline-rules.v2.json').read_bytes())
    (out/'prod-edge/mcp-rule-catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    prod=(ROOT/'baseline-prod-index.ts').read_text()
    prod=replace_once(prod,"import {productionMcpRead} from './mcp-production.ts';","import {administrativeMcpRead as productionMcpRead,administrativeAttachment} from './mcp-admin-assist.ts';")
    anchor="  if (['operator_mcp_identity'"
    if prod.count(anchor)!=1:raise SystemExit('PROD_MOUNT_DRIFT')
    prod=prod.replace(anchor,"  if (['operator_mcp_attachment_reference','operator_mcp_attachment_record'].includes(action)) return administrativeAttachment(request,body,service);\n"+anchor,1)
    (out/'prod-edge/index.ts').write_text(prod)
    media=(ROOT/'baseline-panel-media.ts').read_text()
    media="import {mcpReadMedia} from '@/lib/sana/mcp-read-media.mjs';\n"+media
    media=replace_once(media,'export async function POST(request: NextRequest) {',"export async function POST(request: NextRequest) {\n  if(request.headers.get('x-santana-mcp-read')==='1') return mcpReadMedia(request,{environment:process.env.VERCEL_ENV,caller:process.env.SANA_PROD_CALLER_TOKEN,instance:process.env.WAPI_INSTANCE_ID,token:process.env.WAPI_TOKEN,mediaReference,recoverMediaReference,downloadMedia,imageBytes,pdfBytes});")
    (out/'panel/app/api/runtime/sana-media/route.ts').write_text(media)
    hmg=(ROOT/'baseline-hmg-index.ts').read_text()
    hmg=replace_once(hmg,'signal:AbortSignal.timeout(10000)',"signal:AbortSignal.timeout(JSON.parse(raw)?.mode==='attachment'?28000:10000)")
    hmg=replace_once(hmg,'if (text.length > 2000000)',"if (text.length > (JSON.parse(raw)?.mode==='attachment'?3000000:2000000))")
    (out/'homolog-edge/index.ts').write_text(hmg)
    bases=[('supervised-send/mcp-server.py','0f79fa727d1a9279eb38afb922ecc20519bbc579'),('mcp-deployment/whatsapp-santana-mcp/sana_read_provider.py','cb3fc6baeea5ec6df48a0b456ecde769a5aaf2da'),('mcp-deployment/api/mcp.py','adf46af08b6f7e5ca339b03d6c7b51228c620696')]
    for path,expected in bases:
        blob=(ROOT.parent/path).read_bytes()
        if hashlib.sha1(blob).hexdigest()!=expected:raise SystemExit('DEPLOYED_BASELINE_MISMATCH: '+path)
    server=(ROOT.parent/bases[0][0]).read_text()
    server=replace_once(server,'PREPARATION_TOOLS =',"from admin_assist_tools import TOOLS as ADMIN_CATALOG, MODES as ADMIN_MODES, call_admin\nfrom sana_read_provider import OAuthAuthenticationError\nADMIN_TOOLS=set(ADMIN_MODES) if DATA_SOURCE=='sana_edge' and os.getenv('SANTANA_ADMIN_ASSIST_ENABLED')=='true' else set()\nPREPARATION_TOOLS =")
    server=replace_once(server,'class MCPError(Exception):','TOOL_CATALOG.extend(ADMIN_CATALOG if ADMIN_TOOLS else [])\n\nclass MCPError(Exception):')
    server=server.replace('PREPARATION_TOOLS | SUPERVISED_SEND_TOOLS','PREPARATION_TOOLS | SUPERVISED_SEND_TOOLS | ADMIN_TOOLS')
    server=replace_once(server,'        if name in SUPERVISED_SEND_TOOLS:',"        if name in ADMIN_TOOLS:\n            if client!='chatgpt':raise MCPError(-32601,'Ferramenta não autorizada para este agente.')\n            try:result=call_admin(PROVIDER,name,args,access_token)\n            except OAuthAuthenticationError:raise MCPError(-32001,'Sessão OAuth expirada; reconecte a conexão existente.') from None\n            except PermissionError:raise MCPError(-32003,'Permissão administrativa ausente ou revogada.') from None\n            except ValueError:raise MCPError(-32602,'Argumentos administrativos inválidos.') from None\n            except Exception:raise MCPError(-32000,'Consulta administrativa indisponível; nada foi enviado.') from None\n            return {'jsonrpc':'2.0','id':request_id,'result':result}\n        if name in SUPERVISED_SEND_TOOLS:")
    (out/'homolog-mcp/whatsapp-santana-mcp/server.py').write_text(server)
    provider=(ROOT.parent/bases[1][0]).read_text()
    provider=replace_once(provider,'from urllib.request import Request, urlopen','from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler')
    provider=replace_once(provider,'    try:\n        with urlopen(request, timeout=timeout) as response:',"    maximum=3_000_000 if body.get('mode')=='attachment' else 2_000_000\n    if body.get('mode')=='attachment':\n        class NoRedirect(HTTPRedirectHandler):\n            def redirect_request(self,*args,**kwargs):return None\n        opener=build_opener(NoRedirect()).open\n        timeout=35\n    else:opener=urlopen\n    try:\n        with opener(request, timeout=timeout) as response:")
    provider=provider.replace('response.read(2_000_001)','response.read(maximum+1)').replace('exc.read(2_000_001)','exc.read(maximum+1)').replace('len(raw) > 2_000_000','len(raw) > maximum')
    provider=replace_once(provider,'        if status != 200 or result.get("status") != "ready":',"        if status==403 and re.fullmatch(r'MCP_ADMIN_[A-Z_]+',str(result.get('status',''))):raise PermissionError(result['status'])\n        if status != 200 or result.get(\"status\") != \"ready\":")
    (out/'homolog-mcp/whatsapp-santana-mcp/sana_read_provider.py').write_text(provider)
    api=(ROOT.parent/bases[2][0]).read_text()
    api=replace_once(api,'    "SANTANA_DATA_SOURCE": "sana_edge",','    "SANTANA_ADMIN_ASSIST_ENABLED": "true",\n    "SANTANA_DATA_SOURCE": "sana_edge",')
    (out/'homolog-mcp/api/mcp.py').write_text(api)
    manifest={'status':'ISOLATED_CANDIDATE_NOT_DEPLOYED','production_approval_required':True,'real_message_access_expanded':False,'real_messages_sent':0,'prod_edge_baseline':{'version':40,'sha256':'373f6e2842fb3415e09be50802625698beac1785ab40aaf05117ad96ddf988ed'},'homolog_edge_baseline':{'version':12,'sha256':'fffb3cd4242a6fcdb778e2acb7d0041a4531b218d0ff1bdf86a1f3ad86df2f51'},'homolog_vercel_baseline':'dpl_7bjuy2baqG1QaXSGKGZDoJQ5xSNw','panel_baseline_commit':'762e13ff6d341c2e7eb0cd0b2f0a71a49eca9929','catalog_sha256':catalog['sha256'],'files':{str(p.relative_to(out)):sha(p.read_bytes()) for p in sorted(out.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'}}
    (ROOT/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'status':manifest['status'],'overlay_files':len(manifest['files']),'production_writes':0,'real_messages_sent':0}))
if __name__=='__main__':build()
