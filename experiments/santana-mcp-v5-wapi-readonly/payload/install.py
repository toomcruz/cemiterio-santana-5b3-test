#!/usr/bin/env python3
"""Update only the existing localhost:8770 LAB code. No configuration/service creation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
from urllib.request import Request
from secure_http import urlopen

UNIT_RE=re.compile(r'santana-mcp[-a-z0-9]*\.service\Z')
PROTECTED=('openbot-tunnel.service','santana-mcp-lab-tunnel.service','docker.service')


def command(args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=20)
    if p.returncode:
        raise RuntimeError('Falha na operação local: '+args[0])
    return p.stdout.strip()


def check_unit(unit):
    if not UNIT_RE.fullmatch(unit) or 'tunnel' in unit:
        raise RuntimeError('A unidade não corresponde exclusivamente ao MCP LAB.')


def state(unit):
    p=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],capture_output=True,text=True,timeout=10)
    return p.stdout.strip()


def discover():
    # The known tunnel target is preserved; no PID from past chat messages is trusted.
    out=command(['ss','-H','-ltnp','sport = :8770'])
    if len(out.splitlines())!=1 or '127.0.0.1:8770' not in out:
        raise RuntimeError('LAB exclusivo em 127.0.0.1:8770 não foi identificado; nada alterado.')
    ids=re.findall(r'pid=(\d+)',out)
    if len(set(ids))!=1:
        raise RuntimeError('Não foi possível identificar o processo LAB com segurança.')
    pid=int(ids[0]); proc=Path('/proc')/str(pid)
    env=dict(x.split('=',1) for x in proc.joinpath('environ').read_bytes().decode().split('\0') if '=' in x)
    if env.get('SANTANA_DATA_SOURCE')!='fixture' or env.get('MCP_PORT')!='8770':
        raise RuntimeError('O alvo não é o LAB fixture esperado; nada alterado.')
    if env.get('SANTANA_SEND_MODE','disabled')!='disabled' or env.get('SANTANA_SEND_ENABLED','false').lower()!='false':
        raise RuntimeError('O processo não confirma envio desativado; nada alterado.')
    if env.get('SANTANA_AUDIT_DB')==':memory:':
        raise RuntimeError('O LAB não usa ledger persistente; não será substituído automaticamente.')
    cgroup=proc.joinpath('cgroup').read_text()
    matches=re.findall(r'/([^/\n]+\.service)(?:/|$)',cgroup)
    if len(set(matches))!=1:
        raise RuntimeError('O processo não pertence a uma única unidade persistente do MCP.')
    unit=matches[0];check_unit(unit)
    if command(['systemctl','show',unit,'-p','MainPID','--value'])!=str(pid):
        raise RuntimeError('A unidade não confirma o PID do servidor; nada alterado.')
    root=proc.joinpath('cwd').resolve(strict=True)
    args=proc.joinpath('cmdline').read_bytes().split(b'\0')
    if not any(Path(a.decode(errors='replace')).name=='server.py' for a in args if a):
        raise RuntimeError('O processo não executa o server.py v5 esperado.')
    scripts=[Path(a.decode(errors='replace')) for a in args if a and Path(a.decode(errors='replace')).name=='server.py']
    if len(scripts)!=1 or (scripts[0] if scripts[0].is_absolute() else root/scripts[0]).resolve()!=root/'server.py':
        raise RuntimeError('O arquivo de entrada não corresponde ao diretório do LAB.')
    if not root.is_dir() or (root/'server.py').is_symlink() or not (root/'server.py').is_file():
        raise RuntimeError('Diretório de código não é seguro.')
    if not env.get('CHATGPT_READ_TOKEN'):
        raise RuntimeError('Credencial local do ChatGPT não encontrada; não será substituída.')
    return {'unit':unit,'root':root,'env':env,'pid':pid}


def health(env):
    def rpc(method,params):
        body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode()
        req=Request('http://127.0.0.1:8770/mcp',data=body,headers={
            'Authorization':'Bearer '+env['CHATGPT_READ_TOKEN'], 'Content-Type':'application/json',
            'Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'})
        with urlopen(req,timeout=5) as response:
            value=json.load(response)
        if 'result' not in value:raise RuntimeError('Handshake MCP local negado.')
        return value['result']
    rpc('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'santana-install','version':'5.0'}})
    tools=rpc('tools/list',{}).get('tools',[])
    names=sorted(x['name'] for x in tools)
    if any(x.startswith('whatsapp_send_') for x in names):
        raise RuntimeError('A credencial de leitura anunciou ferramenta de envio.')
    data=rpc('tools/call',{'name':'listar_conversas','arguments':{'per_page':1,'page':1}})
    payload=data.get('structuredContent') or json.loads(data['content'][0]['text'])
    if payload.get('source')!='fixture':
        raise RuntimeError('O teste deixou de confirmar a fonte fixture.')
    return {'initialize':'PASS','tools_list':names,'fixture_read':'PASS','source':'fixture'}


def verify_manifest(root):
    entries=json.loads((root/'MANIFEST.json').read_text())['files']
    for relative,digest in entries.items():
        p=Path(relative)
        if p.is_absolute() or '..' in p.parts or not p.parts:
            raise RuntimeError('Caminho inseguro no manifesto.')
        path=root/p
        if any((root/Path(*p.parts[:i])).is_symlink() for i in range(1,len(p.parts)+1)) or not path.is_file():
            raise RuntimeError('Arquivo inseguro no pacote.')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Hash divergente no pacote: '+relative)
    return entries


def atomic_copy(src,dst):
    if dst.is_symlink() or (dst.exists() and not dst.is_file()):
        raise RuntimeError('Recusada substituição de symlink/diretório.')
    for parent in dst.parents:
        if parent.is_symlink():raise RuntimeError('Diretório symlink recusado.')
    dst.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='.santana-update-',dir=dst.parent)
    os.close(fd)
    try:
        shutil.copyfile(src,tmp);os.chmod(tmp,0o644)
        if dst.exists():os.chown(tmp,dst.stat().st_uid,dst.stat().st_gid)
        else:os.chown(tmp,dst.parent.stat().st_uid,dst.parent.stat().st_gid)
        os.replace(tmp,dst)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def stage_transaction(source,target,backup,entries):
    backup.mkdir(parents=True,exist_ok=False,mode=0o700)
    changes=[]
    # Only Python modules and tests are installed. No env, unit, tunnel or database is replaced.
    for rel in sorted(entries):
        p=Path(rel)
        if not (len(p.parts)==1 and p.suffix=='.py' or p.parts[0]=='tests' and p.suffix in ('.py','.mjs')):
            continue
        dst=target/p
        if dst.is_symlink() or any(parent.is_symlink() for parent in dst.parents):
            raise RuntimeError('Destino symlink recusado.')
        existed=dst.exists()
        if existed and not dst.is_file():raise RuntimeError('Destino de código não é arquivo regular.')
        oldhash=hashlib.sha256(dst.read_bytes()).hexdigest() if existed else None
        if existed:
            saved=backup/'files'/p;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dst,saved)
        changes.append({'path':rel,'existed':existed,'old_sha256':oldhash,'new_sha256':entries[rel]})
    return changes


def apply_transaction(source,target,changes,fail_after=None):
    for i,item in enumerate(changes):
        atomic_copy(source/item['path'],target/item['path'])
        if fail_after is not None and i==fail_after:raise RuntimeError('Injected installation failure')


def select_install_entries(source, entries):
    selected=json.loads((source/'MANIFEST.json').read_text()).get('install_files')
    if selected is None:return entries
    if (not isinstance(selected,list) or not selected or any(not isinstance(x,str) for x in selected)
        or len(set(selected))!=len(selected) or not set(selected)<=set(entries)):
        raise RuntimeError('Lista incremental de arquivos inválida; nada alterado.')
    for rel in selected:
        p=Path(rel)
        if not (len(p.parts)==1 and p.suffix=='.py' or p.parts[0]=='tests' and p.suffix in ('.py','.mjs')):
            raise RuntimeError('O patch incremental só pode substituir módulos e testes.')
    return {rel:entries[rel] for rel in selected}


def restore_transaction(target,backup,changes):
    for item in reversed(changes):
        dst=target/item['path']
        if item['existed']:atomic_copy(backup/'files'/item['path'],dst)
        elif dst.exists():dst.unlink()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true')
    a=parser.parse_args(); source=Path(__file__).resolve().parent
    entries=select_install_entries(source,verify_manifest(source))
    try:os.nice(10)
    except OSError:pass
    from run_tests import run
    output=source/'test-results-vps'
    results=run(output)
    if results['status']!='PASS':raise RuntimeError('Testes falharam; o LAB não foi alterado.')
    if os.geteuid()!=0:raise RuntimeError('A atualização controlada exige o terminal root da VPS; nenhum serviço foi alterado.')
    target=discover(); before=health(target['env'])
    if source==target['root'] or source.is_relative_to(target['root']):raise RuntimeError('Extraia o pacote fora do servidor ativo.')
    if shutil.disk_usage(target['root']).free<256*1024*1024:raise RuntimeError('Espaço insuficiente para backup seguro; nada alterado.')
    if not a.apply:
        print(json.dumps({'status':'READY_TO_APPLY','unit':target['unit'],'test_results':str(output),'current':before},ensure_ascii=False,indent=2));return
    protected_before={u:state(u) for u in PROTECTED}
    backup=Path('/root/santana-mcp-backups')/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+str(os.getpid()))
    changes=stage_transaction(source,target['root'],backup,entries)
    unit=target['unit'];plan={'unit':unit,'target':str(target['root']),'files':changes,'ledger_policy':'NEVER_RESTORE_OR_DELETE'}
    (backup/'plan.json').write_text(json.dumps(plan,indent=2));os.chmod(backup/'plan.json',0o600)
    # Unit configuration is never changed here; do not copy inline credentials.
    (backup/'unit-policy.json').write_text(json.dumps({'unit':unit,'configuration_changed':False}))
    os.chmod(backup/'unit-policy.json',0o600)
    command(['systemctl','stop',unit])
    try:
        audit=Path(target['env'].get('SANTANA_AUDIT_DB','./state/whatsapp_santana_mcp.sqlite3'))
        if not audit.is_absolute():audit=target['root']/audit
        if audit.exists() and not audit.is_symlink():
            db=sqlite3.connect('file:'+str(audit)+'?mode=ro',uri=True)
            dest=sqlite3.connect(backup/'audit-forensic-only.sqlite3');db.backup(dest);dest.close();db.close()
            os.chmod(backup/'audit-forensic-only.sqlite3',0o600)
        apply_transaction(source,target['root'],changes)
        command(['systemctl','start',unit])
        verified=None
        for _ in range(10):
            try:verified=health(target['env']);break
            except Exception:time.sleep(.5)
        if verified is None:raise RuntimeError('Validação após atualização falhou.')
        protected_after={u:state(u) for u in PROTECTED}
        if protected_after!=protected_before:raise RuntimeError('Mudança concorrente detectada em serviço preservado.')
        pid=command(['systemctl','show',unit,'-p','MainPID','--value'])
        resource=command(['ps','-p',pid,'-o','pcpu=,rss=']).split()
        report={'status':'LAB_UPDATED','unit':unit,'backup':str(backup),'checks':verified,
                'source':'fixture','real_send_enabled':False,'real_wapi_proven':False,
                'unchanged_services':list(PROTECTED),'rss_kib':resource[-1] if resource else None,
                'cpu_percent_observation':resource[0] if resource else None,'tests':results}
    except Exception:
        subprocess.run(['systemctl','stop',unit],capture_output=True,timeout=20)
        restore_transaction(target['root'],backup,changes)
        subprocess.run(['systemctl','start',unit],capture_output=True,timeout=20)
        raise RuntimeError('Atualização revertida. Ledger e serviços preservados; consulte o relatório de testes.') from None
    (backup/'install-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    shutil.copyfile(backup/'install-report.json',output/'install-report.json')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('PAREI: '+str(exc));raise SystemExit(1)
