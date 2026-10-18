"""Narrow privileged LAB patch. Data appended by build_payload.py; no arbitrary URL/command."""
import hashlib,json,os,pwd,re,runpy,sqlite3,stat,subprocess,tempfile,time
from pathlib import Path
from contextlib import closing

SOURCE=Path('/opt/openbot-bridge')
SERVICE='openbot-bridge.service'
UNTOUCHED=('openbot.service','openbot-tunnel.service','santana-mcp-lab.service','santana-mcp-lab-tunnel.service')
EXPECTED={'server.py':'f950916b3e396b0d97bbd5014c9d988300f9a33a5634e6282ec0e4d8f5bdebc6','agent_messages.py':'23c6ce2542f729d45f8bbbc157d75760743ef46ee7511f0f9d2f9caedc4bdda7','events.py':'29cf81cb9a94fbfe9666a427eccfc55c1611216f2ede4eec9b0d9941db6f5b63','task_queue.py':'35d3e2ff228f66573db9c36fce07e7583517c75b93595f5cf8177e24c561ca37'}
RUN_ID='1acc093e-de6c-40a5-9c13-1aa004c38e7e'
TASK_ID='d6d8d76dbb344a0a9d70e22acaeee342'

def safe_file(path,owner=0):
 st=path.lstat()
 if not stat.S_ISREG(st.st_mode) or st.st_uid!=owner or st.st_mode&0o022 or st.st_size>524288:
  raise RuntimeError('UNSAFE_SOURCE')
 return path.read_bytes()

def verify_sources():
 for name,h in EXPECTED.items():
  if hashlib.sha256(safe_file(SOURCE/name)).hexdigest()!=h:raise RuntimeError('ACTIVE_SOURCE_CHANGED_NO_WRITE')
 for name in PATCHES:
  if name not in EXPECTED and (SOURCE/name).exists():raise RuntimeError('NEW_PATH_ALREADY_EXISTS_NO_WRITE')

def service_pids():
 return {u:subprocess.run(['systemctl','show',u,'-p','MainPID','--value'],capture_output=True,text=True,timeout=5).stdout.strip() for u in UNTOUCHED}

def service_env():
 pid=subprocess.run(['systemctl','show',SERVICE,'-p','MainPID','--value'],capture_output=True,text=True,timeout=5).stdout.strip()
 if not pid.isdigit() or pid=='0':raise RuntimeError('BRIDGE_NOT_RUNNING')
 # Select non-secret IDs and paths only. No bearer token is read/copied/logged.
 allowed={'BRIDGE_BOSS_AGENT_ID','BRIDGE_TASK_ROUTINE_ID','BRIDGE_RUN_DB','BRIDGE_AUTOMATION_DIR','BRIDGE_EVENT_DB'}
 values={}
 for item in Path('/proc',pid,'environ').read_bytes().split(b'\0'):
  key,_,value=item.partition(b'=')
  if key.decode(errors='ignore') in allowed:values[key.decode()]=value.decode()
 return values

def drop_to_openbot():
 user=pwd.getpwnam('openbot')
 os.setgroups([]);os.setgid(user.pw_gid);os.setuid(user.pw_uid)


def probe(candidate,env):
 """Read ONE existing synthetic run using the service's own Local Scripts auth."""
 rfd,wfd=os.pipe();pid=os.fork()
 if pid==0:
  os.close(rfd)
  try:
   drop_to_openbot();os.environ.clear();os.environ.update(env)
   ns=runpy.run_path(str(candidate/'server.py'),run_name='sana_memory_lab_probe')
   result=ns['_run_result']({'run_id':RUN_ID})
   text=result.get('result')
   proof={'run_id':RUN_ID,'result_available':result.get('result_available') is True,
          'source':result.get('source'),'reason':result.get('reason'),
          'marker_verified':isinstance(text,str) and 'SANA_MEMORY_AUDIT_V1' in text,
          'result_sha256':hashlib.sha256(text.encode()).hexdigest() if isinstance(text,str) else None,
          'result_characters':len(text) if isinstance(text,str) else 0,'dispatch_attempts_added':0}
  except BaseException as exc:proof={'result_available':False,'error_class':type(exc).__name__,'dispatch_attempts_added':0}
  os.write(wfd,json.dumps(proof).encode());os.close(wfd);os._exit(0)
 os.close(wfd)
 try:
  with os.fdopen(rfd,'rb') as f:data=f.read(8192)
 finally:os.waitpid(pid,0)
 return json.loads(data)


