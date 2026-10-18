"""Offline tests, bounded installation metadata and immutable root staging."""
import hashlib,json,os,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
units=('openbot.service','openbot-bridge.service','openbot-tunnel.service','santana-mcp-lab.service','santana-mcp-lab-tunnel.service')
def pids():
 return {u:subprocess.run(['systemctl','show',u,'-p','MainPID','--value'],capture_output=True,text=True,timeout=5).stdout.strip() for u in units}

def main(stage=False):
 before=pids() if stage else None
 reports=[]
 commands=[('original_package',[sys.executable,'-m','unittest','discover','-s',str(ROOT/'baseline-package'),'-v']),('candidate',[sys.executable,'-m','unittest','discover','-s',str(ROOT/'candidate'),'-v']),('bridge_patch',[sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_bridge_patch.py','-v']),('privileged_gate',[sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_privileged_gate.py','-v']),('existing_multiagent_regression',[sys.executable,'-m','unittest','discover','-s',str(ROOT/'bridge-patch/tests'),'-v'])]
 # No external network in test children. All API responses are synthetic.
 with tempfile.TemporaryDirectory(prefix='sana-memory-test-') as td:
  Path(td,'sitecustomize.py').write_text("import socket\ndef denied(*a,**k): raise RuntimeError('OFFLINE_TEST_NETWORK_DENIED')\nsocket.socket.connect=denied\nsocket.socket.connect_ex=denied\nsocket.create_connection=denied\n")
  env={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH') if k in os.environ}
  env.update(PYTHONPATH=td,PYTHONDONTWRITEBYTECODE='1')
  for suite,cmd in commands:
   r=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=30)
   log=r.stdout+r.stderr
   n=re.search(r'Ran (\d+) tests?',log)
   result={'suite':suite,'exit_code':r.returncode,'tests':int(n[1]) if n else 0,'log_sha256':hashlib.sha256(log.encode()).hexdigest()}
   reports.append(result)
   (ROOT/'validation').mkdir(exist_ok=True);(ROOT/'validation'/f'{suite}.log').write_text(log)
   if r.returncode:print(log[-8000:]);raise SystemExit('OFFLINE_TESTS_FAILED')
 metadata={'application_roots':[]}
 if stage:
  for base in ('/opt/OpenBot/app','/opt/OpenBot/hosted'):
   p=Path(base);found=[];scanned=0
   if p.is_dir():
    for root,dirs,files in os.walk(p):
     depth=len(Path(root).relative_to(p).parts)
     dirs[:]=[d for d in dirs if d not in ('node_modules','.git') and depth<4]
     for name in files:
      q=Path(root)/name
      if name=='package.json':
       try:
        data=json.loads(q.read_text());found.append({'path':str(q),'name':data.get('name'),'version':data.get('version')})
       except (ValueError,OSError):pass
      if q.suffix in ('.js','.mjs','.cjs') and scanned<10:
       try:
        if q.stat().st_size>30000000:continue
        b=q.read_bytes();scanned+=1
        matches={k:k.encode() in b for k in ('agent-tasks-v1','/v1/agent-tasks/start','/v1/agent-tasks/send','/deliveries/')}
        if any(matches.values()):found.append({'path':str(q),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'markers':matches})
       except OSError:pass
   metadata['application_roots'].append({'path':base,'matches':found,'js_files_scanned':scanned})
 report={'status':'ISOLATED_TESTS_PASS','suites':reports,'candidate_and_regression_tests':sum(r['tests'] for r in reports if r['suite']!='original_package'),'original_package_tests':reports[0]['tests'],'live_openbot_session_tests':'NOT_RUN_TEAM_MEMBER_ACCESS_NOT_ESTABLISHED','live_result_reproduction':{'task_id':'d6d8d76dbb344a0a9d70e22acaeee342','run_id':'1acc093e-de6c-40a5-9c13-1aa004c38e7e','delivery_id':'8e77a49f-53a0-443b-9667-439e83cf57f2','run_status':'succeeded','result_available':False,'attempts':1},'metadata':metadata,'production_writes':0,'whatsapp_sends':0,'sana_activated':False}
 if stage and not (ROOT/'DEPLOYMENT-RETIRED.json').exists():
  payload=(ROOT/'apply-lab.py').read_bytes();h=hashlib.sha256(payload).hexdigest()
  dest=Path('/home/runner/santana-mcp-staging')/('sana-memory-'+h[:12])
  if dest.is_symlink():raise SystemExit('UNSAFE_STAGE')
  dest.mkdir(parents=True,exist_ok=True)
  target=dest/'apply-lab.py'
  try:
   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
   with os.fdopen(fd,'wb') as f:f.write(payload)
  except FileExistsError:
   if target.is_symlink() or target.read_bytes()!=payload:raise SystemExit('STAGE_COLLISION')
  report['root_payload']={'path':str(target),'sha256':h,'installed':False}
  report['service_pids_unchanged']=before==pids()
 if stage and (ROOT/'DEPLOYMENT-RETIRED.json').exists():
  report['root_payload']={'retired':True,'installed':False,'stage_allowed':False,'reason':'COMPLETED_ROUTINE_HAS_NO_REPLY_AND_STABLE_TEAM_API_UNSUPPORTED'}
  report['service_pids_unchanged']=before==pids()
 (ROOT/'validation/result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main('--stage' in sys.argv)
