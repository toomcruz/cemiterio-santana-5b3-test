import json
import unittest
from pathlib import Path

from phase18b.evaluation.build_remediation_review import TARGETS


class RemediationReviewTest(unittest.TestCase):
    def test_target_is_exactly_six_problematic_plus_four_sentinels(self):
        self.assertEqual(len(TARGETS), 10)
        self.assertEqual(sum(reason == "problematic_both_inadequate" for _, reason in TARGETS), 4)
        self.assertEqual(sum(reason == "context_may_be_insufficient" for _, reason in TARGETS), 2)
        self.assertEqual(sum(reason.startswith("sentinel_") for _, reason in TARGETS), 4)

    def test_source_cases_are_preserved(self):
        source = Path(__file__).parents[1] / "run" / "human-review-combined-p0"
        cases = {row["case_ref"]: row for row in (json.loads(line) for line in (source / "block_a_real_shadow_cases.jsonl").read_text().splitlines())}
        self.assertTrue({case_ref for case_ref, _ in TARGETS}.issubset(cases))
        self.assertEqual(len({case_ref for case_ref, _ in TARGETS}), 10)


if __name__ == "__main__":
    unittest.main()
