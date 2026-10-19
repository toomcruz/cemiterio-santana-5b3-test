"""Local-only verification. Every outbound transport and identity is a fixture."""
from pathlib import Path
import datetime,hashlib,json,re,subprocess,sys,time
R=Path(__file__).resolve().parent;ROOT=R.parent.parent
steps=[('build-candidate',[sys.executable,str(R/'build-candidate.py')]),('compile-preview',['node',str(R/'build-preview.mjs')]),('typecheck',['node',str(R/'check-types.mjs')]),('sql-and-http',['node','--experimental-strip-types','--test',str(R/'test-panel-review.mjs'),str(R/'test-http.mjs')]),('screen-and-session',['node','--test',str(R/'test-ui.mjs')]),('mcp',[sys.executable,str(R/'test-mcp.py'),'-v'])]
E=R/'evidence';E.mkdir(exist_ok=True);results=[]
for name,command in steps:
    start=time.monotonic();p=subprocess.run(command,cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
    (E/(name+'.log')).write_text(p.stdout)
    result={'suite':name,'exit_code':p.returncode,'seconds':round(time.monotonic()-start,3),'log':name+'.log'}
    count=re.search(r'(?:# |ℹ )tests (\d+)',p.stdout) or re.search(r'Ran (\d+) tests',p.stdout)
    if count:result['tests']=int(count.group(1))
    results.append(result);print(json.dumps(result),flush=True)
    if p.returncode:print(p.stdout);break
summary={'status':'PASS' if len(results)==len(steps) and all(r['exit_code']==0 for r in results) else 'FAIL','environment':'isolated_local_postgres_wasm_http_fixture_and_jsdom','at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tests':sum(r.get('tests',0) for r in results),'suites':results,'manifest_sha256':hashlib.sha256((R/'candidate-manifest.json').read_bytes()).hexdigest(),'real_whatsapp_sends':0,'production_mutations_by_this_work':0,'human_authentication':'existing PROD verifier executed against mocked Auth service; real PROD session not exercised','transport':'unchanged deployed Panel sender with injected simulated transport; no external provider requests','database':'PGlite PostgreSQL, isolated in memory; fixture native manual/control functions and last-deployed MCP coordinator SQL','browser_visual_qa':'blocked: cloud browser URL policy disallowed file protocol; no workaround attempted','production_readiness':'candidate validated; production approval, fresh backup/preflight and existing-project build required before activation'}
(E/'validation.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False)+'\n');sys.exit(0 if summary['status']=='PASS' else 1)
