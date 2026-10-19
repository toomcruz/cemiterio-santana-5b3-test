"""Additive LAB orchestration over the v5 audit ledger. No network/provider code.

Only FixtureDirectory + SimulatedOfficialChannel are accepted by this candidate.
Production must supply a reviewed, transactional official-channel integration;
turning an environment flag on cannot enable it here.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

REAL_DISPATCH_ENABLED = False
SOURCE = "isolated_synthetic_batch_lab"
TERMINAL = {"accepted_by_api", "rejected_by_api", "duplicate_blocked", "cancelled"}

def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def digest(value):
    return hashlib.sha256(packed(value).encode()).hexdigest()

class Blocked(ValueError):
    pass

@dataclass(frozen=True)
class Actor:
    subject: str
    client: str
    operator: str
    session: str
    kind: str
    expires_at: float
    auth_time: float

class FixtureDirectory:
    """Authoritative synthetic scope; callers cannot add recipients through tools."""
    environment = SOURCE
    def __init__(self, count=50):
        self.contacts = {}
        for n in range(1, count + 1):
            cid = str(uuid.UUID(int=n, version=4))
            self.contacts[cid] = dict(conversation_id=cid, name=f"Munícipe fictício {n:02d}",
                phone=f"551199990{n:04d}", revision=1, watermark=f"inbound-{n}-1",
                paused=True, busy=False, unknown=False, read=True, write=True,
                opted_out=False, communication_allowed=True,
                messages=[{"direction":"inbound", "text":f"Dúvida fictícia {n:02d}", "key":f"inbound-{n}-1"}])

    def authorized(self):
        return [v for v in self.contacts.values() if v["read"] and v["write"]]

    def resolve(self, selector):
        if not isinstance(selector, str) or not selector or len(selector)>80:
            raise Blocked("INVALID_RECIPIENT")
        exact = [c for c in self.authorized() if selector in (c["conversation_id"], c["phone"], "+"+c["phone"])]
        if exact:
            return exact[0]
        suffix = re.fullmatch(r"(?:final\s+)?([0-9]{4,13})", selector.strip(), re.I)
        matches = [c for c in self.authorized() if suffix and c["phone"].endswith(suffix[1])]
        if len(matches)!=1:
            raise Blocked("AMBIGUOUS_RECIPIENT" if matches else "RECIPIENT_NOT_AUTHORIZED")
        return matches[0]

class SimulatedOfficialChannel:
    """Implements the official operation/status boundary with synthetic receipts."""
    environment = SOURCE
    def __init__(self):
        self.calls = []
        self.results = {}
        self.outcomes = {}

    def execute(self, operation_id, payload, at):
        # Child operation_id is the existing channel's idempotency/action_id.
        if operation_id in self.results:
            return self.results[operation_id]
        self.calls.append({"operation_id":operation_id, "payload":payload, "at":at,
                           "action":"manual-whatsapp", "simulated":True})
        state = self.outcomes.get(payload["conversation_id"], "accepted_by_api")
        if state not in {"accepted_by_api", "rejected_by_api", "outcome_unknown"}:
            raise RuntimeError("SIMULATED_TRANSPORT_FAILURE")
        result = {"state":state, "operation_id":operation_id,
                  "provider_message_id":"synthetic-"+operation_id if state=="accepted_by_api" else None,
                  "simulated":True, "delivery_confirmed":False}
        self.results[operation_id] = result
        return result

    def status(self, operation_id):
        return self.results.get(operation_id)

class BatchController:
    def __init__(self, audit, directory, channel, verify_session, *, now=time.time, interval=2.0):
        if type(directory) is not FixtureDirectory or type(channel) is not SimulatedOfficialChannel:
            raise Blocked("LAB_FIXTURE_ONLY")
        if not 1<=interval<=60:
            raise Blocked("INVALID_RATE")
        self.audit, self.db, self.lock = audit, audit._db, audit._lock
        self.directory, self.channel = directory, channel
        self.verify_session, self.now, self.interval = verify_session, now, interval
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS lab_batches(
            id TEXT PRIMARY KEY,owner TEXT NOT NULL,client TEXT NOT NULL,operator TEXT NOT NULL,
            idempotency TEXT NOT NULL,request_hash TEXT NOT NULL,manifest TEXT NOT NULL,sha TEXT NOT NULL,
            expires REAL NOT NULL,state TEXT NOT NULL,review_session TEXT,
            UNIQUE(owner,client,idempotency));
          CREATE TABLE IF NOT EXISTS lab_batch_items(
            batch_id TEXT NOT NULL,pos INTEGER NOT NULL,operation_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
            receipt TEXT,PRIMARY KEY(batch_id,pos));
          CREATE TABLE IF NOT EXISTS lab_review_nonces(
            nonce_hash TEXT PRIMARY KEY,batch_id TEXT NOT NULL,session TEXT NOT NULL,
            sha TEXT NOT NULL,expires REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS lab_conversation_locks(
            conversation_id TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL);
          CREATE TABLE IF NOT EXISTS lab_batch_clock(id INTEGER PRIMARY KEY,next_at REAL NOT NULL);
          INSERT OR IGNORE INTO lab_batch_clock VALUES(1,0);
          CREATE TABLE IF NOT EXISTS lab_batch_events(
            seq INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,
            operation_id TEXT,event TEXT NOT NULL,detail TEXT NOT NULL,at REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS lab_batch_media(sha TEXT PRIMARY KEY,content_base64 TEXT NOT NULL);
        """)

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def actor(self, actor, kind="oauth"):
        if not isinstance(actor, Actor) or actor.kind!=kind or actor.expires_at<=self.now() or not self.verify_session(actor):
            raise Blocked("INDIVIDUAL_SESSION_REQUIRED")
        if actor.client!="chatgpt-lab" or not actor.subject or not actor.operator:
            raise Blocked("AGENT_SCOPE_DENIED")
        if kind=="human" and not self.now()-600<=actor.auth_time<=self.now()+30:
            raise Blocked("RECENT_INDEPENDENT_REVIEW_REQUIRED")

    def row(self, actor, batch_id):
        r=self.db.execute("SELECT * FROM lab_batches WHERE id=? AND owner=? AND client=? AND operator=?",
                          (batch_id,actor.subject,actor.client,actor.operator)).fetchone()
        if not r:
            raise Blocked("BATCH_NOT_AVAILABLE")
        row=dict(r)
        try:
            m=json.loads(row['manifest'])
            if not hmac.compare_digest(digest(m),row['sha']) or (m['owner'],m['client'],m['operator'],m['batch_id'])!=(actor.subject,actor.client,actor.operator,batch_id):
                raise ValueError()
        except (ValueError,KeyError,TypeError):
            raise Blocked('MANIFEST_INTEGRITY_FAILED') from None
        return row

    def event(self, batch, operation, event, detail=None):
        self.db.execute("INSERT INTO lab_batch_events(batch_id,operation_id,event,detail,at) VALUES(?,?,?,?,?)",
                        (batch,operation,event,packed(detail or {}),self.now()))

    def contact_current(self, p):
        c=self.directory.contacts.get(p["conversation_id"])
        if not c or not c["read"] or not c["write"] or c["opted_out"] or not c["communication_allowed"]:
            raise Blocked("RECIPIENT_SCOPE_OR_PREFERENCE_CHANGED")
        if (c["phone"],c["revision"],c["watermark"])!=(p["phone"],p["expected_revision"],p["watermark"]):
            raise Blocked("CONTEXT_CHANGED_REVIEW_REQUIRED")
        if not c["paused"] or c["busy"] or c["unknown"]:
            raise Blocked("OFFICIAL_COORDINATION_BLOCKED")
        return c

    @staticmethod
    def media(attachment):
        if attachment is None:
            return None
        if not isinstance(attachment,dict) or set(attachment)!={"name","mime_type","content_base64"}:
            raise Blocked("INVALID_ATTACHMENT")
        name,mime,raw=(attachment[k] for k in ("name","mime_type","content_base64"))
        if not isinstance(name,str) or not 1<=len(name)<=100 or re.search(r"[\x00-\x1f\x7f/\\]",name) or not isinstance(raw,str) or len(raw)>700000:
            raise Blocked("INVALID_ATTACHMENT")
        try:
            b=base64.b64decode(raw,validate=True)
        except Exception:
            raise Blocked("INVALID_ATTACHMENT") from None
        if not 16<=len(b)<=524288 or not (mime=="image/png" and b.startswith(b"\x89PNG\r\n\x1a\n") or mime=="image/jpeg" and b.startswith(b"\xff\xd8\xff") or mime=="application/pdf" and b.startswith(b"%PDF-")):
            raise Blocked("INVALID_ATTACHMENT")
        return {"name":name,"mime_type":mime,"content_base64":raw,"sha256":hashlib.sha256(b).hexdigest(),"size_bytes":len(b)}

    @staticmethod
    def legacy_payload(p):
        a=p["attachment"]
        if a is None:
            return "text", {"text":p["text"]}
        if a["mime_type"]=="application/pdf":
            return "document", {"content_base64":a["content_base64"],"extension":"pdf","file_name":a["name"],"caption":p["text"]}
        return "image", {"content_base64":a["content_base64"],"mime_type":a["mime_type"],"caption":p["text"]}

    def prepare(self, actor, targets, text, idempotency_key, attachment=None, *, personalized=None, purpose="service"):
        self.actor(actor)
        if not isinstance(targets,list) or not 1<=len(targets)<=50 or not isinstance(text,str) or len(text)>3000 or purpose not in {"service","approved_notice"}:
            raise Blocked("INVALID_BATCH")
        if not isinstance(idempotency_key,str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}",idempotency_key):
            raise Blocked("IDEMPOTENCY_KEY_REQUIRED")
        if personalized is not None and (not isinstance(personalized,dict) or any(k not in targets for k in personalized)):
            raise Blocked("PERSONALIZATION_SCOPE_DENIED")
        attachment=self.media(attachment)
        payloads=[]
        for target in targets:
            c=self.directory.resolve(target)
            body=personalized.get(target,text) if personalized is not None else text
            if not isinstance(body,str) or len(body)>(1000 if attachment else 3000) or (not body.strip() and attachment is None):
                raise Blocked("INVALID_MESSAGE")
            p={"conversation_id":c["conversation_id"],"name":c["name"],"phone":c["phone"],
               "text":body.strip(),"attachment":attachment,"expected_revision":c["revision"],
               "watermark":c["watermark"],"purpose":purpose}
            self.contact_current(p)
            payloads.append(p)
        if len({p["phone"] for p in payloads})!=len(payloads):
            raise Blocked("DUPLICATE_RECIPIENT_IN_BATCH")
        request_hash=digest(payloads)
        with self.transaction():
            previous=self.db.execute("SELECT * FROM lab_batches WHERE owner=? AND client=? AND idempotency=?",(actor.subject,actor.client,idempotency_key)).fetchone()
            if previous:
                if previous["operator"]!=actor.operator or previous["request_hash"]!=request_hash:
                    raise Blocked("IDEMPOTENCY_CONFLICT")
                batch_id=previous["id"]
            else:
                batch_id=str(uuid.uuid4()); now=self.now(); expires=now+600
                for pos,p in enumerate(payloads):
                    kind,payload=self.legacy_payload(p)
                    # EXACT v5 fingerprint: global across old tools, agents and lots.
                    raw=json.dumps({"kind":kind,"phone":p["phone"],"payload":payload},sort_keys=True,ensure_ascii=False,separators=(",", ":"))
                    fingerprint=hashlib.sha256(raw.encode()).hexdigest()
                    duplicate=self.db.execute("SELECT approval_id FROM outbound_approvals WHERE dedupe_key=? AND (state IN ('sending','outcome_unknown') OR state IN ('accepted_by_api','simulated') AND created_at>? OR state IN ('prepared','human_approved') AND expires_at>=?) LIMIT 1",(fingerprint,now-self.audit.dedupe_seconds,now)).fetchone()
                    operation=str(uuid.uuid4()); state="duplicate_blocked" if duplicate else "prepared"
                    p.update(operation_id=operation,dedupe_key=fingerprint,initial_state=state)
                    if attachment:
                        self.db.execute('INSERT OR IGNORE INTO lab_batch_media VALUES(?,?)',(attachment['sha256'],attachment['content_base64']))
                        p['attachment']={k:v for k,v in attachment.items() if k!='content_base64'}
                    if not duplicate:
                        self.db.execute("INSERT INTO outbound_approvals(approval_id,client,kind,phone,payload_json,payload_hash,dedupe_key,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',?,?,?)",(operation,actor.client,kind,p["phone"],packed(payload),fingerprint,fingerprint,now,expires,now))
                    self.db.execute("INSERT INTO lab_batch_items(batch_id,pos,operation_id,conversation_id,state) VALUES(?,?,?,?,?)",(batch_id,pos,operation,p["conversation_id"],state))
                manifest={"batch_id":batch_id,"owner":actor.subject,"client":actor.client,"operator":actor.operator,"expires_at":expires,"recipients":payloads}
                self.db.execute("INSERT INTO lab_batches VALUES(?,?,?,?,?,?,?,?,?,'prepared',NULL)",(batch_id,actor.subject,actor.client,actor.operator,idempotency_key,request_hash,packed(manifest),digest(manifest),expires))
                self.event(batch_id,None,"prepared",{"recipients":len(payloads)})
        return self.status(actor,batch_id)

    def status(self, actor, batch_id):
        self.actor(actor, actor.kind if isinstance(actor,Actor) else "oauth")
        with self.lock:
            row=self.row(actor,batch_id); manifest=json.loads(row["manifest"])
            items=[dict(x) for x in self.db.execute("SELECT * FROM lab_batch_items WHERE batch_id=? ORDER BY pos",(batch_id,))]
            counts={}
            for item in items:
                counts[item["state"]]=counts.get(item["state"],0)+1
                receipt=json.loads(item.pop("receipt")) if item["receipt"] else None
                item["receipt"]=receipt
                item["delivery_confirmed"]=False
                item["retry_allowed"]=False
            preview=[]
            for p in manifest["recipients"]:
                a=p["attachment"]
                preview.append({k:v for k,v in p.items() if k not in {"dedupe_key","initial_state","attachment"}}|{"attachment":({k:v for k,v in a.items() if k!="content_base64"} if a else None)})
            return {"source":SOURCE,"batch_id":batch_id,"manifest_sha256":row["sha"],"state":row["state"],"expires_at":row["expires"],
                    "preview":preview,"items":items,"counts":counts,"has_more":False,"total":len(items),
                    "real_dispatch_enabled":False,"human_review_required":True,"approval_url":"/lab/revisar-lote#"+batch_id}

    def review(self, human, batch_id):
        self.actor(human,"human")
        with self.transaction():
            row=self.row(human,batch_id)
            if row["expires"]<=self.now() or row["state"] not in {"prepared","approved","running"}:
                raise Blocked("REVIEW_NOT_AVAILABLE")
            for p in json.loads(row["manifest"])["recipients"]:
                self.contact_current(p)
            nonce=secrets.token_urlsafe(32)
            self.db.execute("INSERT INTO lab_review_nonces VALUES(?,?,?,?,?,0)",(digest(nonce),batch_id,human.session,row["sha"],min(row["expires"],self.now()+300)))
        value=self.status(human,batch_id)
        # Returned only on the protected same-origin route, NEVER as a tool result.
        value["csrf_nonce"]=nonce
        media={}
        with self.lock:
            for p in json.loads(row['manifest'])['recipients']:
                if p['attachment']:
                    a=self.hydrate_media(p['attachment']);media[a['sha256']]=a
        value["media"]=media
        return value

    def hydrate_media(self,attachment):
        row=self.db.execute('SELECT content_base64 FROM lab_batch_media WHERE sha=?',(attachment['sha256'],)).fetchone()
        if not row:
            raise Blocked('ATTACHMENT_INTEGRITY_FAILED')
        value=self.media({k:attachment[k] for k in ('name','mime_type')}|{'content_base64':row[0]})
        if any(value[k]!=attachment[k] for k in ('sha256','size_bytes','name','mime_type')):
            raise Blocked('ATTACHMENT_INTEGRITY_FAILED')
        return value

    def approve(self, human, batch_id, sha, nonce, explicit):
        self.actor(human,"human")
        if explicit!="approve_exact_synthetic_batch":
            raise Blocked("SPECIFIC_BATCH_APPROVAL_REQUIRED")
        with self.transaction():
            row=self.row(human,batch_id)
            n=self.db.execute("SELECT * FROM lab_review_nonces WHERE nonce_hash=?",(digest(nonce),)).fetchone()
            if not n or n["batch_id"]!=batch_id or n["session"]!=human.session or n["used"] or n["expires"]<=self.now() or not hmac.compare_digest(n["sha"],str(sha)) or not hmac.compare_digest(row["sha"],str(sha)) or row["expires"]<=self.now():
                raise Blocked("REVIEW_CHANGED_OR_EXPIRED")
            if row["state"]=="approved":
                return {"state":"approved","already_approved":True,"real_dispatch_enabled":False}
            if row["state"]!="prepared":
                raise Blocked("BATCH_ALREADY_STARTED")
            for p in json.loads(row["manifest"])["recipients"]:
                self.contact_current(p)
            self.db.execute("UPDATE lab_review_nonces SET used=1 WHERE nonce_hash=?",(digest(nonce),))
            self.db.execute("UPDATE lab_batches SET state='approved',review_session=? WHERE id=?",(human.session,batch_id))
            self.db.execute("UPDATE lab_batch_items SET state='approved' WHERE batch_id=? AND state='prepared'",(batch_id,))
            self.db.execute("UPDATE outbound_approvals SET state='human_approved',human_approved_by=?,human_approved_at=? WHERE approval_id IN (SELECT operation_id FROM lab_batch_items WHERE batch_id=? AND state='approved') AND state='prepared'",(human.operator,self.now(),batch_id))
            self.event(batch_id,None,"human_approved",{"manifest_sha256":sha,"operator":human.operator})
        return {"state":"approved","real_dispatch_enabled":False}

    def step(self, actor, batch_id):
        """One scheduled child at a time. Never sleeps, loops, retries or spawns workers."""
        self.actor(actor)
        operation=None
        with self.transaction():
            row=self.row(actor,batch_id)
            if row["state"] not in {"approved","running"} or row["expires"]<=self.now():
                raise Blocked("APPROVAL_REQUIRED_OR_EXPIRED")
            if not self.verify_session(Actor(actor.subject,actor.client,actor.operator,row["review_session"],"human",row["expires"],self.now())):
                raise Blocked("REVIEW_SESSION_REVOKED")
            if self.db.execute("SELECT 1 FROM lab_batch_items WHERE batch_id=? AND state IN ('sending','outcome_unknown')",(batch_id,)).fetchone():
                raise Blocked("BATCH_PAUSED_FOR_RECONCILIATION")
            item=self.db.execute("SELECT * FROM lab_batch_items WHERE batch_id=? AND state='approved' ORDER BY pos LIMIT 1",(batch_id,)).fetchone()
            if item is None:
                self.db.execute("UPDATE lab_batches SET state='completed' WHERE id=?",(batch_id,))
                return {"state":"completed","real_dispatch_enabled":False}
            due=self.db.execute("SELECT next_at FROM lab_batch_clock WHERE id=1").fetchone()[0]
            if due>self.now():
                return {"state":"rate_limited","next_at":due,"real_dispatch_enabled":False}
            p=json.loads(row["manifest"])["recipients"][item["pos"]]
            self.contact_current(p)
            if p['attachment']:
                p['attachment']=self.hydrate_media(p['attachment'])
            operation=item["operation_id"]
            if self.db.execute("SELECT 1 FROM lab_conversation_locks WHERE conversation_id=?",(p["conversation_id"],)).fetchone():
                raise Blocked("OFFICIAL_CONVERSATION_BUSY")
            # This emulates the existing official transaction, not a production lock.
            self.db.execute("INSERT INTO lab_conversation_locks VALUES(?,?)",(p["conversation_id"],operation))
            changed=self.db.execute("UPDATE outbound_approvals SET state='sending',updated_at=? WHERE approval_id=? AND state='human_approved'",(self.now(),operation)).rowcount
            if changed!=1:
                raise Blocked("GLOBAL_OPERATION_ALREADY_CLAIMED")
            self.db.execute("UPDATE lab_batch_items SET state='sending',attempts=attempts+1 WHERE batch_id=? AND operation_id=? AND state='approved'",(batch_id,operation))
            self.db.execute("UPDATE lab_batches SET state='running' WHERE id=?",(batch_id,))
            self.db.execute("UPDATE lab_batch_clock SET next_at=? WHERE id=1",(self.now()+self.interval,))
            self.event(batch_id,operation,"claimed")
        try:
            receipt=self.channel.execute(operation,p,self.now())
            if not isinstance(receipt,dict) or receipt.get("operation_id")!=operation or receipt.get("simulated") is not True or receipt.get("state") not in {"accepted_by_api","rejected_by_api","outcome_unknown"} or receipt.get("state")=="accepted_by_api" and not receipt.get("provider_message_id"):
                raise ValueError("INVALID_OFFICIAL_RECEIPT")
        except Exception:
            receipt={"state":"outcome_unknown","operation_id":operation,"simulated":True,"delivery_confirmed":False}
        receipt["delivery_confirmed"]=False
        with self.transaction():
            state=receipt["state"]
            self.db.execute("UPDATE lab_batch_items SET state=?,receipt=? WHERE batch_id=? AND operation_id=? AND state='sending'",(state,packed(receipt),batch_id,operation))
            self.db.execute("UPDATE outbound_approvals SET state=?,updated_at=?,outcome_json=?,provider_message_id=? WHERE approval_id=? AND state='sending'",(state,self.now(),packed(receipt),receipt.get("provider_message_id"),operation))
            if state!="outcome_unknown":
                self.db.execute("DELETE FROM lab_conversation_locks WHERE operation_id=?",(operation,))
            self.event(batch_id,operation,"settled",receipt)
        return {"state":state,"operation_id":operation,"simulated":True,"delivery_confirmed":False}

    def reconcile(self, actor, batch_id):
        """Authoritative read only; never invokes execute, never changes unknown to queued."""
        self.actor(actor)
        with self.transaction():
            self.row(actor,batch_id)
            rows=list(self.db.execute("SELECT * FROM lab_batch_items WHERE batch_id=? AND state IN ('sending','outcome_unknown')",(batch_id,)))
            for item in rows:
                receipt=self.channel.status(item["operation_id"])
                state=receipt.get("state") if isinstance(receipt,dict) else "outcome_unknown"
                if not receipt or receipt.get("operation_id")!=item["operation_id"] or receipt.get("simulated") is not True or state not in {"accepted_by_api","rejected_by_api"} or state=="accepted_by_api" and not receipt.get("provider_message_id"):
                    state="outcome_unknown"
                self.db.execute("UPDATE lab_batch_items SET state=?,receipt=? WHERE batch_id=? AND operation_id=?",(state,packed(receipt or {}),batch_id,item["operation_id"]))
                self.db.execute("UPDATE outbound_approvals SET state=?,updated_at=? WHERE approval_id=?",(state,self.now(),item["operation_id"]))
                if state!="outcome_unknown":
                    self.db.execute("DELETE FROM lab_conversation_locks WHERE operation_id=?",(item["operation_id"],))
                self.event(batch_id,item["operation_id"],"status_reconciled",{"state":state})
        return self.status(actor,batch_id)