def idle_queue(env):
 automation=Path(env.get('BRIDGE_AUTOMATION_DIR','/var/lib/openbot/.config/OpenBot/automation'))
 event_db=Path(env.get('BRIDGE_EVENT_DB',str(automation/'mcp-events.sqlite')))
 if event_db.is_symlink():raise RuntimeError('UNSAFE_QUEUE_PATH')
 with closing(sqlite3.connect(event_db.resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as db:
  if db.execute("SELECT count(*) FROM task_queue WHERE state='dispatching'").fetchone()[0]:
   raise RuntimeError('BRIDGE_BUSY_NO_CHANGE')
  # A bridge-only restart leaves remote runs intact; never stop during POST.
  tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  if 'direct_agent_messages' in tables and db.execute("SELECT count(*) FROM direct_agent_messages WHERE state='dispatching'").fetchone()[0]:
   raise RuntimeError('DIRECT_AGENT_WORK_UNRESOLVED_NO_CHANGE')
 return event_db


def atomic(path,content):
 if path.is_symlink():raise RuntimeError('UNSAFE_TARGET')
 tmp=path.parent/('.'+path.name+'.sana-memory-'+str(os.getpid()))
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 try:
  os.fchmod(fd,0o644)
  with os.fdopen(fd,'wb') as f:f.write(content);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()


def backup(event_db):
 parent=Path('/var/backups/openbot-bridge-sana-memory')
 if parent.is_symlink():raise RuntimeError('UNSAFE_BACKUP_ROOT')
 parent.mkdir(mode=0o700,exist_ok=True)
 if parent.stat().st_uid!=0 or parent.stat().st_mode&0o077:raise RuntimeError('UNSAFE_BACKUP_PERMISSIONS')
 dest=parent/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+str(os.getpid()))
 dest.mkdir(mode=0o700)
 manifest={}
 for name in EXPECTED:
  b=safe_file(SOURCE/name);(dest/name).write_bytes(b);(dest/name).chmod(0o600);manifest[name]=hashlib.sha256(b).hexdigest()
 if event_db.stat().st_size>20000000:raise RuntimeError('QUEUE_BACKUP_SIZE_LIMIT')
 with closing(sqlite3.connect(event_db.resolve().as_uri()+'?mode=ro',uri=True,timeout=3)) as src,closing(sqlite3.connect(dest/'bridge-state.sqlite')) as dst:
  src.backup(dst,pages=256,sleep=0.01)
 (dest/'bridge-state.sqlite').chmod(0o600)
 (dest/'manifest.json').write_text(json.dumps(manifest,indent=2));(dest/'manifest.json').chmod(0o600)
 return dest


def main():
 if os.getuid()!=0:raise RuntimeError('ROOT_REQUIRED_NO_CHANGE')
 os.umask(0o077)
 verify_sources();before=service_pids();env=service_env()
 # Preflight code is root-owned, read-only and carries no config or secrets.
 with tempfile.TemporaryDirectory(prefix='sana-memory-preflight-') as td:
  d=Path(td);d.chmod(0o755)
  for name,body in PREFLIGHT.items():
   p=d/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(body);p.chmod(0o644)
   p.parent.chmod(0o755)
  proof=probe(d,env)
 if not (proof.get('result_available') and proof.get('marker_verified') and proof.get('source')=='openbot_local_scripts_delivery'):
  return {'status':'NATIVE_RESULT_NOT_PROVEN_NO_CHANGE','proof':proof,'whatsapp_sends':0,'production_writes':0,'sana_activated':False}
 event_db=idle_queue(env)
 saved=backup(event_db)
 # Check sources/queue again immediately before the brief bridge-only restart.
 verify_sources();idle_queue(env)
 subprocess.run(['systemctl','stop',SERVICE],check=True,timeout=20)
 written=[]
 try:
  for name,body in PATCHES.items():
   p=SOURCE/name
   if not p.parent.exists():p.parent.mkdir(mode=0o755);p.parent.chmod(0o755)
   atomic(p,body.encode());written.append(name)
  subprocess.run(['systemctl','start',SERVICE],check=True,timeout=20)
  active=subprocess.run(['systemctl','is-active','--quiet',SERVICE],timeout=5).returncode==0
  if not active:raise RuntimeError('BRIDGE_START_FAILED')
  post=probe(SOURCE,env)
  if not post.get('result_available') or not post.get('marker_verified'):raise RuntimeError('POST_INSTALL_RESULT_CHECK_FAILED')
 except BaseException:
  subprocess.run(['systemctl','stop',SERVICE],check=False,timeout=20)
  for name in written:
   p=SOURCE/name
   if name in EXPECTED:atomic(p,(saved/name).read_bytes())
   elif p.exists():p.unlink()
  subprocess.run(['systemctl','start',SERVICE],check=False,timeout=20)
  raise RuntimeError('PATCH_ROLLED_BACK') from None
 after=service_pids()
 return {'status':'LAB_RESULT_PATCH_INSTALLED','proof':post,'backup':str(saved),
         'memory_module':'installed_disabled_pending_team_member_access_and_isolation_validation',
         'unchanged_service_pids':before==after,'bridge_restart_only':True,
         'whatsapp_sends':0,'production_writes':0,'sana_activated':False}

# PAYLOAD_DATA_APPENDED_HERE
