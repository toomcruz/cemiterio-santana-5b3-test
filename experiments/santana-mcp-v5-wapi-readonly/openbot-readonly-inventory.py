"""Bounded runner inventory. Never emits configuration values or changes services."""
import json, os, re, shutil, stat, subprocess, sqlite3
from pathlib import Path

report = {'uid': os.getuid(), 'services': {}, 'configurations': [], 'real_messages_sent': 0, 'services_changed': 0}
for unit in ('openbot.service', 'openbot-tunnel.service', 'santana-mcp-lab.service', 'santana-mcp-lab-tunnel.service'):
    r = subprocess.run(['systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'MainPID', '-p', 'User', '-p', 'WorkingDirectory'], capture_output=True, text=True, timeout=5)
    report['services'][unit] = dict(line.split('=', 1) for line in r.stdout.splitlines() if '=' in line)
binary = shutil.which('openbot')
report['openbot_cli_found'] = bool(binary)
if binary:
    r = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=10)
    match = re.search(r'\b\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\b', r.stdout + r.stderr)
    report['openbot_version'] = match.group(0) if match else 'unavailable'

# Read only established configuration roots. Values, account names, endpoints,
# environment variables, prompts, chat history and session bodies are excluded.
roots = [Path('/var/lib/openbot/.config/OpenBot'), Path('/root/.openbot'), Path('/home/runner/.openbot'), Path('/home/openbot/.openbot')]
def key_paths(value, prefix='', depth=0):
    if depth > 7: return []
    out = []
    if isinstance(value, dict):
        for key, child in list(value.items())[:100]:
            if not isinstance(key, str): continue
            # Report schema names only; agent/server IDs may be dictionary keys.
            fixed = key if key.lower() in {'agents','list','defaults','mcp','mcpservers','servers','auth','token','identity','credentials','session','sessions','scope','scopes','permissions','env','command','args','url','transport','id','name','workspace','model','baseurl','channels','plugins','enabled','tools','allow','deny','profile','profiles','sessionkey'} else '*'
            path = prefix + '.' + fixed if prefix else fixed
            if re.search(r'agent|mcp|scope|permission|session|credential|identity', path, re.I): out.append(path)
            out.extend(key_paths(child,path,depth+1))
    elif isinstance(value,list):
        for child in value[:30]: out.extend(key_paths(child,prefix+'[]',depth+1))
    return sorted(set(out))[:100]
for root in roots:
    entry={'root':str(root),'accessible':os.access(root,os.R_OK|os.X_OK)}
    try:
        root.lstat()
        entry['exists']=True
    except PermissionError:entry['stat']='permission_denied'
    except FileNotFoundError:entry['exists']=False
    try:
        candidates=list(root.glob('*.json'))[:10]+list(root.glob('agents/*/agent/*.json'))[:20]
        entry['files']=[]
        for p in candidates:
            info=p.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size>1048576: continue
            item={'scope':'agent' if '/agents/' in str(p) else 'global','mode':oct(stat.S_IMODE(info.st_mode)),'owner_uid':info.st_uid}
            try:
                data=json.loads(p.read_text());item['schema_paths']=key_paths(data)
                item['readable']=True
            except (OSError,ValueError): item['readable']=False
            entry['files'].append(item)
        database=root/'openbot.db'
        if os.access(database,os.R_OK):
            connection=sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True,timeout=2)
            try:
                # Schema only: never read agent messages, sessions or secret values.
                tables=connection.execute("select name from sqlite_master where type='table' and (lower(name) like '%mcp%' or lower(name) like '%setting%' or lower(name) like '%agent%') limit 20").fetchall()
                entry['database_schema']=[{'table':name,'columns':[row[1] for row in connection.execute('pragma table_info('+json.dumps(name)+')').fetchall()]} for (name,) in tables]
            finally:connection.close()
    except OSError: entry['files']=[]
    report['configurations'].append(entry)
report['isolation_proven']=False
report['reason']='schema_inventory_does_not_prove_runtime_credential_isolation'
print(json.dumps(report,ensure_ascii=False,indent=2))
