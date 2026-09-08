-- 5B.4-C: extensão aditiva do catálogo conversacional oficial.
-- Cobre ocorrências de jazigo, lápide e zeladoria sem confundir relato do
-- munícipe com verificação administrativa, titularidade ou solicitação formal.
begin;

alter type support_vnext_shadow.conv_goal_code add value if not exists 'GOAL_JAZIGO_SERVICOS';
alter type support_vnext_shadow.conv_fact_code add value if not exists 'grave_service_description';
alter type support_vnext_shadow.conv_question_code add value if not exists 'Q_GRAVE_SERVICE_DESCRIPTION';
-- O catálogo oficial já admite reclassificação. O enum de persistência precisa
-- aceitar o mesmo evento antes que esta rota possa ser ativada.
alter type support_vnext_shadow.conv_event_kind add value if not exists 'RECLASSIFICATION';

-- Guardas explícitas para instalações já existentes: os três valores devem
-- estar disponíveis antes de qualquer transição nova ser aceita.
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'support_vnext_shadow' and t.typname = 'conv_goal_code'
      and e.enumlabel = 'GOAL_JAZIGO_SERVICOS'
  ) then raise exception 'goal catalog extension missing'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'support_vnext_shadow' and t.typname = 'conv_fact_code'
      and e.enumlabel = 'grave_service_description'
  ) then raise exception 'fact catalog extension missing'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'support_vnext_shadow' and t.typname = 'conv_question_code'
      and e.enumlabel = 'Q_GRAVE_SERVICE_DESCRIPTION'
  ) then raise exception 'question catalog extension missing'; end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'support_vnext_shadow' and t.typname = 'conv_event_kind'
      and e.enumlabel = 'RECLASSIFICATION'
  ) then raise exception 'event catalog extension missing'; end if;
end $$;

commit;
