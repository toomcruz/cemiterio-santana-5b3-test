import ast

import hashlib,json,os,re,shutil,sqlite3,subprocess,tempfile,time

from pathlib import Path

from urllib.error import HTTPError,URLError

from urllib.request import Request,build_opener,ProxyHandler

UNIT='santana-mcp-lab.service'

EXPECTED_SERVER='4c2b376f9850d0249e5d849c708ffac523c9d808baeaf78351fd75fb4267260b'

BASE_PATH='/root/santana-mcp-v5-lab-20261017_161954/whatsapp-santana-mcp'

AUDIT_PATH='/var/lib/santana-mcp-lab/audit.sqlite3'

STAGE=Path('/home/runner/santana-mcp-staging')

SYSTEMD_PATH=Path('/etc/systemd/system')

BACKUP_PATH=Path('/root/santana-mcp-backups')

LAB_PORT=8770

LAB_URL='http://127.0.0.1:8770/mcp'

REQUIRED={'preparar_lote','registrar_revisao_lote','listar_conversas'}

def command(args,**kw):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=30,**kw).stdout.strip()

def property(name,unit=UNIT):
    return command(['systemctl','show',unit,'-p',name,'--value'])

def process_env(pid):
    if not str(pid).isdigit() or int(pid)<1:raise RuntimeError('LAB_PROCESS_NOT_RUNNING')
    return dict(x.decode().split('=',1) for x in Path('/proc',str(pid),'environ').read_bytes().split(b'\0') if b'=' in x)

def process_ready(pid,script):
    """Require the executed launcher and its own bound loopback socket first."""
    if not str(pid).isdigit() or int(pid)<1:return False
    proc=Path('/proc',str(pid))
    try:
        argv=proc.joinpath('cmdline').read_bytes().split(b'\0')
        if os.fsencode(str(script)) not in argv[1:]:return False
        inodes=set()
        for fd in proc.joinpath('fd').iterdir():
            try:link=os.readlink(fd)
            except FileNotFoundError:continue
            if link.startswith('socket:[') and link.endswith(']'):inodes.add(link[8:-1])
        for line in proc.joinpath('net/tcp').read_text().splitlines()[1:]:
            fields=line.split()
            if len(fields)>9 and fields[3]=='0A' and fields[1]=='0100007F:'+format(LAB_PORT,'04X') and fields[9] in inodes:return True
        return False
    except (FileNotFoundError,ProcessLookupError):return False

def configuration_checks(env):
    port=env.get('MCP_PORT',str(LAB_PORT))
    return {'audit_variable_present':'SANTANA_AUDIT_DB' in env,
            'audit_path_matches':env.get('SANTANA_AUDIT_DB')==AUDIT_PATH,
            'port_matches':port.isdigit() and int(port)==LAB_PORT}

def require_configuration(env):
    checks=configuration_checks(env)
    if not all(checks.values()):
        error=RuntimeError('LAB_RUNTIME_CONFIGURATION_CHANGED')
        error.configuration_checks=checks
        raise error

def safe_error(error):
    # Never emit subprocess arguments, environment, raw stderr or HTTP bodies.
    out={'exception_type':type(error).__name__}
    if isinstance(error,subprocess.CalledProcessError):
        out['exit_code']=error.returncode
        text=error.stderr or ''
        hit=re.search(r'(?m)^(?:[a-zA-Z0-9_]+\.)?(ImportError|ModuleNotFoundError|PermissionError|TypeError|RuntimeError|AttributeError|OSError|OperationalError|ValueError|NameError):',text)
        if hit:out['child_exception_type']=hit[1]
        for pattern,key in [(r'\[Errno ([0-9]{1,4})\]','errno'),(r"No module named ['\"]([a-zA-Z0-9_.]{1,80})['\"]",'missing_module'),(r"cannot import name ['\"]([a-zA-Z0-9_]{1,80})['\"]",'missing_symbol')]:
            m=re.search(pattern,text)
            if m:out[key]=m[1]
        if 'readonly database' in text or 'Read-only file system' in text:out['error_code']='READ_ONLY_STORAGE'
        if 'Address already in use' in text:out['error_code']='ADDRESS_IN_USE'
        frames=re.findall(r'File "[^"\n]*/([a-zA-Z0-9_-]+\.py)", line ([0-9]{1,5})',text)
        if frames:out['frames']=[{'file':f,'line':int(n)} for f,n in frames[-4:]]
    elif isinstance(error,HTTPError):out['http_status']=error.code
    elif isinstance(error,OSError) and error.errno is not None:out['errno']=error.errno
    elif isinstance(error,RuntimeError) and re.fullmatch(r'[A-Z0-9_]{3,90}',str(error)):
        out['error_code']=str(error)
        if hasattr(error,'configuration_checks'):out['configuration_checks']=error.configuration_checks
    return out

