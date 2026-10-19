"""Audited narrow installer. FILES and hashes are embedded by the build script."""
import hashlib,json,os,re,shutil,sqlite3,stat,subprocess,sys,time
from pathlib import Path
from urllib.request import Request,urlopen

UNIT='santana-mcp-lab.service'
EXPECTED_SERVER='4c2b376f9850d0249e5d849c708ffac523c9d808baeaf78351fd75fb4267260b'
def command(args,**kw):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=30,**kw).stdout.strip()
def main():
 if os.geteuid()!=0:raise SystemExit('ROOT_REQUIRED_NO_CHANGE')
 if command(['hostname']).split('.')[0]!='srv1849463':raise SystemExit('WRONG_HOST_NO_CHANGE')
 base=Path(command(['systemctl','show',UNIT,'-p','WorkingDirectory','--value']))
 if str(base)!='/root/santana-mcp-v5-lab-20261017_161954/whatsapp-santana-mcp' or base.is_symlink():raise SystemExit('LAB_PATH_CHANGED_NO_CHANGE')
 server=base/'server.py'
 if hashlib.sha256(server.read_bytes()).hexdigest()!=EXPECTED_SERVER:raise SystemExit('LAB_CODE_DRIFT_NO_CHANGE')
 pid=command(['systemctl','show',UNIT,'-p','MainPID','--value'])
 env=dict(x.decode().split('=',1) for x in Path('/proc',pid,'environ').read_bytes().split(b'\0') if b'=' in x)
 if env.get('SANTANA_DATA_SOURCE','fixture')!='fixture' or env.get('SANTANA_SEND_ENABLED','false').lower()=='true' or env.get('SANTANA_SEND_MODE','disabled')!='disabled':raise SystemExit('LAB_SEND_STATE_UNSAFE_NO_CHANGE')
 target=base/'santana_batch_lab';drop=Path('/etc/systemd/system')/(UNIT+'.d')/'90-batch-lab.conf'
 if target.exists() or drop.exists():raise SystemExit('LAB_EXTENSION_ALREADY_PRESENT_NO_CHANGE')
 backup=Path('/root/santana-mcp-backups')/time.strftime('batch-lab-%Y%m%dT%H%M%SZ')
 backup.mkdir(parents=True,mode=0o700);shutil.copy2(server,backup/'server.py')
 db=Path(env.get('SANTANA_AUDIT_DB','./state/whatsapp_santana_mcp.sqlite3'))
 if not db.is_absolute():db=base/db
 if db.is_file():
  with sqlite3.connect(str(db)) as src,sqlite3.connect(str(backup/'audit.sqlite')) as dest:src.backup(dest)
 tunnel_before=command(['systemctl','show','santana-mcp-lab-tunnel.service','-p','MainPID','--value'])
 target.mkdir(mode=0o700)
 for name,content in FILES.items():
  if not re.fullmatch(r'[a-zA-Z0-9_-]+\.(py|html)',name):raise SystemExit('INVALID_BUNDLE')
  (target/name).write_text(content);(target/name).chmod(0o600)
 clean={**env,'SANTANA_AUDIT_DB':':memory:','PYTHONDONTWRITEBYTECODE':'1'}
 smoke="import sys;sys.path.insert(0,sys.argv[1]);import launcher;v=launcher.server.dispatch({'jsonrpc':'2.0','id':1,'method':'tools/list'},{identity});names={x['name'] for x in v['result']['tools']};assert {'preparar_lote','registrar_revisao_lote','listar_conversas'}<=names;print('LAB_IMPORT_PASS')".replace('{identity}',"('chatgpt','read')")
 try:
  command(['/usr/bin/python3','-c',smoke,str(target)],cwd=base,env=clean)
  drop.parent.mkdir(mode=0o755,exist_ok=True)
  drop.write_text('[Service]\nExecStart=\nExecStart=/usr/bin/python3 '+str(target/'launcher.py')+'\n');drop.chmod(0o644)
  command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
  port=int(env.get('MCP_PORT','8770'));token=env.get('CHATGPT_READ_TOKEN','')
  if not token:raise RuntimeError('LAB_CLIENT_AUTH_MISSING')
  body=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}}).encode()
  req=Request('http://127.0.0.1:'+str(port)+'/mcp',data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
  # One startup observation retry is read-only and does not dispatch anything.
  error=None
  for _ in range(5):
   try:
    with urlopen(req,timeout=4) as r:result=json.load(r)
    error=None;break
   except OSError as e:error=e;time.sleep(.3)
  if error:raise RuntimeError('LAB_STARTUP_NOT_PROVEN')
  names=[t['name'] for t in result.get('result',{}).get('tools',[])]
  if not {'preparar_lote','registrar_revisao_lote','listar_conversas'}<=set(names):raise RuntimeError('LAB_CATALOG_NOT_PROVEN')
  if command(['systemctl','is-active',UNIT])!='active':raise RuntimeError('LAB_UNIT_NOT_ACTIVE')
  report={'status':'LAB_EXTENSION_INSTALLED','tools':names,'source':'fixture','real_send_enabled':False,'real_operator_review':'AWAITING_USER_IN_PROTECTED_CHATGPT_UI','whatsapp_sends':0,'production_changes':0,'backup':str(backup),'lab_pid':command(['systemctl','show',UNIT,'-p','MainPID','--value']),'lab_tunnel_pid_unchanged':tunnel_before==command(['systemctl','show','santana-mcp-lab-tunnel.service','-p','MainPID','--value'])}
 except BaseException:
  if drop.exists():drop.unlink();command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
  if target.exists():target.rename(backup/'candidate-not-activated')
  raise SystemExit('INSTALL_FAILED_LAB_RESTORED_NO_PRODUCTION_CHANGE') from None
 output=Path('/home/runner/santana-mcp-staging')/('batch-lab-result-'+str(time.time_ns())+'.json')
 fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'w') as f:json.dump(report,f)
 print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
