import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "evaluation" / "build_blind_review.py"
SPEC = importlib.util.spec_from_file_location("blind_review", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BlindReviewTest(unittest.TestCase):
    def test_mapping_is_stable_and_balanced_by_key(self):
        key = b"x" * 32
        first = MODULE.blind_side(key, "episode_a")
        self.assertEqual(first, MODULE.blind_side(key, "episode_a"))
        self.assertIsInstance(first, bool)

    def test_privacy_scanner_ignores_hashes_but_rejects_content(self):
        self.assertEqual(MODULE.privacy_hits({"cohort_hash": "a" * 64}), [])
        self.assertTrue(MODULE.privacy_hits({"content": "contato +55 (11) 98765-4321"}))

    def test_blinded_sides_have_the_same_shape(self):
        case = {
            "current_workflow_observed": {"response_sanitized": "Posso ajudar?"},
            "ai": {
                "response_proposed": "Qual informação falta?",
                "handoff": {"offered": False},
                "would_call": [],
                "receipts_required": [],
            },
        }
        self.assertEqual(
            set(MODULE.representation("CURRENT", case)),
            set(MODULE.representation("V2_AI", case)),
        )


if __name__ == "__main__":
    unittest.main()
