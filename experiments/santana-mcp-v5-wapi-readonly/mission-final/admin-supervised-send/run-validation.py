"""Isolated synthetic validation. No credentials, production calls or sends."""
import ast,datetime,json,os,re,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parent
def main():
    logs=R/'validation';logs.mkdir(exist_ok=True)
    result={'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':'isolated_synthetic','production_writes':0,'real_messages_sent':0,'new_live_permissions':0,'suites':[]}
    commands=[('build',[sys.executable,str(R/'build-candidate.py')]),('node',['node','--experimental-strip-types','--test','--test-concurrency=1','--test-reporter=tap',str(R/'test-supervised-postgres.mjs'),str(R/'test-edge-binding.mjs')]),('python',[sys.executable,'-m','unittest','discover','-s',str(R),'-p','test_*.py'])]
    for name,command in commands:
        r=subprocess.run(command,capture_output=True,text=True,timeout=60,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'});s=r.stdout+r.stderr;(logs/(name+'.log')).write_text(s)
        n=re.search(r'# tests (\d+)',s) or re.search(r'Ran (\d+) tests',s)
        result['suites'].append({'name':name,'exit_code':r.returncode,'tests':int(n[1]) if n else 0})
        if r.returncode:result['status']='FAIL';break
    if result['status']=='PASS':
        for f in (R/'candidate').glob('*.py'):ast.parse(f.read_text())
        r=subprocess.run(['node','--experimental-strip-types','--check',str(R/'candidate/mcp-official-operations.ts')],capture_output=True,text=True,timeout=15)
        if r.returncode:result['status']='FAIL';(logs/'syntax.log').write_text(r.stderr)
    result['total_tests']=sum(s['tests'] for s in result['suites']);(logs/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));return result['status']!='PASS'
if __name__=='__main__':raise SystemExit(main())
