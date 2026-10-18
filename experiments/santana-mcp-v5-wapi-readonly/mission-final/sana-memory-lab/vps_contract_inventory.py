"""Read installed public application code only; no credentials/config/history."""
import hashlib,json,struct,time
from pathlib import Path
NEEDLES=('agent-tasks-v1','/v1/agent-tasks/start','/v1/agent-tasks/send','/v1/agent-tasks/read','/deliveries/')
report={'files':[],'changes':0,'private_config_reads':0}
def describe(name,b,full=True):
 return {'path':name,'bytes_scanned':len(b),'complete':full,'sha256':hashlib.sha256(b).hexdigest(),'markers':{s:s.encode() in b for s in NEEDLES}}
for p in (Path('/opt/OpenBot/app/resources/app.asar'),Path('/opt/OpenBot/hosted/openbot-hosted-server')):
 if not p.is_file():continue
 if p.suffix=='.asar':
  try:
   with p.open('rb') as f:
    lead=f.read(8);size=struct.unpack('<II',lead)[1]
    if size>16000000:raise ValueError('bounded header')
    buf=f.read(size);n=struct.unpack('<II',buf[:8])[1]
    data=json.loads(buf[8:8+n]);offset=8+size
    def walk(node,prefix=''):
     for name,entry in node.get('files',{}).items():
      full=prefix+'/'+name
      if 'files' in entry:yield from walk(entry,full)
      elif not entry.get('unpacked') and 'offset' in entry:yield full,entry
    selected=[]
    for name,entry in walk(data):
     if name=='/package.json' or (name.endswith(('.js','.cjs','.mjs')) and 'node_modules' not in name and any(s in name.lower() for s in ('main','backend','hosted'))):selected.append((name,entry))
    for name,entry in selected[:12]:
     if int(entry['size'])>32000000:continue
     f.seek(offset+int(entry['offset']));b=f.read(int(entry['size']))
     item=describe(str(p)+':'+name,b)
     if name=='/package.json':
      package=json.loads(b);item.update(name=package.get('name'),version=package.get('version'))
     report['files'].append(item)
  except (ValueError,OSError,struct.error):report['files'].append({'path':str(p),'error':'ASAR_METADATA_UNAVAILABLE'})
 else:
  try:
   # Read-only bounded prefix; no executable is launched.
   with p.open('rb') as f:b=f.read(32000000)
   report['files'].append(describe(str(p),b,p.stat().st_size<=len(b)))
  except OSError:report['files'].append({'path':str(p),'readable':False})
print(json.dumps(report))
# The hosted service may run another public source tree than the desktop ASAR.
import os,re,subprocess
pid=subprocess.run(['systemctl','show','openbot.service','-p','MainPID','--value'],capture_output=True,text=True,timeout=5).stdout.strip()
parents={}
for line in subprocess.run(['ps','-eo','pid=,ppid='],capture_output=True,text=True,timeout=5).stdout.splitlines():
 try:a,b=map(int,line.split());parents.setdefault(b,[]).append(a)
 except ValueError:pass
queue=[int(pid)] if pid.isdigit() and pid!='0' else [];seen=set();entries=[]
while queue and len(seen)<20:
 current=queue.pop(0)
 if current in seen:continue
 seen.add(current);queue+=parents.get(current,[])
 try:
  for value in Path('/proc',str(current),'cmdline').read_bytes().split(b'\0'):
   path=value.decode(errors='ignore')
   if path.startswith('/opt/') and re.fullmatch(r'/[A-Za-z0-9_./-]+\.(?:js|mjs|cjs)',path):entries.append(path)
 except OSError:pass
for name in sorted(set(entries))[:4]:
 p=Path(name)
 try:
  with p.open('rb') as f:b=f.read(32000000)
  report['files'].append(describe(name,b,p.stat().st_size<=len(b)))
  for ancestor in list(p.parents)[:4]:
   package=ancestor/'package.json'
   if package.is_file():
    data=json.loads(package.read_text());report['files'].append({'path':str(package),'name':data.get('name'),'version':data.get('version')});break
 except (ValueError,OSError):pass
print('RUNTIME_CONTRACT '+json.dumps({'runtime_entry_files':entries,'files':report['files'],'changes':0,'private_config_reads':0}))
