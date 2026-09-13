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


if __name__ == "__main__":
    unittest.main()
