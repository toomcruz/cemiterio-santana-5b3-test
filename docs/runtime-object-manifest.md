# Manifesto de objetos runtime C4

MIGRATIONS_COVERED: 0001-0020

O manifesto descreve o estado cumulativo das migrations `0001`–`0020`. Ele é usado
na 5B.3 para comparar instalação e remoção. Nenhum item abaixo reativa legado.

| Migration | Objetos criados/alterados | Uso | Rollback operacional | Rollback físico |
|---|---|---|---|---|
| 0001 | schema `support_vnext_shadow`; enums; releases; `knowledge_*`; `decision_*`; sessions/topics; confirmations; requests/protocol sequences; handoffs; inactivity; events; decisions; flags; shadow comparisons e índices | base SHADOW_ONLY | flags OFF/kill switch | `DROP SCHEMA ... CASCADE` |
| 0002 | guards/triggers de release, sessão, confirmação, request, jobs, payload e eventos; RPCs de resolver/hash/decisão/proposta/confirmação/renderer/flags/inatividade; RLS/policies | integridade e fachadas | revoke EXECUTE/USAGE | removidos com schema |
| 0003 | `ruleset_source_link`, `release_audit_events`, `confirmation_authorizations`; guards de fonte/release; shape/coherence validators; RPCs de publicação/transição | conteúdo versionado e auditoria | revoke publication EXECUTE | removidos com schema |
| 0004 | RPCs runtime finais e correções de grants/overloads | fachada runtime | revoke runtime EXECUTE | removidos com schema |
| 0005 | hardening de release, request e evidence | fechamento C3 | revoke runtime EXECUTE | removidos com schema |
| 0006 | capability roles `support_vnext_runtime/publisher/auditor/admin`; `inbound_classifications`, `inactivity_outbox`; guards e RPCs finais C2 | capabilities, classificação e inatividade | revoke all capabilities | roles revoked/dropped somente se preflight seguro; schema dropped |
| 0007 | validações finais, publication/transition, confirmação e grants revisados | fechamento C3 | revoke EXECUTE | removidos com schema |
| 0008 | `inbound_messages`; strict proposal/complaint/hash/session-policy functions and source guard | cadeia C4 | revoke execute | removidos com schema |
| 0009 | `valid_proposal_fields` e `uuid_array` | anexos tipados | sem efeito separado | removidos com schema |
| 0010 | `guard_release_content_immutable` final e triggers associados | imutabilidade OLD/NEW | sem efeito separado | removidos com schema |
| 0011 | `classifier_authorities`; `content_hash*`; authority evidence columns/indexes; immutable inbound/classification triggers; assertion/classification/inbound/authorization RPCs | fronteira de autoridade | revoke classification/confirm EXECUTE | removidos com schema |
| 0012 | validadores profundos de DecisionPlan/DecisionRule e resolução determinística | schema fechado/fail-closed | revoke decision EXECUTE | removidos com schema |
| 0013 | alinhamento final de `inbound_classifications`: remove a exigência global de `confirmation_id`; recria checks condicionais de `classification_code`/`classification_status`/`confirmation_id`; preserva as funções finais de persistência/autorização e seus grants | OTHER legítima sem abrir bypass de AFFIRMATIVE | mantém o modo SHADOW_ONLY e revoga a superfície se desativado | constraints, índices e funções são removidos por `DROP SCHEMA support_vnext_shadow CASCADE` |
| 0014 | recria os validadores fail-closed `valid_scalar_value`, `valid_template_variables`, `valid_fact_refs`, `valid_question_schema`, `valid_plan_field_values`, `valid_state_patch_operation`, `valid_state_patch`, `valid_response_plan`, `valid_request_plan`, `valid_document_plan`, `valid_handoff_plan`, `valid_validation_requirements`, `valid_decision_plan`, `valid_decision_rule_when`, `validate_decision_rule_shape` e `validate_decision_rule_scope` | rejeita campos ausentes, NULL e tipos inválidos | sem efeito operacional separado; fachadas continuam SHADOW_ONLY | todas as funções/triggers são removidas por `DROP SCHEMA support_vnext_shadow CASCADE` |

| 0015 | runtime compatibility hardening for inbound persistence: finalizes source=SHADOW_INBOUND on persist_shadow_inbound_message | preserves inbound contract and shadow-only provenance | revoke EXECUTE | removed with schema |
| 0016 | `valid_plan_field_values` rejects package-owned identity/state-control keys em `allowed_fields` e `proposal_field_values` | impede rebind de release/sessão/tópico por DecisionPlan | sem efeito operacional separado | removida com o schema |
| 0017 | `publish_ruleset_release` e `transition_ruleset_release` limpam os GUCs `controlled_publish`/`controlled_transition` logo após o UPDATE controlado | impede bypass do guard de estado final no resto da transação | revoke EXECUTE | removidas com o schema |
| 0018 | retira os overloads legados `persist_inbound_classification(8 args)` e `propose_request_transaction(13 args)` | elimina caminhos de escrita sem fronteira de autoridade | sem efeito operacional separado | removidos com o schema |
| 0019 | `revoke all on all functions/routines in schema support_vnext_shadow from public` | fecha o EXECUTE default do PUBLIC criado por 0011/0013/0014 | revoke PUBLIC | removidas com o schema |
| 0020 | 9 tabelas `conv_*` (estado conversacional), 8 tipos enum do catalogo v1, 7 triggers de guarda, 4 RPCs (`conv_get_state`, `conv_apply_transition`, `conv_apply_authoritative_signal`, `conv_rollback_to_seq`) e 4 helpers internos | persiste conversation/case/goal/fact/pergunta/acao/evento do Santana Conversation Domain v1; o reducer semantico permanece no TypeScript | `conv_get_state`/`conv_apply_transition` para `service_role`; `conv_apply_authoritative_signal`/`conv_rollback_to_seq` apenas para `support_vnext_admin`; helpers sem grant | removidas com o schema |

## Modalidades

- **Operacional**: `database/rollback/0012_operational_off.sql` mantém releases,
  evidence, requests e auditoria, força flags `OFF`/kill switch e remove USAGE/EXECUTE
  vNext das capabilities. Não remove dados nem habilita `service_*`.
- **Físico**: `database/rollback/0012_full_physical_rollback.sql` primeiro revoga
  grants, derruba somente `support_vnext_shadow` com seus triggers, políticas,
  SECURITY DEFINER RPCs, overloads, classifier authority e flags; em seguida remove
  capabilities C4 apenas depois de checar ownership externo. Não derruba login de
  instalação, `auth`, schemas Supabase, `extensions.pgcrypto`, `service_*` ou legado.
