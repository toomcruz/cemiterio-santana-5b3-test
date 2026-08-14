-- FASE 5B.1 fixture local para ambiente isolado. NÃO EXECUTAR EM PRODUÇÃO.
-- UUIDs fixos apenas para testes; não representam preços, documentos ou regras públicas.

insert into support_vnext_shadow.support_ruleset_release (
  release_id, release_code, release_sequence, scope_code, status, effective_from,
  content_hash, change_summary, approved_at, approved_by,
  created_by, updated_by
) values (
  '00000000-0000-4000-8000-000000000001', 'SANTANA-TEST-001', 1, 'SANTANA_TEST', 'APPROVED', now() - interval '1 hour',
  repeat('0', 64), 'Fixture de shadow sem fatos administrativos', now(), 'test', 'test', 'test'
);

insert into support_vnext_shadow.knowledge_intent (
  intent_id, release_id, logical_intent_id, intent_code, visibility, intent_kind, description, record_status, created_by
) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'A_CONFIRMAR', 'SYSTEM', 'SYSTEM', 'Lacuna semântica segura', 'PUBLISHED', 'test'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', 'RECLAMACAO_INTERNA', 'INTERNAL', 'COMPLAINT', 'Intenção interna de reclamação', 'PUBLISHED', 'test');

insert into support_vnext_shadow.feature_flags (flag_key, description, default_mode, kill_switch, created_by, updated_by) values
  ('support_vnext_global', 'Kill switch global para vNext', 'OFF', false, 'test', 'test'),
  ('new_release_resolver', 'Resolvedor de release vNext', 'OFF', false, 'test', 'test'),
  ('new_state_read', 'Leitura de estado vNext', 'OFF', false, 'test', 'test'),
  ('new_classifier_shadow', 'Classificador em shadow', 'OFF', false, 'test', 'test'),
  ('new_decision_shadow', 'Motor de decisão em shadow', 'OFF', false, 'test', 'test'),
  ('new_renderer_shadow', 'Renderer em shadow', 'OFF', false, 'test', 'test'),
  ('new_request_facade', 'Fachada de solicitação vNext', 'OFF', false, 'test', 'test'),
  ('new_inactivity_shadow', 'Inatividade em shadow', 'OFF', false, 'test', 'test'),
  ('new_complaint_policy', 'Reclamação vNext', 'OFF', false, 'test', 'test'),
  ('new_n8n_adapter', 'Adaptador n8n vNext', 'OFF', false, 'test', 'test');

-- Publish only through the controlled route after all snapshot content exists.
select support_vnext_shadow.refresh_draft_release_content_hash('00000000-0000-4000-8000-000000000001', 'test');
select support_vnext_shadow.publish_ruleset_release('00000000-0000-4000-8000-000000000001', 'test');
