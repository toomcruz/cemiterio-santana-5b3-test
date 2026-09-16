import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "live-shadow" / "build_live_cohort.py"
SPEC = importlib.util.spec_from_file_location("live_cohort", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SanitizerTest(unittest.TestCase):
    def test_removes_direct_identifiers_and_keeps_intent(self):
        source = (
            "Olá, sou Maria da Silva, meu telefone é +55 (11) 98765-4321 e o CPF 123.456.789-00. "
            "Preciso agendar a exumação do falecido João Pereira às 09:30. "
            "Veja https://example.test/a e maria@example.test"
        )
        clean, classes = MODULE.sanitize_text(source, ["Maria da Silva"])
        self.assertIn("exumacao", clean)
        self.assertIn("agendar", clean)
        self.assertNotIn("Maria", clean)
        self.assertNotIn("98765", clean)
        self.assertNotIn("123.456", clean)
        self.assertNotIn("example", clean)
        self.assertIn("phone", classes)
        self.assertIn("document_id", classes)

    def test_unknown_words_fail_closed(self):
        clean, classes = MODULE.sanitize_text("Ximena Albuquerque deseja sepultamento", [])
        self.assertEqual(clean, "[PESSOA] [TERMO] sepultamento")
        self.assertIn("lexicon_redaction", classes)


if __name__ == "__main__":
    unittest.main()
