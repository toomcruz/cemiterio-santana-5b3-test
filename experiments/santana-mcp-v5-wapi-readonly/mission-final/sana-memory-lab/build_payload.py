from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parent
if (ROOT/'DEPLOYMENT-RETIRED.json').exists(): raise SystemExit('ROOT_PATCH_RETIRED: consulta STATUS.md; nada gerado ou alterado.')
patch={n:(ROOT/'bridge-patch'/n).read_text() for n in ('server.py','agent_messages.py','result_adapter.py')}
patch.update({'sana_memory_lab/'+n:(ROOT/'candidate'/n).read_text() for n in ('session_router.py','team_transport.py','reconciliation.py')})
preflight={n:(ROOT/'bridge-patch'/n).read_text() for n in ('server.py','agent_messages.py','result_adapter.py','events.py','task_queue.py')}
s=(ROOT/'root_template.py').read_text()+'\nPATCHES = '+repr(patch)+'\nPREFLIGHT = '+repr(preflight)+'''\nif __name__=='__main__':
 try:
  report=main()
 except BaseException as exc:
  report={'status':'STOPPED_NO_FURTHER_ACTION','reason':str(exc) if isinstance(exc,RuntimeError) and str(exc).replace('_','').isupper() else type(exc).__name__,'whatsapp_sends':0,'production_writes':0,'sana_activated':False}
 print(json.dumps(report,ensure_ascii=False,indent=2))
'''
(ROOT/'apply-lab.py').write_text(s)
h=hashlib.sha256(s.encode()).hexdigest();stage='/home/runner/santana-mcp-staging/sana-memory-'+h[:12]+'/apply-lab.py'
cmd="python3 -I - <<'SANA_MEMORY_LAB'\nimport hashlib,os\nfd=os.open("+repr(stage)+",os.O_RDONLY|os.O_NOFOLLOW)\nwith os.fdopen(fd,'rb') as f: code=f.read(524289)\nif len(code)>524288 or hashlib.sha256(code).hexdigest()!="+repr(h)+": raise SystemExit('PAREI: integridade divergente; nada executado.')\nexec(compile(code,'sana_memory_lab_verificado','exec'),{'__name__':'__main__'})\nSANA_MEMORY_LAB\n"
(ROOT/'APLICAR-LAB-ROOT.txt').write_text(cmd)
print(json.dumps({'sha256':h,'bytes':len(s.encode()),'stage':stage}))
