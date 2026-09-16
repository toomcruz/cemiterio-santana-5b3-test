import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "evaluate_shadow.py"
SPEC = importlib.util.spec_from_file_location("phase18_evaluate_shadow", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PrivacyAndProjectionTest(unittest.TestCase):
    def test_privacy_scanner_ignores_validated_ids_but_rejects_contact_data(self) -> None:
        safe = {"event_id": "shadow_event_0123456789abcdef", "sha256": "1" * 64}
        self.assertEqual(MODULE.privacy_hits(safe), [])
        unsafe = {"free_text": "(" + "11" + ") " + "99999" + "-" + "8888"}
        self.assertTrue(MODULE.privacy_hits(unsafe))

    def test_semantic_projection_removes_only_engine_latency(self) -> None:
        record = {
            "event_id": "shadow_event_example",
            "current_workflow_replay": {"latency_ms": 10, "journeys": ["A"]},
            "motor_v2_shadow": {"latency_ms": 2, "journeys": ["B"]},
        }
        projected = MODULE.semantic_projection(record)
        self.assertNotIn("latency_ms", projected["current_workflow_replay"])
        self.assertNotIn("latency_ms", projected["motor_v2_shadow"])
        self.assertEqual(projected["current_workflow_replay"]["journeys"], ["A"])


if __name__ == "__main__":
    unittest.main()
