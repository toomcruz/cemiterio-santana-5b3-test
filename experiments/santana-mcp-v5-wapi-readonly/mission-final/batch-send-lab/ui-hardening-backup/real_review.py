"""Validate a narrowly scoped HOMOLOG review receipt; no Auth secret or JWT here."""
import json
import secrets
import time
from urllib.request import Request,build_opener,HTTPRedirectHandler
from batch_send import Actor,Blocked

HMG='https://xdccjulfqcqefykunwtg.supabase.co'
PUBLIC_KEY='sb_publishable_doiDzLKISweiTWKlFYFG6w_0PZjP1vw'
OWNER='3ddaa108-6106-45ed-82c5-7c2dad05dc32'
OPERATOR='8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def read_proof(receipt,nonce,sha):
    request=Request(HMG+'/rest/v1/rpc/sana_mcp_batch_lab_receipt_proof',method='POST',headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'},data=json.dumps({'p_receipt':receipt,'p_nonce':nonce,'p_sha':sha}).encode())
    with build_opener(NoRedirect()).open(request,timeout=12) as response:
        raw=response.read(6001)
        if response.status!=200 or len(raw)>6000:raise Blocked('LAB_REVIEW_UNAVAILABLE')
        return json.loads(raw)

class RealReview:
    def __init__(self,controller,transport=read_proof):
        self.controller=controller;self.transport=transport
        controller.db.execute('CREATE TABLE IF NOT EXISTS lab_real_reviews(batch_id TEXT PRIMARY KEY,nonce TEXT NOT NULL,receipt TEXT)')

    def metadata(self,actor,batch_id):
        e=self.controller
        with e.transaction():
            r=e.row(actor,batch_id)
            e.db.execute('INSERT OR IGNORE INTO lab_real_reviews VALUES(?,?,NULL)',(batch_id,secrets.token_urlsafe(32)))
            nonce=e.db.execute('SELECT nonce FROM lab_real_reviews WHERE batch_id=?',(batch_id,)).fetchone()[0]
            m=json.loads(r['manifest']);media={}
            for p in m['recipients']:
                if p['attachment']:media[p['attachment']['sha256']]=e.hydrate_media(p['attachment'])
            return {'canonical_manifest':r['manifest'],'manifest_sha256':r['sha'],'challenge_nonce':nonce,'media':media,'auth_origin':HMG,'public_key':PUBLIC_KEY}

    def proof(self,batch_id,receipt):
        e=self.controller
        with e.lock:
            b=e.db.execute('SELECT sha FROM lab_batches WHERE id=?',(batch_id,)).fetchone()
            row=e.db.execute('SELECT nonce FROM lab_real_reviews WHERE batch_id=?',(batch_id,)).fetchone()
        if not row or not b:raise Blocked('LAB_REVIEW_NOT_AVAILABLE')
        try:p=self.transport(receipt,row['nonce'],b['sha'])
        except Exception:raise Blocked('LAB_REVIEW_UNAVAILABLE') from None
        if p.get('status')!='verified' or p.get('receipt_id')!=receipt or p.get('batch_id')!=batch_id or p.get('manifest_sha256')!=b['sha'] or p.get('subject')!=OWNER or p.get('operator')!=OPERATOR or p.get('capability')!='lab_fixture_simulation_only' or p.get('production_write_authorized') is not False or p.get('expires_at',0)<=e.now():
            raise Blocked('LAB_REVIEW_NOT_VERIFIED')
        return p

    def register(self,actor,batch_id,receipt):
        e=self.controller;e.actor(actor);e.row(actor,batch_id)
        p=self.proof(batch_id,receipt)
        with e.transaction():e.db.execute('UPDATE lab_real_reviews SET receipt=? WHERE batch_id=?',(receipt,batch_id))
        human=Actor(p['subject'],actor.client,p['operator'],p['session'],'human',p['expires_at'],p['auth_time'])
        preview=e.review(human,batch_id)
        return e.approve(human,batch_id,preview['manifest_sha256'],preview['csrf_nonce'],'approve_exact_synthetic_batch')

    def session_active(self,actor):
        if actor.kind=='lab_client':return actor.subject==OWNER and actor.operator==OPERATOR
        if actor.kind!='human':return False
        e=self.controller
        with e.lock:
            rows=list(e.db.execute('SELECT batch_id,receipt FROM lab_real_reviews WHERE receipt IS NOT NULL'))
        for row in rows:
            try:
                p=self.proof(row['batch_id'],row['receipt'])
                if p['session']==actor.session and p['subject']==actor.subject and p['operator']==actor.operator:return True
            except Blocked:pass
        return False

    def require_batch(self,actor,batch_id):
        e=self.controller
        with e.lock:
            e.row(actor,batch_id)
            r=e.db.execute('SELECT receipt FROM lab_real_reviews WHERE batch_id=?',(batch_id,)).fetchone()
        if not r or not r['receipt']:raise Blocked('LAB_REAL_REVIEW_REQUIRED')
        return self.proof(batch_id,r['receipt'])
