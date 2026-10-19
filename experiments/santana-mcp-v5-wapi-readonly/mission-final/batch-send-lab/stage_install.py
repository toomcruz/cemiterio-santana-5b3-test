"""Runner staging, safe privilege check and bounded LAB metadata; no agents."""
import hashlib,json,os,re,stat,subprocess,sys,time
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
 if '--validate-recovery' in sys.argv:
  start=time.monotonic()
  clean={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH') if k in os.environ}
  test=subprocess.run([sys.executable,str(R/'test_install_recovery.py')],env=clean,capture_output=True,text=True,timeout=60)
  log=test.stdout+test.stderr
  count=re.search(r'Ran ([0-9]+) tests',log)
  result={'status':'PASS' if test.returncode==0 and count and int(count[1])==6 else 'FAIL','suite':'lab_installer_recovery','tests':int(count[1]) if count else 0,'seconds':round(time.monotonic()-start,3),'log_sha256':hashlib.sha256(log.encode()).hexdigest(),'systemd':'simulated','processes_and_sqlite':'real_synthetic','production_changes':0,'agent_calls':0,'real_messages_sent':0}
  print(json.dumps({'installer_recovery_validation':result}))
  if result['status']!='PASS':raise SystemExit('INSTALLER_RECOVERY_VALIDATION_FAILED')
 subprocess.run([sys.executable,str(R/'build_install.py')],check=True,capture_output=True,text=True,timeout=10)
 code=(R/'install-lab.py').read_bytes();sha=hashlib.sha256(code).hexdigest()
 parent=Path('/home/runner/santana-mcp-staging');target=parent/('batch-auth-'+sha[:12])
 if parent.is_symlink() or target.is_symlink():raise SystemExit('UNSAFE_STAGE')
 target.mkdir(mode=0o755,parents=True,exist_ok=True);p=target/'install-lab.py'
 try:
  fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
  with os.fdopen(fd,'wb') as f:f.write(code)
 except FileExistsError:
  if p.is_symlink() or p.read_bytes()!=code:raise SystemExit('STAGE_COLLISION')
 sudo=subprocess.run(['sudo','-n','true'],capture_output=True,text=True,timeout=5)
 report={'status':'STAGED_ROOT_REQUIRED' if sudo.returncode else 'STAGED_PRIVILEGE_AVAILABLE','path':str(p),'sha256':sha,'uid':os.getuid(),'sudo_without_password':sudo.returncode==0,'services_changed':0,'production_changes':0,'real_messages_sent':0}
 if '--apply-if-authorized' in sys.argv and sudo.returncode==0:
  # A digest-checked copy is executed in a root interpreter. No shell evaluation.
  verify="import os,hashlib;f=os.open("+repr(str(p))+",os.O_RDONLY|os.O_NOFOLLOW);b=os.read(f,524289);os.close(f);assert len(b)<=524288 and hashlib.sha256(b).hexdigest()=="+repr(sha)+";exec(compile(b,'verified_santana_batch_lab','exec'),{'__name__':'__main__'})"
  r=subprocess.run(['sudo','-n','/usr/bin/python3','-I','-c',verify],capture_output=True,text=True,timeout=75)
  report['installation_exit_code']=r.returncode;report['installation_result']=r.stdout[-10000:]
  if r.returncode:report['status']='INSTALLATION_STOPPED'
 for unit in ('santana-mcp-lab.service','santana-mcp-lab-tunnel.service'):
  r=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','--value'],capture_output=True,text=True,timeout=5)
  report[unit]=r.stdout.strip().splitlines()
 print(json.dumps(report))
if __name__=='__main__':main()
