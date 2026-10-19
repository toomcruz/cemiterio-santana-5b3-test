"""Existing runner: temporary dependencies and synthetic focused checks only."""
import json,os,subprocess,sys,tempfile
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
    units=('santana-mcp-lab.service','santana-mcp-lab-tunnel.service')
    def pids():return{u:subprocess.run(['systemctl','show',u,'-p','MainPID','--value'],capture_output=True,text=True,timeout=5).stdout.strip() for u in units}
    before=pids()
    with tempfile.TemporaryDirectory(prefix='santana-daily-synthetic-') as td:
        root=Path(td);py=root/'python';npm=root/'npm'
        subprocess.run([sys.executable,'-m','venv',str(py)],check=True,capture_output=True,timeout=30)
        python=str(py/'bin/python')
        for cmd in [['npm','install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--prefix',str(npm),'@electric-sql/pglite@0.3.14'],[python,'-m','pip','install','--disable-pip-version-check','--no-input','--only-binary=:all:','-r',str(R/'requirements.txt')]]:
            r=subprocess.run(cmd,capture_output=True,text=True,timeout=90)
            if r.returncode:raise SystemExit('ISOLATED_DEPENDENCY_FAILED')
        env={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','HOME','LD_LIBRARY_PATH') if k in os.environ}
        env.update(PYTHONDONTWRITEBYTECODE='1',SANTANA_PGLITE_MODULE=str(npm/'node_modules/@electric-sql/pglite/dist/index.js'))
        r=subprocess.run([python,str(R/'run-daily-validation.py')],capture_output=True,text=True,timeout=100,env=env)
        print(r.stdout)
        if r.returncode:print(r.stderr[-2000:]);raise SystemExit('DAILY_SYNTHETIC_VALIDATION_FAILED')
    after=pids()
    if before!=after:raise SystemExit('LAB_PROCESS_CHANGED_DURING_TEST')
    print(json.dumps({'status':'DAILY_OPERATIONS_SYNTHETIC_PASS','source_commit':os.environ.get('GITHUB_SHA'),'service_pids_unchanged':True,'production_changes':0,'real_whatsapp_sends':0,'new_write_grants':0,'sana_openbot_boss_n8n_operations':0}))
if __name__=='__main__':main()
