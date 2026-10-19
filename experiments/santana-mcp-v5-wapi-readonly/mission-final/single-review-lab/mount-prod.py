"""Pure, guarded source transform. Does not connect, deploy, mutate DB or send."""
from pathlib import Path
import hashlib,json
R=Path(__file__).resolve().parent
EXPECTED_PACKAGE='5c602e62ebacab97fb19d4c7454910f5f337a491fb3de84805fff684a787bcf9'
def mount(files,metadata):
    if metadata.get('version')!=43 or metadata.get('ezbr_sha256')!=EXPECTED_PACKAGE:raise ValueError('ACTIVE_PROD_VERSION_CHANGED')
    out=dict(files)
    for native,backup in [('mcp-official-operations.ts','prod-mcp-official-operations.ts'),('media-attachments.mjs','media-attachments.mjs')]:
        if out.get(native)!=(R/'baseline'/backup).read_text():raise ValueError('EXISTING_PROTECTION_CHANGED')
    recipe=json.loads((R/'candidate/prod-edge/mount.json').read_text());index=out['index.ts']
    if index.count(recipe['anchor'])!=1 or 'singleReviewOperation' in index:raise ValueError('ACTIVE_PROD_MOUNT_CHANGED')
    out['index.ts']=recipe['import']+index.replace(recipe['anchor'],recipe['insert_before']+recipe['anchor'])
    out['single-review-edge.ts']=(R/'candidate/prod-edge/single-review-edge.ts').read_text()
    assert len(out)==len(files)+1
    for k in files:
        if k!='index.ts':assert out[k]==files[k]
    return out
