"""Bounded read-only availability checks. Does not read secret values."""
import json, os, re, subprocess
from pathlib import Path

def run(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=8)
 return r.returncode,r.stdout
report={'uid':os.getuid(),'services':{},'paths':[],'sudo_available':False,'changes':0}
for unit in ('openbot.service','openbot-bridge.service','openbot-update-apply.service','openbot-update-request.service'):
 _,s=run(['systemctl','show',unit,'-p','ExecStart','-p','EnvironmentFiles','-p','User','-p','Group'])
 # Commands/arguments/environment values never leave the machine.
 report['services'][unit]={'executable_paths':re.findall(r'path=([^ ;}]+)',s),'envfile_paths':re.findall(r'EnvironmentFiles=([^ (\n]+)',s),'user':re.findall(r'^User=(.*)$',s,re.M)}
for path in ('/opt/openbot-bridge','/opt/openbot-bridge/server.py','/var/lib/openbot/.config/OpenBot','/var/lib/openbot/.config/OpenBot/automation','/opt/OpenBot','/opt/openbot','/opt/openbot-updater','/usr/local/sbin'):
 p=Path(path)
 try:
  st=p.stat();e={'path':path,'uid':st.st_uid,'mode':oct(st.st_mode&0o777),'readable':os.access(p,os.R_OK),'writable':os.access(p,os.W_OK)}
  if p.is_dir() and path in ('/usr/local/sbin','/opt/openbot-updater','/opt/openbot','/opt/OpenBot') and os.access(p,os.R_OK):
   e['candidate_names']=[q.name for q in list(p.iterdir())[:80] if re.search('openbot|bridge|sana|resources|app',q.name,re.I)]
  report['paths'].append(e)
 except OSError:report['paths'].append({'path':path,'accessible':False})
# Existing policy only. No privilege change or service action is requested.
code,s=run(['sudo','-n','-l'])
report['sudo_list_status']=code
report['sudo_rules']=[line.strip() for line in s.splitlines() if line.lstrip().startswith('(')][:20]
print(json.dumps(report))
