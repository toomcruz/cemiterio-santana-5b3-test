import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "pipeline" / "prepare_cohort.py"
SPEC = importlib.util.spec_from_file_location("phase18_prepare_cohort", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def row(identifier: int, timestamp: int, from_me: int, text: str) -> tuple:
    return (1, identifier, timestamp, from_me, 0, text)


class DecisionReferenceTest(unittest.TestCase):
    def test_decision_window_excludes_later_tail_from_reference(self) -> None:
        rows = [
            row(1, 1_000, 0, "Preciso localizar um jazigo"),
            row(2, 2_000, 1, "Qual é a quadra?"),
            row(3, 3_000, 0, "Quadra informada"),
            row(4, 4_000, 1, "Vou verificar."),
            row(5, 5_000, 0, "Também quero fazer exumação"),
        ]
        decision_rows, observed_rows, tail_rows = MODULE.decision_window(rows)
        reference = MODULE.decision_reference(decision_rows)
        whole_episode = MODULE.decision_reference(rows)

        self.assertEqual([item[1] for item in decision_rows], [1, 2, 3])
        self.assertEqual([item[1] for item in observed_rows], [4])
        self.assertEqual([item[1] for item in tail_rows], [5])
        self.assertEqual(reference["journeys"], ["JAZIGO_ESPACO_FISICO"])
        self.assertIn("RESTOS_MORTAIS", whole_episode["journeys"])
        self.assertEqual(reference["scope"], "decision_input_prefix_only")

    def test_reference_reproduces_phase11_multilabel_rule_on_prefix(self) -> None:
        rows = [
            row(1, 1_000, 0, "Quero exumação, ossuário e localizar o jazigo"),
        ]
        reference = MODULE.decision_reference(rows)
        self.assertEqual(reference["journeys"], ["RESTOS_MORTAIS", "JAZIGO_ESPACO_FISICO"])
        self.assertTrue(reference["multi_intent"])
        self.assertFalse(reference["human_validated"])


if __name__ == "__main__":
    unittest.main()
