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
