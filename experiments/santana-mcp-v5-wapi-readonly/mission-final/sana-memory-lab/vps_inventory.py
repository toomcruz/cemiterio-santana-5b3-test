"""Read-only, bounded service/source inventory; never reads config values or histories."""
import ast, hashlib, json, os, re, subprocess
from pathlib import Path

def command(args):
 return subprocess.run(args,capture_output=True,text=True,timeout=8).stdout
units=set(['openbot.service','openbot-tunnel.service','santana-mcp-lab.service','santana-mcp-lab-tunnel.service'])
for line in command(['systemctl','list-units','--all','--type=service','--no-legend','--plain']).splitlines():
 name=line.split()[0] if line.split() else ''
 if re.search('openbot|boss|sana.*bridge',name):units.add(name)
report={'uid':os.getuid(),'services':{},'source_roots':[],'changes':0,'whatsapp_sends':0}
roots=set()
for unit in sorted(units):
 props=dict(line.split('=',1) for line in command(['systemctl','show',unit,'-p','MainPID','-p','User','-p','WorkingDirectory','-p','ExecStart','-p','FragmentPath','-p','ActiveState']).splitlines() if '=' in line)
 exe=props.pop('ExecStart','')
 paths=re.findall(r'(/[\w./-]+\.(?:py|js|mjs|asar))\b',exe)
 props['source_paths']=paths
 report['services'][unit]=props
 if props.get('WorkingDirectory','').startswith(('/opt/','/home/','/var/lib/')):roots.add(props['WorkingDirectory'])
 for path in paths:roots.add(str(Path(path).parent))
for root in sorted(roots):
 p=Path(root); entry={'path':root,'readable':os.access(p,os.R_OK|os.X_OK),'files':[]}
 if entry['readable']:
  count=0
  for base,dirs,files in os.walk(p):
   depth=len(Path(base).relative_to(p).parts)
   dirs[:]=[d for d in dirs if not d.startswith('.') and d not in ('node_modules','venv','__pycache__','logs','data','sessions') and depth<2]
   for name in files:
    q=Path(base)/name
    if q.suffix not in ('.py','.asar','.mjs','.js') or 'test' in name:continue
    count+=1
    if count>80:break
    item={'path':str(q),'readable':os.access(q,os.R_OK)}
    try:
     if q.stat().st_size>40000000:continue
     b=q.read_bytes();item['sha256']=hashlib.sha256(b).hexdigest();item['bytes']=len(b)
     if q.suffix=='.py' and len(b)<250000:
      tree=ast.parse(b)
      item['functions']=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
      item['markers']={k:k.encode() in b for k in ('RESULT_MISSING','agent-tasks','deliveryId','run_id','reconcile')}
    except (OSError,SyntaxError):item['readable']=False
    entry['files'].append(item)
   if count>80:break
 report['source_roots'].append(entry)
print(json.dumps(report,ensure_ascii=False))
