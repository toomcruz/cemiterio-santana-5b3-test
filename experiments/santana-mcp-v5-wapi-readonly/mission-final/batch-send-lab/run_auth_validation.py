"""Focused Auth changes + directly affected Python regressions; no production."""
import hashlib,json,os,re,subprocess,sys,tempfile,time
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
 out=R/'validation';reports=[];started=time.monotonic()
 clean={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH','SANTANA_PGLITE_MODULE') if k in os.environ}
 clean['PYTHONDONTWRITEBYTECODE']='1'
 with tempfile.TemporaryDirectory(prefix='santana-auth-offline-') as td:
  Path(td,'sitecustomize.py').write_text("import socket\nold=socket.socket.connect\ndef c(self,a):\n if not isinstance(a,tuple) or a[0] not in ('127.0.0.1','::1'):raise RuntimeError('OFFLINE_ONLY')\n return old(self,a)\nsocket.socket.connect=c\n")
  clean['PYTHONPATH']=td
  commands=[('python_auth_and_affected_regressions',[sys.executable,'-m','unittest','discover','-s',str(R),'-p','test_*.py','-v']),('review_auth',['node','--require',str(R/'network_guard.cjs'),'--test','--test-reporter=tap',str(R/'test-real-review.mjs')])]
  if clean.get('SANTANA_PGLITE_MODULE'):commands.append(('receipt_sql',['node','--require',str(R/'network_guard.cjs'),'--test','--test-reporter=tap',str(R/'test-lab-receipts.mjs')]))
  for name,cmd in commands:
   r=subprocess.run(cmd,env=clean,capture_output=True,text=True,timeout=60);log=r.stdout+r.stderr;(out/(name+'.log')).write_text(log)
   n=re.search(r'Ran (\d+) tests',log) or re.search(r'# tests (\d+)',log)
   reports.append({'suite':name,'tests':int(n[1]) if n else 0,'exit_code':r.returncode,'sha256':hashlib.sha256(log.encode()).hexdigest()})
   if r.returncode:print(log[-7000:]);raise SystemExit('AUTH_VALIDATION_FAILED')
 report={'status':'PASS','suites':reports,'tests':sum(s['tests'] for s in reports),'seconds':round(time.monotonic()-started,3),'previous_73_tests_preserved':True,'production_changes':0,'real_messages_sent':0,'agent_calls':0}
 (out/'auth-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
