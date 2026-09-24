/** LAB registry. A classification label is not evidence that a service is implemented. */
export const MODULES = {
  EXUMACAO: {
    catalog_source: "santana-authority/catalogo/exumacao.v1.json",
    sources: [
      "santana-authority/catalogo/exumacao.v1.json",
      "santana-conversation-domain/goals.v1.json",
      "santana-conversation-domain/facts.v1.json",
      "santana-conversation-domain/questions.v1.json",
      "santana-conversation-domain/relations.v1.json",
    ],
    release: "exu-1.0-be0300053f95",
  },
  RECADASTRO: {
    catalog_source: "santana-conversation-domain/goals.v1.json",
    sources: [
      "santana-conversation-domain/goals.v1.json",
      "santana-conversation-domain/facts.v1.json",
      "santana-conversation-domain/questions.v1.json",
      "santana-conversation-domain/runtime/tests/official_journey_integration_test.ts",
      "docs/official-operations-release.md",
    ],
    release: "LAB-recadastro-domain-v1-unqualified",
  },
  CONCESSAO_TITULARIDADE: {
    catalog_source: "santana-conversation-domain/goals.v1.json",
    sources: [
      "santana-conversation-domain/goals.v1.json",
      "santana-conversation-domain/facts.v1.json",
      "santana-conversation-domain/questions.v1.json",
      "santana-conversation-domain/relations.v1.json",
      "santana-conversation-domain/topics.v1.json",
    ],
    release: "LAB-concessao-domain-v1-unqualified",
  },
} as const;
export type EnabledModule = keyof typeof MODULES;
export function enabledModule(x: string): x is EnabledModule {
  return Object.hasOwn(MODULES, x);
}
