import { assert, assertEquals } from "../../tests/fixtures/assert.ts";
import { loadBenchmarkCorpus } from "./corpus.ts";

Deno.test("5B.4-E benchmark corpus has 300 synthetic, isolated pt-BR cases", () => {
  const corpus = loadBenchmarkCorpus();
  assert(corpus.length >= 300);
  assertEquals(new Set(corpus.map((testCase) => testCase.id)).size, corpus.length);
  assert(corpus.some((testCase) => testCase.adversarial));
  for (const category of ["exumacao", "recadastro", "transporte", "concessao", "comercial", "reclamacao", "outros"]) {
    assert(corpus.some((testCase) => testCase.category === category));
  }
  assert(corpus.every((testCase) => testCase.input.message_id === testCase.id));
  assert(corpus.every((testCase) => testCase.expect.needs_clarification !== undefined));
});
