import json,unittest
import test_batch as base
from batch_send import Actor,Blocked
from real_review import RealReview,OWNER,OPERATOR

class RealReviewTests(unittest.TestCase):
    def setUp(self):
        self.base=base.BatchTests();self.base.setUp();self.addCleanup(self.base.doCleanups)
        self.e=self.base.engine;self.now=self.base.clock
        self.client=Actor(OWNER,'chatgpt-lab',OPERATOR,'private-lab-client','lab_client',self.now()+300,self.now())
        self.valid=True;self.proofs={}
        def transport(receipt,nonce,sha):
            p=self.proofs.get(receipt,{})
            return p if self.valid and p.get('nonce')==nonce and p.get('manifest_sha256')==sha else {'status':'not_available'}
        self.review=RealReview(self.e,transport);self.e.verify_session=self.review.session_active;self.e.review_guard=self.review.require_batch
    def prepare(self):
        return self.e.prepare(self.client,self.base.ids[:2],'Fictício','real-review-test')
    def proof(self,b):
        meta=self.review.metadata(self.client,b['batch_id'])
        self.proofs['receipt-1']={'status':'verified','receipt_id':'receipt-1','batch_id':b['batch_id'],'manifest_sha256':b['manifest_sha256'],'nonce':meta['challenge_nonce'],'subject':OWNER,'operator':OPERATOR,'session':'real-human-session','expires_at':self.now()+300,'auth_time':self.now(),'capability':'lab_fixture_simulation_only','production_write_authorized':False}
        return meta
    def test_real_proof_registers_one_review_and_allows_fixture_claim(self):
        b=self.prepare();self.proof(b);self.review.register(self.client,b['batch_id'],'receipt-1')
        self.assertEqual(self.e.step(self.client,b['batch_id'])['state'],'accepted_by_api')
    def test_claim_without_independent_receipt_is_denied(self):
        b=self.prepare()
        with self.assertRaisesRegex(Blocked,'REAL_REVIEW_REQUIRED'):self.e.step(self.client,b['batch_id'])
    def test_model_cannot_create_a_receipt(self):
        b=self.prepare();self.review.metadata(self.client,b['batch_id'])
        with self.assertRaisesRegex(Blocked,'NOT_VERIFIED'):self.review.register(self.client,b['batch_id'],'invented-receipt')
    def test_revoked_receipt_blocks_the_remaining_children(self):
        b=self.prepare();self.proof(b);self.review.register(self.client,b['batch_id'],'receipt-1');self.e.step(self.client,b['batch_id']);self.now.advance();self.valid=False
        with self.assertRaises(Blocked):self.e.step(self.client,b['batch_id'])
        self.assertEqual(len(self.base.channel.calls),1)
    def test_content_and_operator_changes_never_bind(self):
        for k,v in [('operator','other'),('manifest_sha256','a'*64),('production_write_authorized',True)]:
            b=self.prepare();self.proof(b);self.proofs['receipt-1'][k]=v
            with self.assertRaises(Blocked):self.review.register(self.client,b['batch_id'],'receipt-1')
    def test_metadata_has_no_jwt_password_or_real_message(self):
        b=self.prepare();meta=self.proof(b);s=json.dumps(meta)
        self.assertNotIn('access_token',s);self.assertNotIn('password',s)
        self.assertEqual(json.loads(meta['canonical_manifest'])['owner'],OWNER)

if __name__=='__main__':unittest.main()
