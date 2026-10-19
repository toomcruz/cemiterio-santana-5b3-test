"""Read-only, bounded LAB diagnostics. Never emits raw journals or environment."""
import json, os, re, stat, subprocess
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

UNIT='santana-mcp-lab.service'
def main():
    props=['ActiveState','SubState','MainPID','ExecMainStatus','ExecMainCode','NRestarts','Result','User','Group','ProtectSystem','ProtectHome','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','RootDirectory','MemoryMax','DropInPaths']
    p=subprocess.run(['systemctl','show',UNIT,*[a for v in props for a in ('-p',v)]],capture_output=True,text=True,timeout=10)
    out={'status':'LAB_READ_ONLY_DIAGNOSTIC','uid':os.getuid(),'properties':dict(s.split('=',1) for s in p.stdout.splitlines() if '=' in s),'real_messages_sent':0,'services_changed':0,'production_changes':0}
    try:
        with urlopen('http://127.0.0.1:8770/mcp',timeout=3) as r:out['loopback_get_status']=r.status
    except HTTPError as e:out['loopback_get_status']=e.code
    except (URLError,OSError):out['loopback_get_status']='unavailable'
    p=subprocess.run(['journalctl','-u',UNIT,'--since','2026-10-19 12:00:00 UTC','--no-pager','-n','100','-o','json'],capture_output=True,text=True,timeout=10)
    errors=[]
    for line in p.stdout.splitlines():
        try:m=json.loads(line).get('MESSAGE','')
        except (ValueError,AttributeError):continue
        if not isinstance(m,str):continue
        row={}
        ex=re.search(r'\b(ImportError|ModuleNotFoundError|PermissionError|TypeError|RuntimeError|AttributeError|OSError|OperationalError|ValueError|NameError)\b',m)
        if ex:row['exception_type']=ex[1]
        for pattern,key in [(r'\[Errno ([0-9]{1,4})\]','errno'),(r'(?:line |\.py:)([0-9]{1,5})','line')]:
            hit=re.search(pattern,m)
            if hit:row[key]=int(hit[1])
        if 'Address already in use' in m:row['reason']='ADDRESS_IN_USE'
        hit=re.search(r"No module named ['\"]([a-zA-Z0-9_.]{1,80})['\"]",m)
        if hit:row['missing_module']=hit[1]
        hit=re.search(r"cannot import name ['\"]([a-zA-Z0-9_]{1,80})['\"]",m)
        if hit:row['missing_symbol']=hit[1]
        if row:errors.append(row)
    out['journal']={'exit_code':p.returncode,'records_observed':len(p.stdout.splitlines()),'filtered_error_metadata':errors[-20:]}
    root=Path('/home/runner/santana-mcp-staging')
    reports=[]
    for f in sorted(root.glob('batch-lab-result-*.json'))[-3:]:
        info=f.lstat()
        if stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and info.st_size<32768:
            try:
                v=json.loads(f.read_text());reports.append({k:v[k] for k in ('status','phase','error_code','exception_type','whatsapp_sends','production_changes','lab_tunnel_pid_unchanged') if k in v})
            except (ValueError,OSError):pass
    out['root_reports']=reports
    print(json.dumps(out))
if __name__=='__main__':main()