def emit(report):
    if STAGE.is_symlink() or not STAGE.is_dir():raise SystemExit('UNSAFE_REPORT_DIRECTORY')
    path=STAGE/('batch-lab-result-'+str(time.time_ns())+'.json')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'w') as f:json.dump(report,f)
    print(json.dumps(report,ensure_ascii=False))

def get_health():
    try:
        with build_opener(ProxyHandler({})).open(LAB_URL,timeout=2) as r:return r.status
    except HTTPError as e:return e.code
    except (OSError,URLError):return None

def catalog(env):
    if env.get('SANTANA_DATA_SOURCE','fixture')!='fixture' or env.get('SANTANA_SEND_ENABLED','false').lower()=='true' or env.get('SANTANA_SEND_MODE','disabled')!='disabled':raise RuntimeError('LAB_SEND_STATE_UNSAFE')
    require_configuration(env)
    token=env.get('CHATGPT_READ_TOKEN','')
    if not token:raise RuntimeError('LAB_CLIENT_AUTH_MISSING')
    body=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}}).encode()
    request=Request(LAB_URL,data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
    with build_opener(ProxyHandler({})).open(request,timeout=2) as r:result=json.load(r)
    names=[t['name'] for t in result.get('result',{}).get('tools',[])]
    if not REQUIRED<=set(names):raise RuntimeError('LAB_CATALOG_NOT_PROVEN')
    private=next((t for t in result.get('result',{}).get('tools',[]) if t['name']=='registrar_revisao_lote'),{})
    if private.get('_meta',{}).get('ui')!={'visibility':['app']}:raise RuntimeError('PRIVATE_TOOL_DESCRIPTOR_NOT_PROVEN')
    return names

def await_catalog(script,seconds=15):
    deadline=time.monotonic()+seconds;error=RuntimeError('LAB_STARTUP_NOT_PROVEN')
    while time.monotonic()<deadline:
        try:
            pid=property('MainPID')
            # Type=simple may publish MainPID before execve installs the service
            # environment. Never mistake the executor's environment for drift.
            if not process_ready(pid,script):raise RuntimeError('LAB_PROCESS_NOT_READY')
            return catalog(process_env(pid))
        except (HTTPError,URLError,OSError,RuntimeError) as e:
            error=e
            # Authentication/configuration/schema failures are not startup races.
            if isinstance(e,HTTPError) and e.code not in {502,503}:raise
            if isinstance(e,RuntimeError) and str(e) not in {'LAB_PROCESS_NOT_RUNNING','LAB_PROCESS_NOT_READY'}:raise
        time.sleep(.3)
    raise error

OLD_SHA='0fad711f210621281b5c39d57c71def4274e7ee6ea856c888e8d728d235f4160'
NEW_SHA='ec7f35c1e88e20c1d77f2e38287c5507ee8b5f6b36f4ff53d108c62fb201ae1f'
PATCHED_CODE='"""Opt-in extension of the EXISTING v5 dispatcher/HTTP handler, fixture only."""\nimport json\nfrom pathlib import Path\nfrom http.cookies import SimpleCookie\nfrom batch_send import Actor, Blocked, SOURCE\n\nRESOURCE="ui://santana/lab-batch-review.html"\nROOT=Path(__file__).resolve().parent\nTEXT={"type":"string","maxLength":3000}\nSELECTOR={"type":"string","minLength":4,"maxLength":80}\nATTACHMENT={"type":"object","additionalProperties":False,"required":["name","mime_type","content_base64"],"properties":{\n "name":{"type":"string","maxLength":100},"mime_type":{"type":"string","enum":["image/png","image/jpeg","application/pdf"]},"content_base64":{"type":"string","maxLength":700000}}}\ndef tool(name,description,properties,required,write=False):\n    return {"name":name,"description":"LAB fictício: "+description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":False},\n            "annotations":{"readOnlyHint":not write,"destructiveHint":False,"openWorldHint":False},"_meta":{"ui":{"resourceUri":RESOURCE}}}\nCOMMON={"text":TEXT,"idempotency_key":{"type":"string","minLength":8,"maxLength":100},"attachment":ATTACHMENT}\nTOOLS=[\n tool("preparar_envio_simplificado","Resolve um único contato autorizado por conversa, telefone ou final inequívoco. Prepara e mostra a prévia. Nunca aprova ou envia.",{"recipient":SELECTOR,**COMMON},["recipient","text","idempotency_key"],True),\n tool("preparar_lote","Prepara de 1 a 50 destinatários autorizados com prévia integral e revisão única do lote. Personalizações são vinculadas à conversa; não inventar regras pendentes.",{\n  "recipients":{"type":"array","minItems":1,"maxItems":50,"items":SELECTOR},**COMMON,"personalized":{"type":"object","additionalProperties":TEXT},"purpose":{"type":"string","enum":["service","approved_notice"]}},["recipients","text","idempotency_key"],True),\n tool("consultar_lote","Consulta todas as operações, falhas e resultados desconhecidos. Não reenvia.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"]),\n tool("executar_lote_simulado","Executa no máximo UMA operação fictícia aprovada por chamada. Respeita o próximo horário retornado, sem repetir desconhecidos. Transporte real é impossível neste candidato.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"],True),\n tool("reconciliar_lote","Consulta recibos autoritativos fictícios e mantém desconhecidos bloqueados. Nunca tenta enviar.",{"batch_id":{"type":"string","format":"uuid"}},["batch_id"]),\n]\n\ndef call(controller,actor,name,args):\n    schema=next((t["inputSchema"] for t in TOOLS if t["name"]==name),None)\n    if not schema or not isinstance(args,dict) or set(args)-set(schema["properties"]) or not set(schema["required"])<=set(args):\n        raise Blocked("INVALID_TOOL_ARGUMENTS")\n    if name=="preparar_envio_simplificado":\n        return controller.prepare(actor,[args["recipient"]],args["text"],args["idempotency_key"],args.get("attachment"))\n    if name=="preparar_lote":\n        return controller.prepare(actor,args["recipients"],args["text"],args["idempotency_key"],args.get("attachment"),personalized=args.get("personalized"),purpose=args.get("purpose","service"))\n    if name=="consultar_lote":\n        return controller.status(actor,args["batch_id"])\n    if name=="executar_lote_simulado":\n        return controller.step(actor,args["batch_id"])\n    return controller.reconcile(actor,args["batch_id"])\n\ndef install(server,controller,resolve_actor,base_url,real_review=None):\n    """Mount in an isolated import of the v5 server; no file/service replacement."""\n    if server.DATA_SOURCE!="fixture" or controller.directory.environment!=SOURCE or not base_url.startswith(("http://127.0.0.1:","https://")):\n        raise Blocked("LAB_FIXTURE_MOUNT_ONLY")\n    original=server.dispatch\n    def dispatch(request,identity,access_token=None):\n        if not isinstance(request,dict) or request.get(\'jsonrpc\')!=\'2.0\':\n            raise server.MCPError(-32600,\'Requisição JSON-RPC inválida.\')\n        client,role=identity\n        method=request.get("method");params=request.get("params") or {};request_id=request.get("id")\n        if not isinstance(params,dict):\n            raise server.MCPError(-32602,\'params deve ser um objeto.\')\n        if method in {"initialize","server/discover"}:\n            response=original(request,identity,access_token)\n            if client=="chatgpt" and response and \'result\' in response:\n                response[\'result\'].setdefault(\'capabilities\',{})[\'resources\']={}\n            return response\n        if method=="tools/list":\n            response=original(request,identity,access_token)\n            if client=="chatgpt":\n                response["result"]["tools"].extend(TOOLS)\n                if real_review:\n                    t=tool(\'registrar_revisao_lote\',\'Registra somente um recibo de revisão humana já autenticada no HOMOLOG. Não recebe senha/JWT e não envia.\',{\'batch_id\':{\'type\':\'string\',\'format\':\'uuid\'},\'receipt_id\':{\'type\':\'string\',\'format\':\'uuid\'}},[\'batch_id\',\'receipt_id\'],True)\n                    t[\'_meta\'][\'ui\']={\'visibility\':[\'app\']}\n                    response[\'result\'][\'tools\'].append(t)\n            return response\n        if method=="resources/list" and client=="chatgpt":\n            return {"jsonrpc":"2.0","id":request_id,"result":{"resources":[{"uri":RESOURCE,"name":"Revisão de lote Santana LAB","mimeType":"text/html;profile=mcp-app"}]}}\n        if method=="resources/read" and client=="chatgpt" and params.get("uri")==RESOURCE:\n            domains=[\'https://xdccjulfqcqefykunwtg.supabase.co\'] if real_review else []\n            ui={\'csp\':{\'connectDomains\':domains,\'resourceDomains\':[]}}\n            if real_review:\n                ui[\'domain\']=\'https://santana-mcp-homolog-consent.vercel.app\'\n                ui[\'csp\'][\'frameDomains\']=[\'https://santana-mcp-homolog-consent.vercel.app\']\n            return {"jsonrpc":"2.0","id":request_id,"result":{"contents":[{"uri":RESOURCE,"mimeType":"text/html;profile=mcp-app","text":(ROOT/("real-widget.html" if real_review else "widget.html")).read_text(),"_meta":{"ui":ui}}]}}\n        if method=="tools/call" and params.get("name") in {t["name"] for t in TOOLS}|({\'registrar_revisao_lote\'} if real_review else set()):\n            if client!="chatgpt":\n                raise server.MCPError(-32003,"AGENT_SCOPE_DENIED")\n            try:\n                actor=resolve_actor(identity,access_token)\n                args=params.get(\'arguments\') or {}\n                if params[\'name\']==\'registrar_revisao_lote\':\n                    if not isinstance(args,dict) or set(args)!={\'batch_id\',\'receipt_id\'}:raise Blocked(\'INVALID_TOOL_ARGUMENTS\')\n                    value=real_review.register(actor,args[\'batch_id\'],args[\'receipt_id\'])\n                else:value=call(controller,actor,params["name"],args)\n                if "approval_url" in value:\n                    value["approval_url"]=base_url+value["approval_url"]\n                result={"content":[{"type":"text","text":json.dumps(value,ensure_ascii=False)}],"structuredContent":value}\n                if real_review and \'batch_id\' in value and \'preview\' in value:\n                    result[\'_meta\']={\'lab_review\':real_review.metadata(actor,value[\'batch_id\'])}\n                return {"jsonrpc":"2.0","id":request_id,"result":result}\n            except Blocked as error:\n                return {"jsonrpc":"2.0","id":request_id,"result":{"isError":True,"content":[{"type":"text","text":str(error)}]}}\n        return original(request,identity,access_token)\n    server.dispatch=dispatch\n    Base=server.Handler\n    class Handler(Base):\n        def do_GET(self):\n            if self.path=="/lab/revisar-lote":\n                b=(ROOT/"review.html").read_bytes()\n                self.send_response(200)\n                for k,v in {"Content-Type":"text/html; charset=utf-8","Content-Length":str(len(b)),"Cache-Control":"no-store","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; frame-src blob:; connect-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'self\'"}.items():\n                    self.send_header(k,v)\n                self.end_headers();self.wfile.write(b);return\n            super().do_GET()\n\n        def do_POST(self):\n            if self.path!="/lab/review":\n                super().do_POST();return\n            if self.headers.get("Origin")!=base_url or self.headers.get("Sec-Fetch-Site")!="same-origin" or self.headers.get_content_type()!="application/json":\n                self._json(403,{"error":"SAME_ORIGIN_REVIEW_REQUIRED"});return\n            try:\n                length=int(self.headers.get("Content-Length","0"))\n                if not 1<=length<=3000:\n                    raise Blocked("INVALID_REVIEW_BODY")\n                b=json.loads(self.rfile.read(length));cookie=SimpleCookie(self.headers.get("Cookie",""))\n                session=cookie.get("santana_lab_human")\n                human=resolve_actor(("human",session.value if session else ""),None)\n                if not isinstance(b,dict) or set(b)-{"action","batch_id","manifest_sha256","csrf_nonce","explicit"}:\n                    raise Blocked("INVALID_REVIEW_BODY")\n                if b.get("action")=="preview":\n                    value=controller.review(human,b.get("batch_id"))\n                elif b.get("action")=="approve":\n                    value=controller.approve(human,b.get("batch_id"),b.get("manifest_sha256"),b.get("csrf_nonce"),b.get("explicit"))\n                else:\n                    raise Blocked("INVALID_REVIEW_ACTION")\n                self._json(200,value)\n            except (Blocked,ValueError,TypeError) as error:\n                self._json(403,{"error":str(error) if isinstance(error,Blocked) else "INVALID_REVIEW_BODY"})\n        def log_message(self,*args):\n            return\n    server.Handler=Handler\n    return Handler\n'

"""Change one UI descriptor field in the already installed LAB extension."""
def main():
    if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
    report={'whatsapp_sends':0,'production_changes':0,'permissions_changed':False}
    changed=False;backup=None;path=None;phase='preflight'
    try:
        if command(['hostname']).split('.')[0]!='srv1849463':raise RuntimeError('WRONG_HOST')
        base=Path(property('WorkingDirectory'))
        if str(base)!=BASE_PATH or base.is_symlink():raise RuntimeError('LAB_PATH_CHANGED')
        if hashlib.sha256((base/'server.py').read_bytes()).hexdigest()!=EXPECTED_SERVER:raise RuntimeError('LAB_CODE_DRIFT')
        env=process_env(property('MainPID'));require_configuration(env)
        if env.get('SANTANA_DATA_SOURCE','fixture')!='fixture' or env.get('SANTANA_SEND_ENABLED','false').lower()=='true' or env.get('SANTANA_SEND_MODE','disabled')!='disabled':raise RuntimeError('LAB_SEND_STATE_UNSAFE')
        target=base/'santana_batch_lab';path=target/'mcp_extension.py'
        if target.is_symlink() or path.is_symlink():raise RuntimeError('LAB_PATH_UNSAFE')
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        if digest==NEW_SHA:
            report.update(status='LAB_UI_METADATA_ALREADY_FIXED',tools=await_catalog(target/'launcher.py'),source='fixture',real_send_enabled=False)
            emit(report);return
        if digest!=OLD_SHA:raise RuntimeError('LAB_EXTENSION_CODE_DRIFT')
        if hashlib.sha256(PATCHED_CODE.encode()).hexdigest()!=NEW_SHA:raise RuntimeError('PATCH_INTEGRITY_MISMATCH')
        ast.parse(PATCHED_CODE)
        backup=BACKUP_PATH/('ui-metadata-'+time.strftime('%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns()))
        backup.mkdir(parents=True,mode=0o700);shutil.copy2(path,backup/'mcp_extension.original.py')
        candidate=backup/'mcp_extension.candidate.py';candidate.write_text(PATCHED_CODE);candidate.chmod(0o600)
        report['backup']=str(backup)
        tunnel=property('MainPID','santana-mcp-lab-tunnel.service')
        phase='validate_private_tool_descriptor'
        clean={**env,'SANTANA_AUDIT_DB':':memory:','PYTHONDONTWRITEBYTECODE':'1'}
        smoke="import sys,importlib.util;sys.path[:0]=sys.argv[1:3];s=importlib.util.spec_from_file_location('mcp_extension',sys.argv[3]);m=importlib.util.module_from_spec(s);sys.modules['mcp_extension']=m;s.loader.exec_module(m);import launcher;v=launcher.server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},('chatgpt','read'));t={x['name']:x for x in v['result']['tools']};assert len(t)==12;assert t['registrar_revisao_lote']['_meta']['ui']=={'visibility':['app']};assert t['preparar_lote']['_meta']['ui']['resourceUri']=='ui://santana/lab-batch-review.html';print('PRIVATE_DESCRIPTOR_PASS')"
        command(['/usr/bin/python3','-c',smoke,str(target),str(base),str(candidate)],cwd=base,env=clean)
        phase='replace_one_descriptor_field'
        tmp=target/('.mcp-ui-fix-'+str(time.time_ns())+'.tmp')
        shutil.copy2(candidate,tmp);tmp.chmod(0o600);os.replace(tmp,path);changed=True
        command(['systemctl','restart',UNIT])
        phase='verify_live_catalog'
        names=await_catalog(target/'launcher.py')
        report.update(status='LAB_UI_METADATA_FIXED',source='fixture',real_send_enabled=False,tools=names,lab_pid=property('MainPID'),lab_tunnel_pid_unchanged=tunnel==property('MainPID','santana-mcp-lab-tunnel.service'),private_tool='registrar_revisao_lote',private_visibility=['app'],private_render_resource=False)
        emit(report)
    except BaseException as error:
        report.update(status='LAB_UI_FIX_STOPPED_NO_SERVICE_CHANGE',phase=phase,**safe_error(error))
        if changed:
            try:
                tmp=path.parent/('.mcp-ui-restore-'+str(time.time_ns())+'.tmp')
                shutil.copy2(backup/'mcp_extension.original.py',tmp);os.replace(tmp,path)
                command(['systemctl','restart',UNIT])
                deadline=time.monotonic()+15
                while time.monotonic()<deadline and get_health()!=405:time.sleep(.3)
                restored=property('ActiveState')=='active' and get_health()==405 and hashlib.sha256(path.read_bytes()).hexdigest()==OLD_SHA
                report.update(status='LAB_UI_FIX_FAILED_RESTORED' if restored else 'LAB_UI_RESTORE_NOT_PROVEN',lab_restored=restored)
            except BaseException as restore_error:
                report.update(status='LAB_UI_RESTORE_NOT_PROVEN',restore_error=safe_error(restore_error))
        emit(report);raise SystemExit(1) from None
if __name__=='__main__':main()

