import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent_messages import AgentMessageStore
import server


class AgentMessageStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        os.chmod(self.root, 0o700)
        self.state_path = self.root / "bridge.sqlite"
        self.run_db = self.root / "openbot.sqlite"
        self.calls = []
        self.store = self.make_store()

    def tearDown(self):
        self.tmp.cleanup()

    def make_store(self, enabled=True, authorized=True):
        return AgentMessageStore(
            self.state_path,
            self.run_db,
            lambda agent_id, text, client_id: self._send(agent_id, text, client_id),
            lambda agent_id: authorized and agent_id == "agent-sana",
            enabled=enabled,
        )

    def _send(self, agent_id, text, client_id):
        self.calls.append((agent_id, text, client_id))
        return {
            "messageId": "msg-real-shaped-1",
            "deliveries": [{"id": "delivery-1", "recipientAgentId": agent_id, "status": "queued", "position": 1}],
        }

    def _projection(self, state="succeeded", final="Resposta sintética da Sana", error=None, include_final=True):
        with sqlite3.connect(self.run_db) as db:
            db.executescript("""
              CREATE TABLE projection_deliveries(delivery_id TEXT, turn_id TEXT);
              CREATE TABLE projection_turns(turn_id TEXT, thread_id TEXT, status TEXT, error TEXT);
              CREATE TABLE projection_thread_messages(thread_id TEXT, turn_id TEXT, ordinal INTEGER, author TEXT, status TEXT, item_type TEXT, message_json TEXT);
            """)
            db.execute("INSERT INTO projection_deliveries VALUES('delivery-1','turn-1')")
            db.execute("INSERT INTO projection_turns VALUES('turn-1','thread-1',?,?)", (state, error))
            if error:
                db.execute("INSERT INTO projection_thread_messages VALUES('thread-1','turn-1',1,'assistant','completed','provider_error',?)", (json.dumps({"text": error}),))
            if include_final:
                db.execute("INSERT INTO projection_thread_messages VALUES('thread-1','turn-1',2,'assistant','completed','final_answer',?)", (json.dumps({"text": final}),))
        os.chmod(self.run_db, 0o600)

    def test_send_is_direct_and_receipt_is_not_completion(self):
        result = self.store.submit("agent-sana", "Pergunta fictícia de teste.", "test-key-0001")
        self.assertEqual(self.calls, [("agent-sana", "Pergunta fictícia de teste.", "test-key-0001")])
        self.assertEqual(result["state"], "accepted")
        self.assertEqual(result["message_id"], "msg-real-shaped-1")
        self.assertEqual(result["delivery_ids"], ["delivery-1"])

    def test_same_idempotency_key_does_not_send_twice(self):
        first = self.store.submit("agent-sana", "Pergunta fictícia.", "test-key-0002")
        second = self.store.submit("agent-sana", "Pergunta fictícia.", "test-key-0002")
        self.assertEqual(first["request_id"], second["request_id"])
        self.assertEqual(len(self.calls), 1)

    def test_concurrent_same_key_posts_once(self):
        barrier = threading.Barrier(3)
        results, errors = [], []

        def run():
            try:
                barrier.wait()
                results.append(self.store.submit("agent-sana", "Pergunta concorrente.", "test-key-0003"))
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join(3)
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["request_id"], results[1]["request_id"])
        self.assertEqual(len(self.calls), 1)

    def test_key_cannot_be_reused_for_different_message(self):
        self.store.submit("agent-sana", "Mensagem A", "test-key-0004")
        with self.assertRaisesRegex(ValueError, "mensagem diferente"):
            self.store.submit("agent-sana", "Mensagem B", "test-key-0004")
        self.assertEqual(len(self.calls), 1)

    def test_unlisted_agent_is_denied_and_feature_flag_defaults_off(self):
        with self.assertRaises(PermissionError):
            self.make_store(authorized=False).submit("agent-other", "teste", "test-key-0005")
        with self.assertRaises(PermissionError):
            self.make_store(enabled=False).submit("agent-sana", "teste", "test-key-0006")
        self.assertEqual(self.calls, [])

    def test_receipt_cannot_claim_another_agent(self):
        bad = AgentMessageStore(self.state_path, self.run_db,
                                lambda *_: {"messageId": "m", "deliveries": [{"id": "d", "recipientAgentId": "agent-other"}]},
                                lambda _: True, enabled=True)
        outcome = bad.submit("agent-sana", "teste", "test-key-0007")
        self.assertEqual(outcome["state"], "uncertain")
        self.assertIsNone(outcome["message_id"])

    def test_result_is_correlated_to_delivery_and_final_turn(self):
        record = self.store.submit("agent-sana", "Pergunta fictícia.", "test-key-0008")
        self._projection()
        result = self.store.status(record["request_id"], with_result=True)
        self.assertEqual(result["state"], "succeeded")
        self.assertTrue(result["result_available"])
        self.assertEqual(result["result"], "Resposta sintética da Sana")
        self.assertFalse(result["truncated"])

    def test_error_is_reported_without_fabricating_success(self):
        record = self.store.submit("agent-sana", "Pergunta fictícia.", "test-key-0009")
        self._projection(state="failed", error="Falha sintética de provedor", include_final=False)
        result = self.store.status(record["request_id"], with_result=True)
        self.assertEqual(result["state"], "failed")
        self.assertFalse(result["result_available"])
        self.assertEqual(result["error"], "Falha sintética de provedor")

    def test_uncertain_crash_is_not_resent(self):
        record = self.store.submit("agent-sana", "Pergunta inicial", "test-key-0010")
        with sqlite3.connect(self.state_path) as db:
            db.execute("UPDATE direct_agent_messages SET state='dispatching' WHERE request_id=?", (record["request_id"],))
        recovered = self.make_store()
        outcome = recovered.submit("agent-sana", "Pergunta inicial", "test-key-0010")
        self.assertEqual(outcome["state"], "uncertain")
        self.assertEqual(len(self.calls), 1)

    def test_existing_boss_tools_remain_registered(self):
        names = {tool["name"] for tool in server.TOOLS}
        self.assertTrue({"enviar_tarefa", "consultar_tarefa", "obter_resultado_tarefa", "reconciliar_tarefa", "consultar_status", "obter_resultado"}.issubset(names))
        self.assertTrue({"list_openbot_agents", "enviar_mensagem_agente", "consultar_execucao_agente", "obter_resposta_agente"}.issubset(names))

    def test_openbot_post_uses_exact_message_route_and_key(self):
        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self, _limit):
                return b'{"messageId":"m1","deliveries":[]}'

        captured = {}
        def open_request(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch.object(server, "_automation_connection", return_value=("http://127.0.0.1:8765", "local-test-token")), \
             patch.object(server._opener, "open", side_effect=open_request):
            result = server._openbot_request("POST", "/v1/agents/agent-sana/messages", {"text": "sintética", "clientMessageId": "test-key-0011"})
        request = captured["request"]
        self.assertEqual(request.full_url, "http://127.0.0.1:8765/v1/agents/agent-sana/messages")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(json.loads(request.data), {"text": "sintética", "clientMessageId": "test-key-0011"})
        self.assertEqual(result["messageId"], "m1")

    def test_openbot_route_allowlist_rejects_other_paths_and_methods(self):
        with patch.object(server, "_automation_connection", return_value=("http://127.0.0.1:8765", "local-test-token")):
            with self.assertRaisesRegex(ValueError, "Rota do OpenBot inválida"):
                server._openbot_request("POST", "/v1/agents/../messages", {})
            with self.assertRaisesRegex(ValueError, "Método não permitido"):
                server._openbot_request("GET", "/v1/agents/agent-sana/messages")

    def test_mcp_tool_flow_send_then_read_result_without_boss(self):
        with patch.object(server, "_agent_messages", self.store):
            sent = server.rpc({
                "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "enviar_mensagem_agente", "arguments": {
                    "agent_id": "agent-sana", "message": "Pergunta fictícia.", "idempotency_key": "test-key-0012"
                }},
            })
            payload = json.loads(sent["result"]["content"][0]["text"])
            self.assertEqual(payload["state"], "accepted")
            self.assertEqual(payload["agent_id"], "agent-sana")
            self.assertEqual(payload["message_id"], "msg-real-shaped-1")
            self._projection()
            read = server.rpc({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "obter_resposta_agente", "arguments": {"request_id": payload["request_id"]}},
            })
            result = json.loads(read["result"]["content"][0]["text"])
            self.assertTrue(result["result_available"])
            self.assertEqual(result["result"], "Resposta sintética da Sana")
            self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
