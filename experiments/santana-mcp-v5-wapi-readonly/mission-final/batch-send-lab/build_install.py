import ast,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
names=['batch_send.py','mcp_extension.py','real_review.py','launcher.py','review.html','widget.html','real-widget.html','review_assets.py','review_media.py','attachment_worker.py']
files={n:(ROOT/n).read_text() for n in names}
code='FILES = '+repr(files)+'\n'+(ROOT/'root-install-template.py').read_text()
ast.parse(code);out=ROOT/'install-lab.py';out.write_text(code)
digest=hashlib.sha256(code.encode()).hexdigest()
(ROOT/'install-manifest.json').write_text(json.dumps({'sha256':digest,'bytes':len(code.encode()),'server_sha256':'4c2b376f9850d0249e5d849c708ffac523c9d808baeaf78351fd75fb4267260b','files':{n:hashlib.sha256(v.encode()).hexdigest() for n,v in files.items()},'only_unit':'santana-mcp-lab.service','root_required':True,'real_sends':False},indent=2)+'\n')
print(json.dumps({'payload_sha256':digest,'bytes':len(code.encode())}))
