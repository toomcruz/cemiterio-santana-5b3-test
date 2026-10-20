"""Reproduce the exact deployed MCP files, then overlay only two approved files."""
import hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parent;BASE=R.parent
tree=json.loads((R/'private-backup/mcp-source-tree.json').read_text())
roots=[BASE/'mcp-deployment',BASE/'admin-assist/candidate/homolog-mcp',BASE/'admin-supervised-send/deployment-delta/mcp',R/'private-backup/mcp-original']
files=[];report=[];missing=[]
def walk(nodes,prefix=''):
 for n in nodes:
  p=prefix+n['name']
  if n['type']=='directory':yield from walk(n.get('children',[]),p+'/')
  elif n['type']=='file':yield p,n['uid']
source=next(n for n in tree if n['name']=='src')
for name,uid in walk(source['children']):
 matches=[]
 for root in roots:
  p=root/name
  if p.is_file():
   b=p.read_bytes()
   for content in [b,b[:-1] if b.endswith(b'\n') else b]:
    if hashlib.sha1(content).hexdigest()==uid:matches.append((content,p))
 if not matches:missing.append({'file':name,'uid':uid});continue
 b,p=matches[0];files.append({'file':name,'data':b.decode()});report.append({'file':name,'source_uid_sha1':uid,'source_sha256':hashlib.sha256(b).hexdigest(),'matched':True})
if missing:
 print(json.dumps({'status':'BASELINE_FILES_UNAVAILABLE','missing':missing}));raise SystemExit(1)
for dest,source in [('whatsapp-santana-mcp/server.py','mcp/server.py'),('whatsapp-santana-mcp/panel_review_provider.py','mcp/panel_review_provider.py')]:
 files=[f for f in files if f['file']!=dest];files.append({'file':dest,'data':(R/'candidate'/source).read_text()})
(R/'private-backup/mcp-deployment-files.json').write_text(json.dumps(files))
(R/'evidence/mcp-source-preflight.json').write_text(json.dumps({'status':'PASS','baseline_files':len(report),'unchanged_sources_verified':report,'changed_files':['whatsapp-santana-mcp/server.py'],'added_files':['whatsapp-santana-mcp/panel_review_provider.py']},indent=2)+'\n')
print(json.dumps({'status':'PASS','exact_baseline_files':len(report),'deployment_files':len(files)}))
