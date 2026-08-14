-- FASE 5B.1 rollback local. NÃO EXECUTAR SEM REVISÃO.
-- Só pode ser executado após o rollback 0002 e quando não houver dados vNext relevantes.

do $$
begin
  if exists (select 1 from support_vnext_shadow.support_ruleset_release where status in ('PUBLISHED','REVOKED','SUPERSEDED'))
     or exists (select 1 from support_vnext_shadow.service_requests)
     or exists (select 1 from support_vnext_shadow.state_events) then
    raise exception 'Rollback bloqueado: schema vNext contém histórico que deve ser preservado';
  end if;
end;
$$;

drop schema if exists support_vnext_shadow cascade;
