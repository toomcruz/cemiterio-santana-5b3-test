# Fase 5B.2-C3 — relatório de correção estática

Esta versão é uma cópia separada de `phase5b2-c2-shadow-package`. Não executa migrations, não publica Edge Functions e permanece SHADOW_ONLY.

| Achado | Correção C3 | Arquivo principal | Teste preparado |
|---|---|---|---|
| C-04 | Classificação persistida antes da autorização; confirmação exige `classification_id` | `0007_5b2c3_static_completion.sql` | P11–P13 + `c3_regressions_test.ts` |
| C-05 | Schema de DecisionPlan com chaves fechadas e bloqueio A_CONFIRMAR | `0007_5b2c3_static_completion.sql` | P10 |
| H-01 | Assunto vem de template publicado/policy, não do chamador | `0007_5b2c3_static_completion.sql` | P11/P13 |
| H-04 | Escopo validado e motor aplica ordenação/stop_processing | `support-decision-engine/index.ts` | testes unitários e P10 |
| C-03 | EXPLICIT_REBIND valida escopo, vigência e status | `0007_5b2c3_static_completion.sql` | P06/P07 |
| H-09 | Inatividade lê `decision_session_policy` e bloqueia humano/handoff/request | `0007_5b2c3_static_completion.sql` | P09 e unitários |
| Feature flags | candidatos completos e `GLOBAL` explícito | `_shared/flags.ts` | `c3_regressions_test.ts` |
| Rollback/CI | rollback operacional OFF; CI amplia validações | `database/rollback`, `.github/workflows` | revisão estática C3 |

## Fluxo de confirmação C3

`inbound_message → support-classifier → persist_confirmation_classification → authorize_persisted_confirmation → confirm_request_transaction → service_requests → protocol_sequences`.

`confirmation_nonce` e IDs isolados não bastam: a confirmação exige classificação persistida, não consumida, vinculada ao mesmo inbound, sessão, tópico, release e confirmação.

## Itens que exigem execução real posterior

Concorrência de publicação/sessão/confirmação, grants/RLS/PostgREST, comportamento das roles e locks PostgreSQL permanecem para 5B.3.
