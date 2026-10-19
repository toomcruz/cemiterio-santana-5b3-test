"""Embed a one-field patch plus the already validated startup observer."""
import ast,hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parent
source=(R/'root-install-template.py').read_text();tree=ast.parse(source)
names={'command','property','process_env','process_ready','configuration_checks','require_configuration','safe_error','emit','get_health','catalog','await_catalog'}
parts=['import ast']
for node in tree.body:
    if isinstance(node,(ast.Import,ast.ImportFrom,ast.Assign)) or isinstance(node,ast.FunctionDef) and node.name in names:
        s=ast.get_source_segment(source,node)
        if isinstance(node,ast.FunctionDef) and node.name=='catalog':
            extra="    private=next((t for t in result.get('result',{}).get('tools',[]) if t['name']=='registrar_revisao_lote'),{})\n    if private.get('_meta',{}).get('ui')!={'visibility':['app']}:raise RuntimeError('PRIVATE_TOOL_DESCRIPTOR_NOT_PROVEN')\n"
            assert s.count('    return names')==1;s=s.replace('    return names',extra+'    return names')
        parts.append(s)
old=(R/'ui-fix-backup/mcp_extension.py').read_text();new=(R/'ui-hardening-backup/mcp_extension.py').read_text()
assert old.replace("t['_meta']['ui']['visibility']=['app']","t['_meta']['ui']={'visibility':['app']}")==new
old_sha=hashlib.sha256(old.encode()).hexdigest();new_sha=hashlib.sha256(new.encode()).hexdigest()
assert old_sha=='0fad711f210621281b5c39d57c71def4274e7ee6ea856c888e8d728d235f4160'
parts.append('OLD_SHA='+repr(old_sha)+'\nNEW_SHA='+repr(new_sha)+'\nPATCHED_CODE='+repr(new))
parts.append((R/'root-ui-fix-template.py').read_text())
code='\n\n'.join(parts)+'\n';ast.parse(code);(R/'fix-ui-metadata.py').write_text(code)
sha=hashlib.sha256(code.encode()).hexdigest()
manifest={'sha256':sha,'bytes':len(code.encode()),'old_extension_sha256':old_sha,'new_extension_sha256':new_sha,'only_unit':'santana-mcp-lab.service','only_field':'registrar_revisao_lote._meta.ui','real_sends':False}
(R/'ui-fix-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
path='/home/runner/santana-mcp-staging/batch-ui-fix-'+sha[:12]+'/fix-ui-metadata.py'
(R/'CORRIGIR-CATALOGO-LAB.txt').write_text("python3 -I - <<'SANTANA_UI'\nimport hashlib,os\np="+repr(path)+"\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\nwith os.fdopen(fd,'rb') as f: code=f.read(524289)\nif len(code)>524288 or hashlib.sha256(code).hexdigest()!="+repr(sha)+":\n    raise SystemExit('PAREI: integridade divergente; nada executado.')\nexec(compile(code,'santana_lab_ui_verificado','exec'),{'__name__':'__main__'})\nSANTANA_UI\n")
print(json.dumps(manifest))
