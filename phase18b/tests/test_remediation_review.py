import unittest

from phase18b.evaluation.build_remediation_review import TARGETS


class RemediationReviewTest(unittest.TestCase):
    def test_target_is_exactly_six_problematic_plus_four_sentinels(self):
        self.assertEqual(len(TARGETS), 10)
        self.assertEqual(sum(reason == "problematic_both_inadequate" for _, reason in TARGETS), 4)
        self.assertEqual(sum(reason == "context_may_be_insufficient" for _, reason in TARGETS), 2)
        self.assertEqual(sum(reason.startswith("sentinel_") for _, reason in TARGETS), 4)

    def test_case_refs_are_unique_and_stable(self):
        refs = [case_ref for case_ref, _ in TARGETS]
        self.assertEqual(len(refs), len(set(refs)))
        self.assertEqual(refs[:4], [
            "review_03_b45bdf4e29",
            "review_04_a4518158ca",
            "review_10_7f58f98455",
            "review_12_f61f664a03",
        ])


if __name__ == "__main__":
    unittest.main()
