"""Use proven bounded helpers for one already installed HTML file."""
import ast,hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parent

def build():
    source=(R/'root-install-template.py').read_text();tree=ast.parse(source)
    functions={'command','property','process_env','configuration_checks','require_configuration','safe_error','emit','catalog'}
    parts=[]
    for n in tree.body:
        if isinstance(n,(ast.Import,ast.ImportFrom,ast.Assign)) or isinstance(n,ast.FunctionDef) and n.name in functions:parts.append(ast.get_source_segment(source,n))
    old=(R/'media-preview-backup.html').read_text();new=(R/'real-widget.html').read_text()
    needle="const u=URL.createObjectURL(new Blob([raw],{type:file.mime_type}));urls.push(u);el.src=u;"
    assert old.count(needle)==1 and old.replace(needle,"el.src='data:'+file.mime_type+';base64,'+file.content_base64;")==new
    assert hashlib.sha256(old.encode()).hexdigest()=='a6aefb8656d9fdd834b16ad4b3558c7c7d1f6a079cee2708b029ab1dfe00c2d9'
    for k,v in {'OLD_SHA':hashlib.sha256(old.encode()).hexdigest(),'NEW_SHA':hashlib.sha256(new.encode()).hexdigest(),'PATCHED_HTML':new,'ASSETS_SHA':hashlib.sha256((R/'review_assets.py').read_bytes()).hexdigest()}.items():parts.append(k+'='+repr(v))
    parts.append((R/'root-preview-fix-template.py').read_text());code='\n\n'.join(parts)+'\n';ast.parse(code)
    sha=hashlib.sha256(code.encode()).hexdigest()
    if len(code.encode())>524288:raise ValueError('PAYLOAD_TOO_LARGE')
    return code,{'sha256':sha,'bytes':len(code.encode()),'only_file':'real-widget.html','only_environment':'existing MCP LAB','services_restarted':0,'production_changes':0,'real_whatsapp_sends':0,'old_widget_sha256':hashlib.sha256(old.encode()).hexdigest(),'new_widget_sha256':hashlib.sha256(new.encode()).hexdigest()}
