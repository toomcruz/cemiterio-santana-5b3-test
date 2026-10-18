import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from session_router import SessionRouter, ReconciliationRequired, IsolationGuard
from mock_openbot import FakeOpenBotTasks

TEST_KEY = b"synthetic-hmac-key-for-tests-only-0000000"

class LabTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=Path(self.tmp.name)/"lab.sqlite"
        self.mock=FakeOpenBotTasks()
        self.router=SessionRouter(self.db,TEST_KEY,self.mock)
    def tearDown(self):
        self.router.close()
        self.tmp.cleanup()

    def test_three_turns_same_thread(self):
        a=self.router.submit("lab:familya","Sou filha.","labturn_01",1000)
        self.router.confirm_terminal("labturn_01", a.delivery_id, "completed")
        b=self.router.submit("lab:familya","Quanto custa?","labturn_02",1020)
        self.router.confirm_terminal("labturn_02", b.delivery_id, "completed")
        c=self.router.submit("lab:familya","Corrigindo: sobrinha.","labturn_03",1030)
        self.assertEqual({a.task_id,b.task_id,c.task_id},{a.task_id})
        self.assertEqual({a.thread_id,b.thread_id,c.thread_id},{a.thread_id})
        self.assertEqual(len(self.mock.tasks[a.task_id]["texts"]),3)

    def test_two_contacts_no_cross_thread(self):
        a=self.router.submit("lab:familya","Código privado TEST-A","labturn_11",1000)
        b=self.router.submit("lab:familyb","Código privado TEST-B","labturn_12",1001)
        self.assertNotEqual(a.task_id,b.task_id)
        self.assertNotEqual(a.thread_id,b.thread_id)
        self.assertNotIn("TEST-B", " ".join(self.mock.tasks[a.task_id]["texts"]))
        self.assertNotIn("TEST-A", " ".join(self.mock.tasks[b.task_id]["texts"]))

    def test_expiry_rotates_and_closes(self):
        a=self.router.submit("lab:familya","Primeira sessão","labturn_21",1000)
        self.router.confirm_terminal("labturn_21", a.delivery_id, "completed")
        b=self.router.submit("lab:familya","Nova sessão","labturn_22",1301)
        self.assertNotEqual(a.task_id,b.task_id)
        self.assertIn(a.task_id,self.mock.closed)

    def test_duplicate_is_not_resent_even_after_restart(self):
        a=self.router.submit("lab:familya","Pergunta A","labturn_31",1000)
        self.router.close()
        self.router=SessionRouter(self.db,TEST_KEY,self.mock)
        b=self.router.submit("lab:familya","Pergunta A","labturn_31",1001)
        self.assertTrue(b.duplicate)
        self.assertEqual(b.delivery_id,a.delivery_id)
        self.assertEqual(len(self.mock.attempts),1)

    def test_receipt_not_completion_and_no_early_close(self):
        a=self.router.submit("lab:familya","Processando","labturn_26",1000)
        # At 202/ACCEPTED the OpenBot agent might still be running.
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","Novo prazo","labturn_27",1301)
        self.assertNotIn(a.task_id,self.mock.closed)
        self.router.confirm_terminal("labturn_26",a.delivery_id,"completed")
        b=self.router.submit("lab:familya","Novo prazo","labturn_27",1302)
        self.assertNotEqual(a.task_id,b.task_id)
        with self.assertRaises(IsolationGuard):
            self.router.confirm_terminal("labturn_27",a.delivery_id,"completed")

    def test_duplicate_key_with_other_contact_rejected(self):
        self.router.submit("lab:familya","A","labturn_41",1000)
        with self.assertRaises(IsolationGuard):
            self.router.submit("lab:familyb","A","labturn_41",1001)

    def test_unknown_result_blocks_replay(self):
        a=self.router.submit("lab:familya","A","labturn_51",1000)
        self.router.confirm_terminal("labturn_51",a.delivery_id,"completed")
        self.mock.raise_on_send=True
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","B","labturn_52",1001)
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","C","labturn_53",1002)
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","B","labturn_52",1003)

    def test_storage_no_raw_phone_or_text(self):
        self.router.submit("lab:familya","FAKE_CONFIDENTIAL_MARKER","labturn_61",1000)
        dump="\n".join(self.router.db.iterdump())
        self.assertNotIn("FAKE_CONFIDENTIAL_MARKER",dump)
        self.assertNotIn("lab:familya",dump)

    def test_disallow_real_contact_and_nonlab_transport(self):
        with self.assertRaises(IsolationGuard):
            self.router.submit("+5511999999999","Teste","labturn_71",1000)
        class RealTransport: lab_only=False
        with self.assertRaises(IsolationGuard):
            SessionRouter(self.db,TEST_KEY,RealTransport())

    def test_sweeper_releases_capacity_for_inactive_terminal_tasks(self):
        for i in range(40):
            key=f"testturn_{i:03d}"
            a=self.router.submit(f"lab:family{i:03d}","OK",key,1000)
            self.router.confirm_terminal(key,a.delivery_id,"completed")
        # All 40 sessions expired, so the next contact may start safely.
        b=self.router.submit("lab:newfamily","Novo", "testturn_new",1301)
        self.assertIsNotNone(b.task_id)
        self.assertEqual(len(self.mock.closed),40)

    def test_close_failure_remains_bounded_and_fail_closed(self):
        a=self.router.submit("lab:familya","A","labturn_85",1000)
        self.router.confirm_terminal("labturn_85",a.delivery_id,"completed")
        old=self.mock.close_task
        def reject_close(agent_id,task_id):
            raise TimeoutError("unknown close outcome")
        self.mock.close_task=reject_close
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","B","labturn_86",1301)
        state=self.router.db.execute("SELECT state FROM sessions WHERE session_id=?",(a.session_id,)).fetchone()[0]
        self.assertEqual(state,"close_pending")
        self.mock.close_task=old
        b=self.router.submit("lab:familya","B","labturn_86",1302)
        self.assertNotEqual(a.task_id,b.task_id)

    def test_inflight_new_session_blocks_concurrent_send(self):
        # Reproduce crash/restart after reservation and before remote ACK.
        scope=self.router._scope("lab:familya")
        self.router.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",("a"*32,scope,"sana-lab",None,None,1000,1300,"active"))
        with self.assertRaises(ReconciliationRequired):
            self.router.submit("lab:familya","Outro turno","labturn_81",1001)

    def test_no_automatic_whatsapp_or_production_write(self):
        self.assertFalse(any(hasattr(self.mock,x) for x in ("send_whatsapp","supabase_write","deploy")))

if __name__=="__main__": unittest.main(verbosity=2)
