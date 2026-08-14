# Fase 5B.2-C3-T — suíte PostgreSQL

Os scripts são destinados exclusivamente a banco isolado com migrations `0001` a `0007`. Não foram executados nesta fase.

| Caso | Arquivo | Conexões | Garantia |
|---|---|---:|---|
| P01 | `p01_release_overlap.sql` | 2 | exclusão de releases sobrepostas |
| P02 | `p02_published_update.sql` | 1 | UPDATE de release publicada falha e preserva valor |
| P03 | `p03_published_delete.sql` | 1 | DELETE de release publicada falha |
| P04 | `p04_content_insert_update_delete.sql` | 1 | conteúdo final imutável |
| P05 | `p05_source_link_insert.sql` | 1 | fonte/vínculo final imutável |
| P06 | `p06_final_states.sql` | 1 | estado final não ressuscita |
| P07 | `p07_explicit_rebind.sql` | 1 | EXPLICIT_REBIND e revogação protegidos |
| P08 | `p08_hash_integrity.sql` | 1 | snapshot/hash publicado |
| P09 | `p09_session_concurrency.sql` | 2 | uma sessão aberta por conversa |
| P10 | `p10_a_confirmar.sql` | 1 | A_CONFIRMAR sem fatos ou ações administrativas |
| P11 | `p11_confirm_concurrency.sql` | 2 | confirmação idempotente e uma solicitação |
| P12 | `p12_inbound_reuse.sql` | 1 | inbound/classificação não reutilizáveis |
| P13 | `p13_confirmation_rejections.sql` | 1 | expiração e mudança de contexto rejeitam CONFIRM |
| P14 | `p14_complaint_closed.sql` | 1 | Reclamação com payload fechado |
| P15 | `p15_privileges.sql` | 1 + PostgREST | grants/RLS/RPCs |

`run_all.sh` exige `SUPPORT_VNEXT_TEST_ENV=1` e `TEST_DATABASE_URL`; recusa URLs com marcador `prod`/`production`. `run_concurrency.sh` requer duas conexões e propaga falhas por exit code.

P15 possui duas partes: SQL PostgreSQL e validação posterior via Supabase/PostgREST. Nenhuma credencial foi inserida e não há chamadas W-API, n8n, Gemini, V7.7 ou runtime `service_*`.
