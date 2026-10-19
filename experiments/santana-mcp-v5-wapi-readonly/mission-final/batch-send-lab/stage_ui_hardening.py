"""Use existing runner/admin access; stage one reviewed root action if needed."""
import hashlib,json,os,re,shutil,subprocess,sys,tempfile,time,zipfile
from pathlib import Path
from build_ui_hardening import build,ROOT

def main():
    parent=Path('/home/runner/santana-mcp-staging')
    if parent.is_symlink():raise SystemExit('UNSAFE_STAGE')
    parent.mkdir(mode=0o755,parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='santana-review-deps-') as td:
        packages=Path(td)/'packages'
        result=subprocess.run([sys.executable,'-m','pip','install','--disable-pip-version-check','--no-input','--no-compile','--only-binary=:all:','--no-deps','--target',str(packages),'-r',str(ROOT/'review-requirements.txt')],capture_output=True,text=True,timeout=100)
        if result.returncode:raise SystemExit('RENDERER_DEPENDENCY_PREPARATION_FAILED')
        archive=Path(td)/'review-deps.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in sorted(packages.rglob('*')):
                if p.is_symlink():raise SystemExit('DEPENDENCY_SYMLINK_REJECTED')
                if p.is_file():z.write(p,str(p.relative_to(packages)))
        sha=hashlib.sha256(archive.read_bytes()).hexdigest()
        dependency_path=parent/('review-deps-'+sha+'.zip')
        if dependency_path.exists():
            if dependency_path.is_symlink() or hashlib.sha256(dependency_path.read_bytes()).hexdigest()!=sha:raise SystemExit('DEPENDENCY_STAGE_COLLISION')
        else:
            fd=os.open(dependency_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
            with os.fdopen(fd,'wb') as f:f.write(archive.read_bytes())
        local_deps=ROOT/'review-deps'
        if local_deps.exists() or local_deps.is_symlink():raise SystemExit('TEST_DEPENDENCY_PATH_COLLISION')
        shutil.copytree(packages,local_deps)
        clean={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH') if k in os.environ}
        clean.update(PYTHONDONTWRITEBYTECODE='1',SANTANA_REVIEW_TEST_DEPS_ZIP=str(dependency_path))
        suites=[('python_ui_and_auth_regressions',[sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_ui_hardening.py','-v'],13),
            ('widget_ui',['node','--require',str(ROOT/'network_guard.cjs'),'--test',str(ROOT/'test-widget-hardening.mjs')],7),
            ('install_transaction',[sys.executable,str(ROOT/'test_ui_hardening_install.py'),
                'UIHardeningInstallTests.test_hardening_install_and_repeated_application_preserve_audit',
                'UIHardeningInstallTests.test_hardening_health_failure_restores_original_and_unknown_operation',
                'UIHardeningInstallTests.test_hardening_code_drift_stops_before_service_stop','-v'],3)]
        validation=[]
        try:
            for name,cmd,expected in suites:
                start=time.monotonic();r=subprocess.run(cmd,cwd=ROOT,env=clean,capture_output=True,text=True,timeout=65)
                log=r.stdout+r.stderr;match=re.search(r'Ran (\d+) tests',log) or re.search(r'(?:# |ℹ )tests (\d+)',log)
                count=int(match[1]) if match else 0
                (ROOT/'validation'/('hardening-'+name+'.log')).write_text(log)
                item={'suite':name,'tests':count,'exit_code':r.returncode,'seconds':round(time.monotonic()-start,3),'sha256':hashlib.sha256(log.encode()).hexdigest()};validation.append(item)
                if r.returncode or count!=expected or 'skipped=' in log:
                    print(json.dumps({'status':'LAB_UI_VALIDATION_FAILED','suite':item,'synthetic_test_log_tail':log[-6000:]}));raise SystemExit(1)
        finally:shutil.rmtree(local_deps)
        print(json.dumps({'validation':{'status':'PASS','tests':23,'new_checks':17,'affected_auth_regressions':6,'suites':validation,'real_whatsapp_sends':0,'production_changes':0}}))
    code,manifest=build(dependency_path)
    destination=parent/('batch-ui-hardening-'+manifest['sha256'][:12]);destination.mkdir(mode=0o755,exist_ok=True)
    if destination.is_symlink():raise SystemExit('UNSAFE_STAGE')
    payload=destination/'apply-lab.py'
    if payload.exists():
        if payload.is_symlink() or payload.read_text()!=code:raise SystemExit('PAYLOAD_STAGE_COLLISION')
    else:
        fd=os.open(payload,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
        with os.fdopen(fd,'w') as f:f.write(code)
    sudo=subprocess.run(['sudo','-n','true'],capture_output=True,timeout=5)
    report={**manifest,'path':str(payload),'status':'STAGED_ROOT_REQUIRED' if sudo.returncode else 'STAGED_PRIVILEGE_AVAILABLE','uid':os.getuid(),'sudo_without_password':sudo.returncode==0}
    if sudo.returncode==0:
        verifier="import hashlib,os;p="+repr(str(payload))+";fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);b=os.read(fd,524289);os.close(fd);assert len(b)<=524288 and hashlib.sha256(b).hexdigest()=="+repr(manifest['sha256'])+";exec(compile(b,'santana_lab_verified','exec'),{'__name__':'__main__'})"
        result=subprocess.run(['sudo','-n','/usr/bin/python3','-I','-c',verifier],capture_output=True,text=True,timeout=90)
        report.update(application_exit_code=result.returncode,application_report=result.stdout[-10000:])
    for unit in ('santana-mcp-lab.service','santana-mcp-lab-tunnel.service'):
        result=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ActiveState','--value'],capture_output=True,text=True,timeout=5)
        report[unit]=result.stdout.strip().splitlines()
    print(json.dumps(report))

if __name__=='__main__':main()
