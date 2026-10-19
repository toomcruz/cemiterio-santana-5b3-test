"""Deterministic functional demos; all identities, contacts and receipts synthetic."""
import importlib.util
import json
from pathlib import Path
import tempfile
from batch_send import Actor,BatchController,FixtureDirectory,SimulatedOfficialChannel

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('v5_demo_audit',ROOT/'backup/audit_store.py')
audit_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit_module)

def demo():
    demos=[];contract_payloads=[]
    with tempfile.TemporaryDirectory(prefix='santana-batch-demo-') as td:
        for count in (1,2,10,50):
            now=[1792400000.];clock=lambda:now[0]
            audit=audit_module.AuditStore(str(Path(td)/str(count)/'audit.sqlite'))
            contacts=FixtureDirectory();channel=SimulatedOfficialChannel()
            engine=BatchController(audit,contacts,channel,lambda a:a.session in {'oauth-demo','human-demo'},now=clock)
            oauth=Actor('synthetic-existing-subject','chatgpt-lab','synthetic-existing-operator','oauth-demo','oauth',clock()+3600,clock())
            human=Actor(oauth.subject,oauth.client,oauth.operator,'human-demo','human',oauth.expires_at,clock())
            ids=list(contacts.contacts)[:count]
            personalized={cid:f"Olá, {contacts.contacts[cid]['name']}. Recebemos sua {contacts.contacts[cid]['messages'][0]['text'].lower()}. A equipe vai verificar as informações antes de confirmar o procedimento." for cid in ids}
            prepared=engine.prepare(oauth,ids,'','demo-operation-'+str(count),personalized=personalized)
            preview=engine.review(human,prepared['batch_id'])
            engine.approve(human,prepared['batch_id'],preview['manifest_sha256'],preview['csrf_nonce'],'approve_exact_synthetic_batch')
            for _ in range(count):
                engine.step(oauth,prepared['batch_id']);now[0]+=2
            engine.step(oauth,prepared['batch_id']);result=engine.status(oauth,prepared['batch_id'])
            demos.append({'recipients':count,'human_approvals':1,'individual_attempts':len(channel.calls),'counts':result['counts'],'distinct_operations':len({x['operation_id'] for x in channel.calls}),
              'minimum_spacing_seconds':min([b['at']-a['at'] for a,b in zip(channel.calls,channel.calls[1:])] or [0]),'all_results_tracked':len(result['items'])==count,
              'delivery_confirmed':False,'transport':'simulated_existing_official_contract','real_messages_sent':0})
            if count==50:contract_payloads=[x['payload'] for x in channel.calls]
            audit._db.close()
    return {'source':'isolated_synthetic_batch_lab','demos':demos,'contract_payloads':contract_payloads,'production_writes':0,'real_messages_sent':0}

if __name__=='__main__':print(json.dumps(demo(),ensure_ascii=False))
