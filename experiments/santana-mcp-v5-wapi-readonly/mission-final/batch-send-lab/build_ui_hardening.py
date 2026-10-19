"""Assemble the scoped LAB payload from audited source and an exact deps ZIP."""
import ast,base64,hashlib,json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
PATCH_NAMES=['mcp_extension.py','real_review.py','real-widget.html','review_assets.py','review_media.py','attachment_worker.py']
UNCHANGED=['batch_send.py','launcher.py','review.html','widget.html']

def build(dependency_path):
    dependency_path=Path(dependency_path)
    dependency_sha=hashlib.sha256(dependency_path.read_bytes()).hexdigest()
    source=(ROOT/'root-install-template.py').read_text();tree=ast.parse(source)
    functions={'command','property','process_env','process_ready','configuration_checks','require_configuration','safe_error','emit','get_health','catalog','await_catalog'}
    parts=['import ast']
    for node in tree.body:
        if isinstance(node,(ast.Import,ast.ImportFrom,ast.Assign)) or isinstance(node,ast.FunctionDef) and node.name in functions:
            parts.append(ast.get_source_segment(source,node))
    expected={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'ui-hardening-backup').iterdir() if p.is_file()}
    assert set(expected)=={'mcp_extension.py','real_review.py','real-widget.html'}
    patches={n:(ROOT/n).read_text() for n in PATCH_NAMES}
    pdf=json.loads((ROOT.parent/'supervised-send/media-fixtures/fixtures.json').read_text())['Santana-Teste-Documento.pdf']
    raw=base64.b64decode(pdf['content_base64'],validate=True)
    if len(raw)!=pdf['size_bytes'] or hashlib.sha256(raw).hexdigest()!=pdf['sha256']:raise ValueError('FIXTURE_INTEGRITY')
    values={'EXPECTED_FILES':expected,'PATCHES':patches,'UNCHANGED_FILES':UNCHANGED,'DEPENDENCY_PATH':str(dependency_path),
        'DEPENDENCY_SHA':dependency_sha,'FIXTURE_PDF':pdf['content_base64']}
    parts.extend(name+'='+repr(value) for name,value in values.items())
    parts.append((ROOT/'root-ui-hardening-template.py').read_text())
    code='\n\n'.join(parts)+'\n';ast.parse(code)
    sha=hashlib.sha256(code.encode()).hexdigest()
    if len(code.encode())>524288:raise RuntimeError('PAYLOAD_TOO_LARGE')
    manifest={'sha256':sha,'bytes':len(code.encode()),'dependency_sha256':dependency_sha,'expected_files':expected,
        'new_files':{n:hashlib.sha256(c.encode()).hexdigest() for n,c in patches.items()},'only_service':'santana-mcp-lab.service',
        'production_changes':0,'real_whatsapp_sends':0,'auth_grants_changed':False,'external_review_link':False}
    return code,manifest
