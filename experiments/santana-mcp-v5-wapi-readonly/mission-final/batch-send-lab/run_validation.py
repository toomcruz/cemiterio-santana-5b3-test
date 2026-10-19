"""Bounded tests on the existing runner. No privileged actions or deployments."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parent
UNITS=('santana-mcp-lab.service','santana-mcp-lab-tunnel.service','openbot.service','openbot-tunnel.service','docker.service')
def states():
    result={}
    for unit in UNITS:
        r=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ActiveState','--value'],capture_output=True,text=True,timeout=5)
        result[unit]=r.stdout.strip().splitlines()
    return result

def main(runner=False):
    validation=ROOT/'validation';validation.mkdir(exist_ok=True)
    before=states() if runner else None
    suites=[];started=time.monotonic()
    clean={k:os.environ[k] for k in ('PATH','LANG','LC_ALL','LD_LIBRARY_PATH','SANTANA_PGLITE_MODULE') if k in os.environ}
    clean.update(PYTHONDONTWRITEBYTECODE='1',SANTANA_TEST_PYTHON=sys.executable)
    with tempfile.TemporaryDirectory(prefix='santana-batch-offline-') as td:
        # Only ephemeral wire tests may connect to their own 127.0.0.1 listener.
        Path(td,'sitecustomize.py').write_text("import socket\noriginal=socket.socket.connect\ndef connect(self,address):\n if not isinstance(address,tuple) or address[0] not in ('127.0.0.1','::1'): raise RuntimeError('LAB_EXTERNAL_NETWORK_DENIED')\n return original(self,address)\nsocket.socket.connect=connect\nsocket.socket.connect_ex=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('LAB_EXTERNAL_NETWORK_DENIED'))\n")
        clean['PYTHONPATH']=td
        commands=[('python',[sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_*.py','-v']),
                  ('official-regression',['node','--require',str(ROOT/'network_guard.cjs'),'--experimental-strip-types','--test','--test-concurrency=1','--test-reporter=tap',str(ROOT/'test_official_integration.mjs'),str(ROOT.parent/'supervised-send/test-adapter.mjs'),str(ROOT.parent/'supervised-send/test-media-attachments.mjs')])]
        if clean.get('SANTANA_PGLITE_MODULE'):
            commands.append(('official-postgres',['node','--require',str(ROOT/'network_guard.cjs'),'--experimental-strip-types','--test','--test-concurrency=1','--test-reporter=tap',str(ROOT.parent/'admin-supervised-send/test-supervised-postgres.mjs')]))
        for name,command in commands:
            t=time.monotonic();r=subprocess.run(command,capture_output=True,text=True,env=clean,timeout=60)
            log=r.stdout+r.stderr;(validation/(name+'.log')).write_text(log)
            n=re.search(r'Ran (\d+) tests',log) or re.search(r'# tests (\d+)',log)
            suites.append({'suite':name,'tests':int(n[1]) if n else 0,'exit_code':r.returncode,'seconds':round(time.monotonic()-t,3),'log_sha256':hashlib.sha256(log.encode()).hexdigest()})
            if r.returncode:
                print(log[-7000:]);raise SystemExit('BATCH_LAB_VALIDATION_FAILED')
        r=subprocess.run([sys.executable,str(ROOT/'demo.py')],capture_output=True,text=True,env=clean,timeout=15)
        if r.returncode:raise SystemExit('BATCH_LAB_DEMO_FAILED')
        demo=json.loads(r.stdout);demo.pop('contract_payloads')
        (validation/'demo-results.json').write_text(json.dumps(demo,ensure_ascii=False,indent=2)+'\n')
    after=states() if runner else None
    # Metadata only: no private config, environment values, credentials or messages.
    installed=[]
    if runner:
        for p in (Path('/opt/santana-mcp-lab'),Path('/home/runner/santana-mcp-staging')):
            if p.exists():installed.append({'path':str(p),'uid':p.stat().st_uid,'writable_by_runner':os.access(p,os.W_OK)})
        r=subprocess.run(['systemctl','show','santana-mcp-lab.service','-p','WorkingDirectory','--value'],capture_output=True,text=True,timeout=5)
        p=Path(r.stdout.strip()) if r.returncode==0 and r.stdout.strip().startswith('/') else None
        if p is not None:
            installed.append({'unit':'santana-mcp-lab.service','working_directory':str(p),'code_readable_by_runner':os.access(p/'server.py',os.R_OK),'code_writable_by_runner':os.access(p/'server.py',os.W_OK)})
    report={'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'isolated_synthetic','suites':suites,'total_tests':sum(x['tests'] for x in suites),'seconds':round(time.monotonic()-started,3),'max_child_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
      'demos':demo['demos'],'real_messages_sent':0,'production_writes':0,'services_changed':0,'sana_activated':False,'existing_runner_used':runner,'service_states_before':before,'service_states_after':after,'service_states_unchanged':before==after if runner else None,'installation_metadata':installed,
      'host_chatgpt_new_tools_tested':False,'independent_real_operator_session_tested':False,'official_panel_batch_records_written':False,'deployment_state':'ISOLATED_LAB_EXTENSION_NOT_INSTALLED_IN_ACTIVE_PLUGIN'}
    (validation/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False));return 0
if __name__=='__main__':raise SystemExit(main('--runner' in sys.argv))
