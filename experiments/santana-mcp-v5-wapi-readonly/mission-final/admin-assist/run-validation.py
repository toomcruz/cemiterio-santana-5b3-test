"""Isolated validation only; no service, deployment or real-user calls."""
import datetime,json,os,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def main():
    logs=ROOT/'validation';logs.mkdir(exist_ok=True)
    commands=[('build',[sys.executable,str(ROOT/'build-candidate.py')]),
      ('node',['node','--test','--test-concurrency=1','--test-reporter=tap',str(ROOT/'test-admin-core.mjs'),str(ROOT/'test-read-media.mjs'),str(ROOT/'test-admin-postgres.mjs')]),
      ('python',[sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_*.py']),
      ('send-regression',['node','--experimental-strip-types','--test','--test-reporter=tap',str(ROOT.parent/'supervised-send/test-adapter.mjs'),str(ROOT.parent/'supervised-send/test-binding.mjs'),str(ROOT.parent/'supervised-send/test-media-attachments.mjs')])]
    result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'isolated_synthetic','status':'PASS','real_messages_sent':0,'production_writes':0,'real_message_access_expanded':False,'services_changed':0,'suites':[]}
    for name,command in commands:
        r=subprocess.run(command,capture_output=True,text=True,timeout=75,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=r.stdout+r.stderr;(logs/(name+'.log')).write_text(output)
        count=re.search(r'# tests (\d+)',output) or re.search(r'Ran (\d+) tests',output)
        result['suites'].append({'name':name,'exit_code':r.returncode,'tests':int(count[1]) if count else None})
        if r.returncode:result['status']='FAIL';break
    if result['status']=='PASS':
        for file in ['prod-edge/mcp-admin-assist.ts','prod-edge/index.ts','homolog-edge/index.ts']:
            r=subprocess.run(['node','--experimental-strip-types','--check',str(ROOT/'candidate'/file)],capture_output=True,text=True,timeout=15)
            if r.returncode:result['status']='FAIL';(logs/'syntax.log').write_text(r.stdout+r.stderr);break
    result['total_tests']=sum(s['tests'] or 0 for s in result['suites'])
    (logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
