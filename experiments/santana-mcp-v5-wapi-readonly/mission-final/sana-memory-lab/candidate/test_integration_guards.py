import tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from session_router import SessionRouter, ReconciliationRequired, IsolationGuard
from team_transport import TeamTaskTransport, Observation
from result_adapter import official_delivery_result, official_agent_delivery_result

class MemberClient:
    auth_kind='team_member';authenticated=True;member_id='member-lab'
    capabilities={'agent-tasks-v1'};allowed_lab_agent_ids={'sana-lab'}
    def __init__(self):self.calls=[];self.closed=False;self.answer='ok';self.state='completed';self.delivery='delivery-1';self.other=False;self.inputs=[]
    def request(self,method,path,body):
        self.calls.append((method,path,body))
        task={'id':'task-1','agentId':'sana-lab','threadId':'thread-1','state':'idle','outcome':'completed','activeTurnId':None,'queuedMessages':[]}
        if path.endswith('/start'):
            self.inputs=[body['text']];return task
        if path.endswith('/send'):
            self.inputs.append(body['text'])
            return {'messageId':'message-2','deliveries':[{'id':'delivery-2','recipientAgentId':'sana-lab','status':'queued','position':None}]}
        if path.endswith('/list'):return {'agentId':'sana-lab','tasks':[task]}
        if path.endswith('/read'):
            return {'agentId':'sana-lab','threadId':'other' if self.other else 'thread-1','activeTurnId':None,'messages':[{'id':'message-1','author':'user','senderMember':{'id':'member-lab'},'text':self.inputs[-1],'delivery':{'id':self.delivery},'turnId':'turn-1'}, {'id':'answer-1','author':'assistant','turnId':'turn-1','status':'completed','text':self.answer,'itemType':'message'}]}
        if path.endswith('/close'):self.closed=True;return {}
        raise AssertionError('unsupported route')
    def correlate_task_delivery(self,snapshot,task_id,client_message_id,payload_hash,delivery_id):
        return Observation(client_message_id,'other' if self.other else task_id,'thread-1',delivery_id or self.delivery,'message-1',self.state,self.answer)

