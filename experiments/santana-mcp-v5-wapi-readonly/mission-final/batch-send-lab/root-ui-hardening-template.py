"""Transactional, one-service patch of the installed LAB; no Auth grants."""
def load_dependencies(destination):
    import stat,zipfile,io
    p=Path(DEPENDENCY_PATH)
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        info=os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode&0o022 or info.st_size>60000000:
            raise RuntimeError('UNSAFE_DEPENDENCY_PACKAGE')
        content=f.read(60000001)
    if hashlib.sha256(content).hexdigest()!=DEPENDENCY_SHA:
        raise RuntimeError('DEPENDENCY_INTEGRITY_MISMATCH')
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        entries=z.infolist()
        if len(entries)>2000 or sum(i.file_size for i in entries)>180000000:
            raise RuntimeError('DEPENDENCY_PACKAGE_TOO_LARGE')
        for item in entries:
            relative=Path(item.filename)
            if relative.is_absolute() or not relative.parts or any(x in ('..','') for x in relative.parts) or stat.S_ISLNK(item.external_attr>>16):
                raise RuntimeError('UNSAFE_DEPENDENCY_PATH')
            out=destination/relative
            if item.is_dir():out.mkdir(parents=True,exist_ok=True,mode=0o700);continue
            out.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            with out.open('xb') as f:f.write(z.read(item))
            out.chmod(0o600)
    (destination/'SANTANA_DEPENDENCIES_SHA256').write_text(DEPENDENCY_SHA)

def validate_candidate(candidate,base,env):
    clean={**env,'SANTANA_AUDIT_DB':':memory:','PYTHONDONTWRITEBYTECODE':'1'}
    script="""import sys,json,re,base64,hashlib
from pathlib import Path
sys.path[:0]=sys.argv[1:3]
import server
from batch_send import Actor,BatchController,FixtureDirectory,SimulatedOfficialChannel
from real_review import RealReview,OWNER,OPERATOR
from mcp_extension import install,RESOURCE
import time
actor=Actor(OWNER,'chatgpt-lab',OPERATOR,'fixture-preflight','lab_client',time.time()+100,time.time())
engine=BatchController(server.AUDIT,FixtureDirectory(),SimulatedOfficialChannel(),lambda a:True)
review=RealReview(engine)
install(server,engine,lambda *a:actor,'https://chatgpt.com',review)
tools=server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},('chatgpt','read'))['result']['tools']
assert len(tools)==12
assert next(t for t in tools if t['name']=='registrar_revisao_lote')['_meta']['ui']=={'visibility':['app']}
resource=server.dispatch({'jsonrpc':'2.0','id':2,'method':'resources/read','params':{'uri':RESOURCE}},('chatgpt','read'))['result']['contents'][0]
assert 'http-equiv="Content-Security-Policy"' in resource['text'] and "frame-src 'none'" in resource['text']
assert not resource['_meta']['ui']['csp'].get('frameDomains')
pdf=base64.b64decode(sys.argv[3])
b=engine.prepare(actor,['0002'],'Prévia PDF sintética','ui-pdf-preflight',attachment={'name':'sintetico.pdf','mime_type':'application/pdf','content_base64':sys.argv[3]})
m=review.metadata(actor,b['batch_id']);p=m['pdf_previews'][hashlib.sha256(pdf).hexdigest()]
assert p['status']=='ready' and p['complete'] and p['page_count']==1
result=server.dispatch({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'consultar_lote','arguments':{'batch_id':b['batch_id']}}},('chatgpt','read'))['result']
assert 'approval_url' not in result['structuredContent'] and result['structuredContent']['review_interface']=='chatgpt_component'
print('LAB_UI_PREFLIGHT_PASS')
"""
    command(['/usr/bin/python3','-c',script,str(candidate),str(base),FIXTURE_PDF],cwd=base,env=clean)

