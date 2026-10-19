"""Focused isolated checks for media errors, response triage and individual scope.

No production credentials, real contacts, service changes or provider calls.
"""
import datetime,json,os,re,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
    logs=R/'validation/daily-operations';logs.mkdir(parents=True,exist_ok=True)
    result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS','environment':'isolated_synthetic','production_changes':0,'write_grants_activated':0,'real_messages_sent':0,'suites':[]}
    commands=[('build_read',[sys.executable,str(R/'build-candidate.py')]),('build_individual',[sys.executable,str(R.parent/'admin-supervised-send/build-candidate.py')]),('build_daily_delta',[sys.executable,str(R.parent/'admin-supervised-send/build-daily-delta.py')]),
      ('media_triage',['node','--experimental-strip-types','--test','--test-concurrency=1','--test-reporter=tap',str(R/'test-admin-core.mjs'),str(R/'test-read-media.mjs'),str(R/'test-response-triage.mjs'),str(R/'test-triage-postgres.mjs')]),
      ('mcp_safe_errors',[sys.executable,str(R/'test_admin_error_flow.py')]),
      ('individual_scope',['node','--experimental-strip-types','--test','--test-concurrency=1','--test-reporter=tap',str(R.parent/'admin-supervised-send/test-supervised-postgres.mjs'),str(R.parent/'admin-supervised-send/test-edge-binding.mjs')]),
      ('individual_status',[sys.executable,str(R.parent/'admin-supervised-send/test_status_client.py')])]
    for name,cmd in commands:
        r=subprocess.run(cmd,capture_output=True,text=True,timeout=75,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=r.stdout+r.stderr;(logs/(name+'.log')).write_text(output)
        count=re.search(r'# tests (\d+)',output) or re.search(r'Ran (\d+) tests',output)
        result['suites'].append({'name':name,'exit_code':r.returncode,'tests':int(count[1]) if count else 0})
        if r.returncode:
            result['status']='FAIL';print(output[-9000:]);break
    result['total_tests']=sum(x['tests'] for x in result['suites']);(logs/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));return result['status']!='PASS'
if __name__=='__main__':raise SystemExit(main())
