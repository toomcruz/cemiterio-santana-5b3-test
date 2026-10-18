import unittest
from reconciliation import assess_boss_result

TASK = {"task_id":"f"*32, "run_id":"e"*36}
RUN_ID = TASK["run_id"]

class ReconciliationTests(unittest.TestCase):
    def test_succeeded_without_result_remains_missing(self):
        r=assess_boss_result(TASK,{"run_id":RUN_ID,"status":"succeeded","result_available":False,"result":None})
        self.assertEqual(r.state,"RESULT_MISSING")
        self.assertFalse(r.result_available)

    def test_correlated_result_present(self):
        r=assess_boss_result(TASK,{"run_id":RUN_ID,"status":"succeeded","result_available":True,"result":"fictitious"})
        self.assertEqual(r.state,"RESULT_AVAILABLE")

    def test_missing_run_id_does_not_throw(self):
        self.assertEqual(assess_boss_result({"task_id":"f"*32},None).state,"QUEUED")

    def test_mismatched_run_is_not_success(self):
        self.assertEqual(assess_boss_result(TASK,{"run_id":"other","status":"succeeded","result_available":True,"result":"x"}).state,"CONFLICT")

    def test_failed_run_never_replays(self):
        self.assertEqual(assess_boss_result(TASK,{"run_id":RUN_ID,"status":"failed","result_available":False}).state,"TERMINAL_FAILURE")

if __name__=="__main__": unittest.main(verbosity=2)