def verify_live(env):
    names=await_catalog(Path(BASE_PATH)/'santana_batch_lab/launcher.py')
    body=json.dumps({'jsonrpc':'2.0','id':1,'method':'resources/read','params':{'uri':'ui://santana/lab-batch-review.html'}}).encode()
    req=Request(LAB_URL,data=body,headers={'Authorization':'Bearer '+env['CHATGPT_READ_TOKEN'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
    with build_opener(ProxyHandler({})).open(req,timeout=5) as r:content=json.load(r)['result']['contents'][0]
    if 'http-equiv="Content-Security-Policy"' not in content['text'] or "frame-src 'none'" not in content['text']:
        raise RuntimeError('LIVE_CSP_NOT_PROVEN')
    return names

def main():
    if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
    report={'whatsapp_sends':0,'production_changes':0,'permissions_changed':False,'auth_grants_changed':False}
    changed=False;backup=None;phase='preflight';written=[];deps_changed=False
    try:
        if command(['hostname']).split('.')[0]!='srv1849463':raise RuntimeError('WRONG_HOST')
        base=Path(property('WorkingDirectory'));target=base/'santana_batch_lab'
        if str(base)!=BASE_PATH or base.is_symlink() or target.is_symlink():raise RuntimeError('LAB_PATH_CHANGED')
        if hashlib.sha256((base/'server.py').read_bytes()).hexdigest()!=EXPECTED_SERVER:raise RuntimeError('LAB_CODE_DRIFT')
        env=process_env(property('MainPID'));require_configuration(env);catalog(env)
        if all((target/n).is_file() and not (target/n).is_symlink() and (target/n).read_text()==c for n,c in PATCHES.items()) and (target/'review-deps/SANTANA_DEPENDENCIES_SHA256').is_file() and (target/'review-deps/SANTANA_DEPENDENCIES_SHA256').read_text()==DEPENDENCY_SHA:
            report.update(status='LAB_UI_HARDENING_ALREADY_INSTALLED',tools=verify_live(env),source='fixture',real_send_enabled=False)
            emit(report);return
        for name,sha in EXPECTED_FILES.items():
            path=target/name
            if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
                raise RuntimeError('LAB_EXTENSION_CODE_DRIFT')
        deps=target/'review-deps'
        if deps.exists() or deps.is_symlink():raise RuntimeError('LAB_DEPENDENCIES_ALREADY_PRESENT')
        for name in PATCHES:
            if name not in EXPECTED_FILES and (target/name).exists():raise RuntimeError('LAB_EXTENSION_FILE_COLLISION')
        backup=BACKUP_PATH/('ui-hardening-'+time.strftime('%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns()))
        backup.mkdir(mode=0o700,parents=True);report['backup']=str(backup)
        for name in EXPECTED_FILES:shutil.copy2(target/name,backup/name)
        with sqlite3.connect(AUDIT_PATH) as src,sqlite3.connect(str(backup/'audit.sqlite3')) as dest:src.backup(dest)
        candidate=backup/'candidate';candidate.mkdir(mode=0o700)
        for name in UNCHANGED_FILES:
            path=target/name
            if path.is_symlink() or not path.is_file():raise RuntimeError('LAB_PATH_UNSAFE')
            shutil.copy2(path,candidate/name)
        for name,content in PATCHES.items():
            if Path(name).name!=name:raise RuntimeError('PATCH_PATH_UNSAFE')
            if name.endswith('.py'):ast.parse(content)
            (candidate/name).write_text(content);(candidate/name).chmod(0o600)
        phase='prepare_scoped_offline_renderer';load_dependencies(candidate/'review-deps')
        phase='isolated_pdf_and_protocol_preflight';validate_candidate(candidate,base,env)
        tunnel_before=property('MainPID','santana-mcp-lab-tunnel.service')
        phase='replace_lab_only';command(['systemctl','stop',UNIT]);changed=True
        for name in PATCHES:
            tmp=target/('.ui-hardening-'+str(time.time_ns())+'.tmp')
            shutil.copy2(candidate/name,tmp);os.replace(tmp,target/name);written.append(name)
        os.rename(candidate/'review-deps',deps);deps_changed=True
        command(['systemctl','start',UNIT])
        phase='observe_hardened_lab';names=verify_live(env)
        report.update(status='LAB_UI_HARDENING_INSTALLED',tools=names,source='fixture',real_send_enabled=False,
            lab_pid=property('MainPID'),lab_tunnel_pid_unchanged=tunnel_before==property('MainPID','santana-mcp-lab-tunnel.service'),
            per_component_csp=True,pdf_offline_preview='PASS',pdf_page_limit=8,review_interface='chatgpt_component',external_review_link=False)
        emit(report)
    except BaseException as error:
        report.update(status='LAB_UI_HARDENING_STOPPED_NO_CHANGE',phase=phase,**safe_error(error))
        if changed:
            try:
                command(['systemctl','stop',UNIT])
                for name in written:
                    if name in EXPECTED_FILES:
                        tmp=target/('.ui-restore-'+str(time.time_ns())+'.tmp');shutil.copy2(backup/name,tmp);os.replace(tmp,target/name)
                    else:(target/name).unlink()
                if deps_changed:shutil.rmtree(deps)
                command(['systemctl','start',UNIT]);await_catalog(target/'launcher.py')
                report.update(status='LAB_UI_HARDENING_FAILED_RESTORED',lab_restored=True)
            except BaseException as restore_error:report.update(status='LAB_UI_RESTORE_NOT_PROVEN',restore_error=safe_error(restore_error))
        emit(report);raise SystemExit(1) from None

if __name__=='__main__':main()