class TransportGuards(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.c=MemberClient();self.t=TeamTaskTransport(self.c,'sana-lab')
        self.r=SessionRouter(Path(self.tmp.name)/'state.sqlite',b'x'*32,self.t)
    def tearDown(self):self.r.close();self.tmp.cleanup()
    def test_real_start_shape_has_no_fabricated_receipt(self):
        a=self.r.submit('lab:familya','Synthetic A','operation_0001',1000)
        self.assertEqual(a.task_id,'task-1');self.assertIsNone(a.delivery_id)
        self.assertEqual(self.c.calls[0],('POST','/v1/agent-tasks/start',{'agentId':'sana-lab','text':'Synthetic A','clientMessageId':'operation_0001'}))
    def test_inflight_turn_blocks_followup(self):
        self.r.submit('lab:familya','A','operation_0001',1000)
        with self.assertRaises(ReconciliationRequired):self.r.submit('lab:familya','B','operation_0002',1001)
        self.assertEqual(len(self.c.calls),1)
    def test_authenticated_read_allows_next_turn_same_task(self):
        a=self.r.submit('lab:familya','A','operation_0001',1000);self.r.reconcile('operation_0001')
        b=self.r.submit('lab:familya','Correction A','operation_0002',1001)
        self.assertEqual((a.task_id,a.thread_id),(b.task_id,b.thread_id));self.assertEqual(b.delivery_id,'delivery-2')
        self.assertEqual(self.c.calls[-1][1],'/v1/agent-tasks/send')
    def test_terminal_cannot_be_supplied_by_caller(self):
        self.r.submit('lab:familya','A','operation_0001',1000)
        with self.assertRaises(IsolationGuard):self.r.confirm_terminal('operation_0001','delivery-1','completed')
    def test_missing_answer_blocks_without_resend(self):
        self.r.submit('lab:familya','A','operation_0001',1000);self.c.answer=None
        with self.assertRaises(ReconciliationRequired):self.r.reconcile('operation_0001')
        self.assertEqual(sum(p.endswith('/start') for _,p,_ in self.c.calls),1)
    def test_wrong_task_observation_is_rejected(self):
        self.r.submit('lab:familya','A','operation_0001',1000);self.c.other=True
        with self.assertRaises(IsolationGuard):self.r.reconcile('operation_0001')
    def test_unknown_send_recovered_by_exact_read_only(self):
        self.r.submit('lab:familya','A','operation_0001',1000);self.r.reconcile('operation_0001')
        old=self.t.send_task
        def timeout(*args):raise TimeoutError()
        self.t.send_task=timeout
        with self.assertRaises(ReconciliationRequired):self.r.submit('lab:familya','B','operation_0002',1001)
        self.t.send_task=old
        # A lost send receipt cannot be recovered by matching repeated text.
        with self.assertRaises(IsolationGuard):self.r.reconcile('operation_0002')
        # Simulate the trusted existing receipt becoming observable (no POST).
        self.r.db.execute("UPDATE requests SET delivery_id='delivery-1' WHERE operation_key='operation_0002'")
        self.c.inputs.append('B')
        self.r.reconcile('operation_0002')
        duplicate=self.r.submit('lab:familya','B','operation_0002',1002)
        self.assertTrue(duplicate.duplicate)
        self.assertFalse(any(p.endswith('/send') for _,p,_ in self.c.calls))
    def test_unassociated_unknown_start_never_guesses_task(self):
        def timeout(*a):raise TimeoutError()
        self.t.start_task=timeout
        with self.assertRaises(ReconciliationRequired):self.r.submit('lab:familya','A','operation_0001',1000)
        with self.assertRaises(ReconciliationRequired):self.r.reconcile('operation_0001')
        self.assertEqual(self.c.calls,[])
    def test_expiry_300_seconds_and_close_before_rotation(self):
        self.r.submit('lab:familya','A','operation_0001',1000);self.r.reconcile('operation_0001')
        # Do not claim this injected-clock test is a wall-clock live OpenBot test.
        self.r.submit('lab:familya','B','operation_0002',1300)
        self.assertTrue(self.c.closed)
        paths=[p for _,p,_ in self.c.calls];self.assertLess(paths.index('/v1/agent-tasks/close'),len(paths)-1)
    def test_local_scripts_auth_never_accepted_as_team_auth(self):
        self.c.auth_kind='local_scripts'
        with self.assertRaises(IsolationGuard):TeamTaskTransport(self.c,'sana-lab')
    def test_missing_capability_or_agent_scope_denied(self):
        self.c.capabilities=set()
        with self.assertRaises(IsolationGuard):TeamTaskTransport(self.c,'sana-lab')
        self.c.capabilities={'agent-tasks-v1'}
        with self.assertRaises(IsolationGuard):TeamTaskTransport(self.c,'boss')
    def test_real_contact_denied_before_api(self):
        with self.assertRaises(IsolationGuard):self.r.submit('+5511999999999','A','operation_0001',1000)
        self.assertEqual(self.c.calls,[])

class OfficialResults(unittest.TestCase):
    def setUp(self):
        self.run={'run_id':'run-1','delivery_id':'delivery-1','status':'succeeded','turn_id':'turn-1','error':None}
        self.payload={'id':'delivery-1','status':'completed','turnId':'turn-1','answer':'Resposta sintética'}
    def test_native_answer_recovers_without_projection_format_assumptions(self):
        r=official_delivery_result(self.run,self.payload);self.assertTrue(r['result_available']);self.assertEqual(r['result'],'Resposta sintética')
    def test_succeeded_without_answer_is_not_success(self):
        self.payload['answer']=None;self.assertFalse(official_delivery_result(self.run,self.payload)['result_available'])
    def test_other_delivery_is_not_accepted(self):
        self.payload['id']='other';self.assertEqual(official_delivery_result(self.run,self.payload)['reason'],'DELIVERY_ID_CONFLICT')
    def test_other_turn_is_not_accepted(self):
        self.payload['turnId']='other';self.assertFalse(official_delivery_result(self.run,self.payload)['result_available'])
    def test_running_ack_does_not_prove_answer(self):
        self.payload['status']='running';self.assertFalse(official_delivery_result(self.run,self.payload)['result_available'])
    def test_failed_run_cannot_become_success(self):
        self.run['status']='failed';self.assertFalse(official_delivery_result(self.run,self.payload)['result_available'])
    def test_truncation_is_explicit(self):
        r=official_delivery_result(self.run,self.payload,5);self.assertTrue(r['truncated']);self.assertEqual(len(r['result']),5)
    def test_direct_delivery_reader_uses_exact_ids_only(self):
        ids=[]
        def reader(i):ids.append(i);return self.payload
        r=official_agent_delivery_result(['delivery-1'],reader)
        self.assertEqual(ids,['delivery-1']);self.assertEqual(r['state'],'succeeded')
    def test_direct_result_missing_is_explicit(self):
        self.payload['answer']=None;r=official_agent_delivery_result(['delivery-1'],lambda _:self.payload)
        self.assertEqual(r['state'],'result_missing');self.assertFalse(r['result_available'])
    def test_direct_revoked_or_wrong_delivery_never_reads_other_thread(self):
        with self.assertRaises(ValueError):official_agent_delivery_result(['wrong'],lambda _:self.payload)

if __name__=='__main__':unittest.main()
