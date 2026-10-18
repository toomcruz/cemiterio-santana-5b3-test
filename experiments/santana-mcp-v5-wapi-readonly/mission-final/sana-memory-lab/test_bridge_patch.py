import sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'bridge-patch'))
import server
from task_queue import TaskQueue

class BridgePatchTests(unittest.TestCase):
    def test_reconcile_keeps_run_id_even_if_missing(self):
        class Queue:
            def get(self,_):return {'task_id':'a'*32,'run_id':None,'delivery_id':None,'state':'queued','attempts':0,'error':None,'created':1,'updated':1,'result':None}
            def _sync_running(self,_):pass
        with patch.object(server,'_task_queue',Queue()):
            r=server._task_reconcile({'task_id':'a'*32})
            self.assertIn('run_id',r);self.assertIsNone(r['run_id']);self.assertFalse(r['result_available'])
    def test_run_uses_official_exact_delivery_get(self):
        row={'run_id':'run-1','status':'succeeded','delivery_id':'delivery-1','turn_id':'turn-1','thread_id':'thread-1','error':None}
        payload={'id':'delivery-1','status':'completed','turnId':'turn-1','answer':'SYNTHETIC_OK'}
        with patch.object(server,'BOSS_ID','boss-1'),patch.object(server,'_legacy_run_or_task_id',return_value=('run','run-1')),patch.object(server,'_run_row',return_value=row),patch.object(server,'_openbot_request',return_value=payload) as call:
            result=server._run_result({'run_id':'run-1'})
            self.assertTrue(result['result_available']);call.assert_called_once_with('GET','/v1/agents/boss-1/deliveries/delivery-1')
    def test_delivery_route_cannot_dispatch_or_delete(self):
        with patch.object(server,'_automation_connection',return_value=('http://127.0.0.1:8765','synthetic')):
            for method in ('POST','PUT','DELETE'):
                with self.assertRaises(ValueError):server._openbot_request(method,'/v1/agents/sana/deliveries/dlv',{})
    def test_result_missing_reconciliation_only_reads_existing_run(self):
        with tempfile.TemporaryDirectory() as td:
            calls=[];available=[False]
            def dispatch(*_):calls.append('dispatch');return {'runId':'run-1','deliveryId':'delivery-1'}
            def lookup(i):self.assertEqual(i,'run-1');return {'status':'succeeded','error':None}
            lookup.result=lambda _: 'SYNTHETIC_OK' if available[0] else None
            q=TaskQueue(Path(td)/'queue.sqlite',dispatch,lookup,lambda:False)
            row,_=q.enqueue('Synthetic test','operation_0001');q._dispatch_one()
            with q._db() as db:db.execute("UPDATE task_queue SET state='failed',error='RESULT_MISSING: test' WHERE task_id=?",(row['task_id'],))
            available[0]=True;q._sync_running(row['task_id'])
            self.assertEqual(q.get(row['task_id'])['result'],'SYNTHETIC_OK');self.assertEqual(calls,['dispatch'])
            duplicate,created=q.enqueue('Synthetic test','operation_0001');self.assertFalse(created);self.assertEqual(duplicate['task_id'],row['task_id'])
            q._dispatch_one();self.assertEqual(calls,['dispatch'])

if __name__=='__main__':unittest.main()
