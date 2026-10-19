"""Validate and stage the minimal catalog correction; never invokes agents."""
import hashlib,json,os,re,subprocess,sys,time
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
    subprocess.run([sys.executable,str(R/'build_ui_fix.py')],capture_output=True,check=True,timeout=10)
    start=time.monotonic()
    tests=['InstallerRecoveryTests.test_private_tool_descriptor_is_app_only_without_render_resource','InstallerRecoveryTests.test_installed_metadata_patch_is_minimal_and_idempotent','InstallerRecoveryTests.test_installed_metadata_patch_restores_original_on_failed_health']
    clean={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH') if k in os.environ}
    r=subprocess.run([sys.executable,str(R/'test_install_recovery.py'),*tests],env=clean,capture_output=True,text=True,timeout=60)
    log=r.stdout+r.stderr;count=re.search(r'Ran ([0-9]+) tests',log)
    result={'status':'PASS' if r.returncode==0 and count and int(count[1])==3 and 'skipped=' not in log else 'FAIL','tests':int(count[1]) if count else 0,'seconds':round(time.monotonic()-start,3),'log_sha256':hashlib.sha256(log.encode()).hexdigest(),'systemd':'simulated','processes_and_sqlite':'real_synthetic','production_changes':0,'real_messages_sent':0}
    print(json.dumps({'ui_metadata_validation':result}))
    if result['status']!='PASS':raise SystemExit('UI_METADATA_VALIDATION_FAILED')
    code=(R/'fix-ui-metadata.py').read_bytes();sha=hashlib.sha256(code).hexdigest()
    parent=Path('/home/runner/santana-mcp-staging');target=parent/('batch-ui-fix-'+sha[:12])
    if parent.is_symlink() or target.is_symlink():raise SystemExit('UNSAFE_STAGE')
    target.mkdir(mode=0o755,parents=True,exist_ok=True);p=target/'fix-ui-metadata.py'
    try:
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
        with os.fdopen(fd,'wb') as f:f.write(code)
    except FileExistsError:
        if p.is_symlink() or p.read_bytes()!=code:raise SystemExit('STAGE_COLLISION')
    sudo=subprocess.run(['sudo','-n','true'],capture_output=True,text=True,timeout=5)
    report={'status':'STAGED_ROOT_REQUIRED' if sudo.returncode else 'STAGED_PRIVILEGE_AVAILABLE','path':str(p),'sha256':sha,'uid':os.getuid(),'sudo_without_password':sudo.returncode==0,'services_changed':0,'production_changes':0,'real_messages_sent':0}
    if sudo.returncode==0:
        check="import os,hashlib;f=os.open("+repr(str(p))+",os.O_RDONLY|os.O_NOFOLLOW);b=os.read(f,524289);os.close(f);assert len(b)<=524288 and hashlib.sha256(b).hexdigest()=="+repr(sha)+";exec(compile(b,'verified_santana_ui_fix','exec'),{'__name__':'__main__'})"
        r=subprocess.run(['sudo','-n','/usr/bin/python3','-I','-c',check],capture_output=True,text=True,timeout=75)
        report.update(installation_exit_code=r.returncode,installation_result=r.stdout[-10000:])
    for unit in ('santana-mcp-lab.service','santana-mcp-lab-tunnel.service'):
        r=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','--value'],capture_output=True,text=True,timeout=5);report[unit]=r.stdout.strip().splitlines()
    print(json.dumps(report))
if __name__=='__main__':main()
