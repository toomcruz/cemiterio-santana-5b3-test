# Matriz SQL ↔ TypeScript

| Edge/component | RPC | Parâmetros SQL | Corpo TypeScript |
|---|---|---|---|
| release resolver | `resolve_shadow_session` | `p_conversation_id`, `p_scope_code`, `p_requested_session_id` | mesmos três nomes |
| inbound persistence | `persist_shadow_inbound_message` | `p_inbound_message_id`, `p_session_id`, `p_topic_id`, `p_release_id`, `p_content` | conteúdo é hasheado no banco como `INBOUND_CONTENT_V1`; plaintext não é persistido |
| classifier persistence | `persist_inbound_classification` | `p_classification_id`, `p_inbound_message_id`, `p_confirmation_id`, `p_session_id`, `p_topic_id`, `p_release_id`, `p_classification_code`, `p_classification_status`, `p_source`, `p_classifier_version`, `p_authority_key_id`, `p_authority_nonce`, `p_authority_assertion` | `CONFIRMATION_AFFIRMATIVE` exige confirmação e assertion HMAC verificável; `OTHER` não carrega confirmação/evidence e nunca autoriza CONFIRM |
| confirmation authorizer | `authorize_persisted_confirmation` | `p_classification_id`, `p_confirmation_id`, `p_confirmation_nonce`, `p_inbound_message_id`, `p_session_id`, `p_topic_id`, `p_release_id` | mesmos sete nomes |
| request command | `propose_request_transaction` | `p_decision_id`, `p_actor` | mesmos dois nomes |
| request command | `confirm_request_transaction` | `p_confirmation_id`, `p_confirmation_nonce`, `p_classification_id`, `p_inbound_message_id`, `p_actor` | mesmos cinco nomes |
| decision engine | `get_runtime_decision_rules` / `store_shadow_decision` | conforme 0004/0006 | mesmos nomes |
| renderer | `get_renderer_decision_context` | `p_decision_id` | mesmo nome |
| inactivity | `schedule_inactivity_transaction_v2`, `cancel_inactivity_transaction_v2`, `run_due_inactivity_jobs_v2` | sessão ou worker/limite | mesmos nomes |
| flags | `resolve_shadow_feature` | `p_flag_key`, `p_candidates` (`target_type`, `target_value`) | mesmos nomes |

Qualquer modificação de assinatura exige atualizar ambos os lados e P15/PostgREST na 5B.3.

## Inventário de overloads C4

| Function | Signature | Status | Execute runtime |
|---|---|---|---|
| `confirm_request_transaction` | `(uuid,uuid,uuid,text)` | REMOVE | nenhum |
| `confirm_request_transaction` | `(uuid,uuid,uuid,uuid,text)` | KEEP | `service_role` somente em SHADOW_ONLY |
| `persist_confirmation_classification` | `(uuid,uuid,uuid,uuid,uuid,uuid)` | REMOVE | nenhum |
| `persist_shadow_inbound_message` | `(uuid,uuid,uuid,uuid)` | REMOVE | nenhum |
| `persist_shadow_inbound_message` | `(uuid,uuid,uuid,uuid,text)` | KEEP | `service_role`; banco calcula e fixa `content_hash` |
| `persist_inbound_classification` | `(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,text)` | KEEP | `service_role` somente em SHADOW_ONLY; affirmative requer assertion independente |
| `classifier_assertion_material` | `(uuid,char(64),uuid,uuid,uuid,uuid,text,text,text,uuid)` | KEEP | `service_role`; material sem segredo para assinatura pelo classificador |
