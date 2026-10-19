"""Narrow LAB installer with real mount-namespace preflight and safe failures."""
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
def previous_error_metadata():
    """Root-only historical failure metadata, never original journal text."""
    p=subprocess.run(['journalctl','-u',UNIT,'--since','2026-10-19 12:00:00 UTC','--no-pager','-n','100','-o','json'],capture_output=True,text=True,timeout=10)
    out=[]
    for line in p.stdout.splitlines():
        try:msg=json.loads(line).get('MESSAGE','')
        except (ValueError,AttributeError):continue
        if not isinstance(msg,str):continue
        e=safe_error(subprocess.CalledProcessError(1,'[redacted]',stderr=msg))
        if any(k in e for k in ('child_exception_type','missing_module','missing_symbol','errno','error_code','frames')):out.append(e)
    return out[-10:]
def main():
    if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
    phase='preflight';backup=None;target=None;drop=None;changed=False
    report={'whatsapp_sends':0,'production_changes':0,'permissions_changed':False}
    try:
        if command(['hostname']).split('.')[0]!='srv1849463':raise RuntimeError('WRONG_HOST')
        base=Path(property('WorkingDirectory'))
        if str(base)!=BASE_PATH or base.is_symlink():raise RuntimeError('LAB_PATH_CHANGED')
        server=base/'server.py'
        if hashlib.sha256(server.read_bytes()).hexdigest()!=EXPECTED_SERVER:raise RuntimeError('LAB_CODE_DRIFT')
        env=process_env(property('MainPID'))
        if env.get('SANTANA_DATA_SOURCE','fixture')!='fixture' or env.get('SANTANA_SEND_ENABLED','false').lower()=='true' or env.get('SANTANA_SEND_MODE','disabled')!='disabled':raise RuntimeError('LAB_SEND_STATE_UNSAFE')
        if env.get('SANTANA_AUDIT_DB')!=AUDIT_PATH or property('StateDirectory')!='santana-mcp-lab':raise RuntimeError('LAB_AUDIT_CONFIGURATION_CHANGED')
        require_configuration(env)
        target=base/'santana_batch_lab';drop=SYSTEMD_PATH/(UNIT+'.d')/'90-batch-lab.conf'
        if target.exists() or drop.exists():raise RuntimeError('LAB_EXTENSION_ALREADY_PRESENT')
        report['previous_failure_metadata']=previous_error_metadata()
        db=Path(AUDIT_PATH)
        if db.is_symlink() or not db.is_file():raise RuntimeError('LAB_AUDIT_NOT_REGULAR_FILE')
        backup=BACKUP_PATH/(time.strftime('batch-lab-%Y%m%dT%H%M%SZ')+'-'+str(time.time_ns()))
        backup.mkdir(parents=True,mode=0o700);shutil.copy2(server,backup/'server.py')
        with sqlite3.connect(str(db)) as src,sqlite3.connect(str(backup/'audit.sqlite')) as dest:src.backup(dest)
        report['backup']=str(backup)
        tunnel_before=property('MainPID','santana-mcp-lab-tunnel.service')
        target.mkdir(mode=0o700)
        for name,content in FILES.items():
            if not re.fullmatch(r'[a-zA-Z0-9_-]+\.(py|html)',name):raise RuntimeError('INVALID_BUNDLE')
            (target/name).write_text(content);(target/name).chmod(0o600)
        phase='preflight_in_existing_lab_mount_namespace'
        if not shutil.which('nsenter'):raise RuntimeError('NSENTER_UNAVAILABLE')
        fd,probe_name=tempfile.mkstemp(prefix='.batch-lab-probe-',suffix='.sqlite',dir=db.parent);os.close(fd)
        probe=Path(probe_name)
        try:
            with sqlite3.connect(str(backup/'audit.sqlite')) as src,sqlite3.connect(str(probe)) as dest:src.backup(dest)
            clean={**env,'SANTANA_AUDIT_DB':str(probe),'PYTHONDONTWRITEBYTECODE':'1'}
            smoke="import sys;sys.path.insert(0,sys.argv[1]);import launcher;v=launcher.server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},('chatgpt','read'));assert {'preparar_lote','registrar_revisao_lote','listar_conversas'}<={x['name'] for x in v['result']['tools']};launcher.server.AUDIT._db.close();print('LAB_MOUNT_AND_EXISTING_SCHEMA_PASS')"
            command(['nsenter','--target',property('MainPID'),'--mount','/usr/bin/python3','-c',smoke,str(target)],cwd=base,env=clean)
            report['mount_and_existing_audit_preflight']='PASS'
        finally:
            for suffix in ('','-wal','-shm'):
                p=Path(str(probe)+suffix)
                if p.is_file() and not p.is_symlink():p.unlink()
        phase='activate_existing_lab_unit'
        drop.parent.mkdir(mode=0o755,exist_ok=True)
        drop.write_text('[Service]\nExecStart=\nExecStart=/usr/bin/python3 '+str(target/'launcher.py')+'\n');drop.chmod(0o644)
        changed=True
        command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
        phase='observe_new_lab_process_catalog'
        names=await_catalog(target/'launcher.py')
        if property('ActiveState')!='active':raise RuntimeError('LAB_UNIT_NOT_ACTIVE')
        report.update(status='LAB_EXTENSION_INSTALLED',tools=names,source='fixture',real_send_enabled=False,real_operator_review='AWAITING_USER_IN_PROTECTED_CHATGPT_UI',lab_pid=property('MainPID'),lab_tunnel_pid_unchanged=tunnel_before==property('MainPID','santana-mcp-lab-tunnel.service'))
        emit(report)
    except BaseException as e:
        report.update(status='INSTALL_STOPPED_NO_CHANGE' if not changed else 'INSTALL_FAILED_LAB_RESTORED_NO_PRODUCTION_CHANGE',phase=phase,**safe_error(e))
        if changed:
            report['candidate_failure_metadata']=previous_error_metadata()
            try:
                if drop.exists():drop.unlink()
                command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
                deadline=time.monotonic()+10
                while time.monotonic()<deadline and get_health()!=405:time.sleep(.3)
                report['lab_restored']=property('ActiveState')=='active' and get_health()==405 and not drop.exists()
                if not report['lab_restored']:report['status']='LAB_RESTORE_NOT_PROVEN'
            except BaseException as rollback_error:
                report['status']='LAB_RESTORE_NOT_PROVEN';report['rollback_error']=safe_error(rollback_error)
        if target and backup and target.exists():target.rename(backup/'candidate-not-activated')
        emit(report)
        raise SystemExit(1) from None
if __name__=='__main__':main()
