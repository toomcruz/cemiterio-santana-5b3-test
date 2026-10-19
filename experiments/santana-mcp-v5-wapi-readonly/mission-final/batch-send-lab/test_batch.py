import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parent
# Reuse the v5 audit store copied unchanged in the pre-change backup.
spec=importlib.util.spec_from_file_location('v5_audit',ROOT/'backup/audit_store.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
AuditStore=module.AuditStore
from batch_send import Actor,BatchController,Blocked,FixtureDirectory,SimulatedOfficialChannel,SOURCE
from mcp_extension import call,TOOLS

class Clock:
    def __init__(self):self.value=1792400000.
    def __call__(self):return self.value
    def advance(self,n=2):self.value+=n

class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=str(Path(self.temp.name)/'state/v5.sqlite');self.audit=AuditStore(self.path)
        self.addCleanup(self.audit._db.close)
        self.clock=Clock();self.directory=FixtureDirectory();self.channel=SimulatedOfficialChannel()
        self.revoked=set()
        self.verify=lambda a:a.session in {'oauth-existing','human-existing'} and a.session not in self.revoked
        self.engine=BatchController(self.audit,self.directory,self.channel,self.verify,now=self.clock)
        self.oauth=Actor('test-subject','chatgpt-lab','existing-operator','oauth-existing','oauth',self.clock()+3600,self.clock())
        self.human=Actor('test-subject','chatgpt-lab','existing-operator','human-existing','human',self.clock()+3600,self.clock())
        self.ids=list(self.directory.contacts)

    def prepare(self,n=1,**kw):
        return self.engine.prepare(self.oauth,self.ids[:n],kw.pop('text','Oi, teste fictício.'),kw.pop('key','operation-key-0001'),**kw)

    def approve(self,b):
        p=self.engine.review(self.human,b['batch_id'])
        return self.engine.approve(self.human,b['batch_id'],p['manifest_sha256'],p['csrf_nonce'],'approve_exact_synthetic_batch')

    def complete(self,b):
        for _ in range(b['total']+1):
            value=self.engine.step(self.oauth,b['batch_id'])
            if value['state']=='completed':break
            self.clock.advance()
        return self.engine.status(self.oauth,b['batch_id'])

    def test_single_suffix_resolution_and_one_review(self):
        c=self.directory.contacts[self.ids[0]];c['phone']='5511999905497'
        b=call(self.engine,self.oauth,'preparar_envio_simplificado',{'recipient':'final 5497','text':'Oi','idempotency_key':'single-test-5497'})
        self.assertEqual(b['preview'][0]['phone'],c['phone']);self.assertEqual(b['preview'][0]['text'],'Oi')
        with self.assertRaisesRegex(Blocked,'APPROVAL_REQUIRED'):self.engine.step(self.oauth,b['batch_id'])
        self.approve(b);s=self.complete(b)
        self.assertEqual(len(self.channel.calls),1);self.assertEqual(s['counts'],{'accepted_by_api':1})
        self.assertFalse(s['items'][0]['delivery_confirmed'])

    def test_batches_2_10_50_are_individual_rate_limited_and_audited(self):
        for n in (2,10,50):
            with self.subTest(n=n):
                self.setUp();b=self.prepare(n);self.approve(b);s=self.complete(b)
                self.assertEqual(s['total'],n);self.assertEqual(s['counts'],{'accepted_by_api':n})
                self.assertEqual(len({c['operation_id'] for c in self.channel.calls}),n)
                self.assertTrue(all(y['at']-x['at']>=2 for x,y in zip(self.channel.calls,self.channel.calls[1:])))
                self.assertEqual(self.audit._db.execute("SELECT count(*) FROM lab_batch_events WHERE event='settled'").fetchone()[0],n)

    def test_personalized_pending_contexts_remain_separate(self):
        ids=self.ids[:2];messages={cid:'Resposta à '+self.directory.contacts[cid]['messages'][0]['text'] for cid in ids}
        b=self.prepare(2,personalized=messages,text='');self.approve(b);self.complete(b)
        for c in self.channel.calls:self.assertEqual(c['payload']['text'],messages[c['payload']['conversation_id']])
        self.assertNotEqual(messages[ids[0]],messages[ids[1]])

    def test_image_and_pdf_bind_exact_bytes_name_mime_and_digest(self):
        for mime,name,raw in [('image/png','imagem.png',b'\x89PNG\r\n\x1a\n'+b'x'*30),('application/pdf','documento.pdf',b'%PDF-1.7\n'+b'x'*30)]:
            self.setUp();a={'mime_type':mime,'name':name,'content_base64':base64.b64encode(raw).decode()}
            b=self.prepare(2,attachment=a);p=self.engine.review(self.human,b['batch_id'])
            self.assertEqual(p['media'][b['preview'][0]['attachment']['sha256']]['content_base64'],a['content_base64']);self.assertNotIn('content_base64',b['preview'][0]['attachment'])
            self.approve(b);self.complete(b);self.assertEqual(self.channel.calls[0]['payload']['attachment']['name'],name)

    def test_no_approval_tool_is_model_callable(self):
        self.assertFalse(any('aprovar' in t['name'] or 'approve' in t['name'] for t in TOOLS))
        b=self.prepare()
        with self.assertRaises(Blocked):call(self.engine,self.oauth,'aprovar_lote',{'batch_id':b['batch_id']})

    def test_oauth_cannot_be_human_review(self):
        b=self.prepare()
        with self.assertRaisesRegex(Blocked,'INDIVIDUAL_SESSION'):self.engine.review(self.oauth,b['batch_id'])

    def test_identity_operator_and_agent_boundaries(self):
        b=self.prepare()
        for a in [Actor('other','chatgpt-lab','existing-operator','oauth-existing','oauth',self.clock()+60,self.clock()),Actor('test-subject','chatgpt-lab','other-operator','oauth-existing','oauth',self.clock()+60,self.clock()),Actor('test-subject','openbot','existing-operator','oauth-existing','oauth',self.clock()+60,self.clock())]:
            with self.assertRaises(Blocked):self.engine.status(a,b['batch_id'])

    def test_read_does_not_confer_write_scope(self):
        self.directory.contacts[self.ids[0]]['write']=False
        with self.assertRaisesRegex(Blocked,'NOT_AUTHORIZED'):self.prepare()

    def test_revocation_after_preparation_or_approval(self):
        b=self.prepare();self.approve(b);self.directory.contacts[self.ids[0]]['write']=False
        with self.assertRaisesRegex(Blocked,'PREFERENCE_CHANGED'):self.engine.step(self.oauth,b['batch_id'])
        self.assertEqual(self.channel.calls,[])

    def test_opt_out_and_missing_communication_authorization(self):
        for field,value in [('opted_out',True),('communication_allowed',False)]:
            self.setUp();self.directory.contacts[self.ids[0]][field]=value
            with self.assertRaisesRegex(Blocked,'PREFERENCE_CHANGED'):self.prepare()

    def test_unauthorized_number_is_not_registered_implicitly(self):
        with self.assertRaisesRegex(Blocked,'NOT_AUTHORIZED'):self.engine.prepare(self.oauth,['5511888888888'],'Oi','unknown-recipient')
        self.assertEqual(self.audit._db.execute('SELECT count(*) FROM lab_batches').fetchone()[0],0)

    def test_ambiguous_suffix_never_guesses(self):
        self.directory.contacts[self.ids[1]]['phone']='5522999900001'
        with self.assertRaisesRegex(Blocked,'AMBIGUOUS'):self.engine.prepare(self.oauth,['0001'],'Oi','ambiguous-number')

    def test_duplicate_target_aliases_blocked(self):
        with self.assertRaisesRegex(Blocked,'DUPLICATE_RECIPIENT'):self.engine.prepare(self.oauth,[self.ids[0],'0001'],'Oi','duplicate-alias')

    def test_idempotency_reuses_one_operation_and_conflicts_on_edit(self):
        a=self.prepare();b=self.prepare();self.assertEqual(a['batch_id'],b['batch_id'])
        with self.assertRaisesRegex(Blocked,'IDEMPOTENCY_CONFLICT'):self.prepare(text='Outra mensagem')
        self.assertEqual(self.audit._db.execute('SELECT count(*) FROM outbound_approvals').fetchone()[0],1)

    def test_global_dedup_across_batches_and_legacy_v5_ledger(self):
        a=self.prepare();b=self.prepare(key='different-idempotency')
        self.assertEqual(b['counts'],{'duplicate_blocked':1})
        self.approve(a);self.complete(a);self.clock.advance(100)
        c=self.prepare(key='after-ambiguous-window')
        self.assertEqual(c['counts'],{'duplicate_blocked':1})

    def test_concurrent_execute_makes_one_call(self):
        b=self.prepare();self.approve(b);results=[]
        def run():
            try:results.append(self.engine.step(self.oauth,b['batch_id']))
            except Blocked as e:results.append(str(e))
        threads=[threading.Thread(target=run) for _ in range(10)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(len(self.channel.calls),1)

    def test_revision_and_recent_inbound_invalidate_approval(self):
        for field,value in [('revision',2),('watermark','new-inbound')]:
            self.setUp();b=self.prepare();self.approve(b);self.directory.contacts[self.ids[0]][field]=value
            with self.assertRaisesRegex(Blocked,'CONTEXT_CHANGED'):self.engine.step(self.oauth,b['batch_id'])
            self.assertEqual(self.channel.calls,[])

    def test_recipient_mutation_cannot_redirect_approved_message(self):
        b=self.prepare();self.approve(b);self.directory.contacts[self.ids[0]]['phone']='5511888888888'
        with self.assertRaisesRegex(Blocked,'CONTEXT_CHANGED'):self.engine.step(self.oauth,b['batch_id'])

    def test_human_pause_busy_or_unknown_never_bypassed(self):
        for field,value in [('paused',False),('busy',True),('unknown',True)]:
            self.setUp();b=self.prepare();self.approve(b);self.directory.contacts[self.ids[0]][field]=value
            with self.assertRaisesRegex(Blocked,'COORDINATION'):self.engine.step(self.oauth,b['batch_id'])
            self.assertEqual(self.channel.calls,[])

    def test_failed_one_does_not_retry_or_hide_other_results(self):
        b=self.prepare(3);self.channel.outcomes[self.ids[1]]='rejected_by_api';self.approve(b);s=self.complete(b)
        self.assertEqual(s['counts'],{'accepted_by_api':2,'rejected_by_api':1})
        self.assertEqual([x['attempts'] for x in s['items']],[1,1,1])

    def test_unknown_pauses_lot_and_reconciliation_never_sends(self):
        b=self.prepare(3);self.channel.outcomes[self.ids[0]]='outcome_unknown';self.approve(b)
        result=self.engine.step(self.oauth,b['batch_id']);self.clock.advance()
        with self.assertRaisesRegex(Blocked,'RECONCILIATION'):self.engine.step(self.oauth,b['batch_id'])
        self.engine.reconcile(self.oauth,b['batch_id']);self.assertEqual(len(self.channel.calls),1)
        self.assertEqual(self.engine.status(self.oauth,b['batch_id'])['counts'],{'outcome_unknown':1,'approved':2})
        receipt=self.channel.results[result['operation_id']];receipt.update(state='accepted_by_api',provider_message_id='synthetic-authoritative-receipt')
        self.engine.reconcile(self.oauth,b['batch_id']);self.complete(b)
        self.assertEqual(len(self.channel.calls),3)

    def test_crash_after_claim_recovers_by_status_not_execute(self):
        b=self.prepare(2);self.approve(b);original=self.channel.execute
        class Crash(BaseException):pass
        def crash(*args):original(*args);raise Crash()
        self.channel.execute=crash
        with self.assertRaises(Crash):self.engine.step(self.oauth,b['batch_id'])
        self.channel.execute=original
        reopened=AuditStore(self.path);self.addCleanup(reopened._db.close)
        self.engine=BatchController(reopened,self.directory,self.channel,self.verify,now=self.clock)
        self.engine.reconcile(self.oauth,b['batch_id']);self.clock.advance();self.complete(b)
        self.assertEqual(len(self.channel.calls),2)

    def test_malformed_receipt_is_unknown_and_no_automatic_retry(self):
        b=self.prepare();self.approve(b);self.channel.execute=lambda *args:{'state':'accepted_by_api'}
        result=self.engine.step(self.oauth,b['batch_id']);self.assertEqual(result['state'],'outcome_unknown')
        with self.assertRaisesRegex(Blocked,'RECONCILIATION'):self.engine.step(self.oauth,b['batch_id'])

    def test_rate_limit_is_global_and_persistent(self):
        b=self.prepare();self.approve(b);self.engine.step(self.oauth,b['batch_id'])
        c=self.engine.prepare(self.oauth,[self.ids[1]],'Outro','other-global-clock');self.approve(c)
        new=BatchController(self.audit,self.directory,self.channel,self.verify,now=self.clock)
        self.assertEqual(new.step(self.oauth,c['batch_id'])['state'],'rate_limited')

    def test_review_expiration_nonce_session_hash_and_replay(self):
        b=self.prepare();p=self.engine.review(self.human,b['batch_id'])
        with self.assertRaisesRegex(Blocked,'REVIEW_CHANGED'):self.engine.approve(self.human,b['batch_id'],'a'*64,p['csrf_nonce'],'approve_exact_synthetic_batch')
        self.approve(b)
        with self.assertRaisesRegex(Blocked,'REVIEW_CHANGED'):
            self.engine.approve(self.human,b['batch_id'],b['manifest_sha256'],'forged-model-nonce','approve_exact_synthetic_batch')
        self.clock.advance(601)
        with self.assertRaises(Blocked):self.engine.step(self.oauth,b['batch_id'])

    def test_revoked_oauth_or_human_session_stops_dispatch(self):
        for session in ['oauth-existing','human-existing']:
            self.setUp();b=self.prepare();self.approve(b);self.revoked.add(session)
            with self.assertRaises(Blocked):self.engine.step(self.oauth,b['batch_id'])

    def test_rejects_more_than_50_and_personalization_outside_scope(self):
        with self.assertRaises(Blocked):self.engine.prepare(self.oauth,self.ids+[self.ids[0]],'Oi','too-many-recipients')
        with self.assertRaises(Blocked):self.prepare(personalized={self.ids[1]:'Não autorizado'})

    def test_does_not_accept_arbitrary_live_transport(self):
        with self.assertRaisesRegex(Blocked,'LAB_FIXTURE_ONLY'):BatchController(self.audit,self.directory,object(),self.verify)

    def test_all_tools_reject_actor_and_content_substitution(self):
        b=self.prepare()
        for extra in ({'actor':'admin'},{'text':'changed'},{'approved':True},{'manifest_sha256':'a'*64}):
            with self.assertRaises(Blocked):call(self.engine,self.oauth,'executar_lote_simulado',{'batch_id':b['batch_id'],**extra})

    def test_bad_attachment_or_cross_batch_nonce_never_authorizes(self):
        for attachment in [{'mime_type':'application/pdf','name':'x.pdf','content_base64':'YWFhYQ=='},{'mime_type':'image/png','name':'../x.png','content_base64':'A'*40}]:
            with self.assertRaisesRegex(Blocked,'INVALID_ATTACHMENT'):self.prepare(attachment=attachment)
        b=self.prepare();c=self.engine.prepare(self.oauth,[self.ids[1]],'Oi','another-batch-key')
        p=self.engine.review(self.human,b['batch_id'])
        with self.assertRaisesRegex(Blocked,'REVIEW_CHANGED'):self.engine.approve(self.human,c['batch_id'],c['manifest_sha256'],p['csrf_nonce'],'approve_exact_synthetic_batch')

    def test_manifest_edit_after_review_is_rejected(self):
        b=self.prepare();self.approve(b)
        row=self.audit._db.execute('SELECT manifest FROM lab_batches WHERE id=?',(b['batch_id'],)).fetchone()
        value=json.loads(row[0]);value['recipients'][0]['text']='Alteração posterior'
        self.audit._db.execute('UPDATE lab_batches SET manifest=? WHERE id=?',(json.dumps(value),b['batch_id']))
        with self.assertRaisesRegex(Blocked,'MANIFEST_INTEGRITY'):self.engine.step(self.oauth,b['batch_id'])
        self.assertEqual(self.channel.calls,[])

    def test_nonce_is_single_use_and_expired_review_cannot_authorize(self):
        b=self.prepare();p=self.engine.review(self.human,b['batch_id'])
        self.engine.approve(self.human,b['batch_id'],p['manifest_sha256'],p['csrf_nonce'],'approve_exact_synthetic_batch')
        with self.assertRaisesRegex(Blocked,'REVIEW_CHANGED'):self.engine.approve(self.human,b['batch_id'],p['manifest_sha256'],p['csrf_nonce'],'approve_exact_synthetic_batch')
        self.setUp();b=self.prepare();p=self.engine.review(self.human,b['batch_id']);self.clock.advance(301)
        with self.assertRaisesRegex(Blocked,'REVIEW_CHANGED'):self.engine.approve(self.human,b['batch_id'],p['manifest_sha256'],p['csrf_nonce'],'approve_exact_synthetic_batch')

    def test_legacy_tool_operation_is_seen_by_batch_global_dedup(self):
        import hashlib
        phone=self.directory.contacts[self.ids[0]]['phone'];payload={'text':'Mensagem legada fictícia'}
        value={'kind':'text','phone':phone,'payload':payload};fingerprint=hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        row,_=self.audit.prepare('openbot','text',phone,payload,fingerprint,fingerprint)
        self.audit._db.execute("UPDATE outbound_approvals SET state='outcome_unknown',created_at=0 WHERE approval_id=?",(row['approval_id'],))
        b=self.prepare(text=payload['text']);self.assertEqual(b['counts'],{'duplicate_blocked':1})

    def test_simultaneous_controllers_share_durable_claim(self):
        b=self.prepare();self.approve(b)
        other=AuditStore(self.path);self.addCleanup(other._db.close)
        engine=BatchController(other,self.directory,self.channel,self.verify,now=self.clock)
        errors=[]
        def run(e):
            try:e.step(self.oauth,b['batch_id'])
            except Blocked as error:errors.append(str(error))
        threads=[threading.Thread(target=run,args=(e,)) for e in (engine,self.engine)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(len(self.channel.calls),1)

if __name__=='__main__':unittest.main()
