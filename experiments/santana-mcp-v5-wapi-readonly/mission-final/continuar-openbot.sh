python3 -I - <<'SANTANA_OPENBOT_METADATA'
import hashlib, os
p='/home/runner/santana-mcp-staging/openbot-inventory-6996a0320ac9/inventory.py'
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,'rb') as f: code=f.read(32769)
if len(code)>32768 or hashlib.sha256(code).hexdigest()!='6996a0320ac933fc204a736ea0406ee6193c041db122c8f402b6e5886410a6c3':
    raise SystemExit('PAREI: integridade divergente; nada executado.')
exec(compile(code,'santana_openbot_metadata','exec'),{'__name__':'__main__'})
SANTANA_OPENBOT_METADATA
