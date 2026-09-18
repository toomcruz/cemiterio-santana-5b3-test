-- SANA V1 / LAB: minimal helpers required by the official runtime commit.
-- The full operator bridge is intentionally not installed here because this
-- LAB schema does not contain the production panel's support_members or
-- support_service_requests tables. This migration covers only the authorized
-- inbound/ledger/commit/outbox surface.
begin;

create or replace function support_runtime.validate_commit(
  p_conversation_id uuid,
  p_expected_revision bigint,
  p_catalog_hash char(64),
  p_state_hash char(64),
  p_state jsonb,
  p_reply_body text,
  p_projection jsonb
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_conversation_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_catalog_hash is null or p_catalog_hash !~ '^[A-Fa-f0-9]{64}$'
    or p_state_hash is null or p_state_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid commit identity, revision or hashes' using errcode = '22023';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object'
    or p_state->>'conversation_id' is distinct from p_conversation_id::text then
    raise exception 'state does not belong to conversation' using errcode = '22023';
  end if;
  if p_reply_body is not null and (length(btrim(p_reply_body)) = 0 or length(p_reply_body) > 4096) then
    raise exception 'invalid reply body' using errcode = '22023';
  end if;
  if jsonb_typeof(p_projection) is distinct from 'object'
    or coalesce(p_projection->>'subject', '') not in ('nao_classificado','exumacao','recadastro','ossuario','concessao','comercial','atendimento_humano')
    or coalesce(p_projection->>'stage', '') not in ('novos','pendencias','documentos','aguardando','concluidos')
    or coalesce(p_projection->>'automation_mode', '') not in ('bot','human')
    or jsonb_typeof(p_projection->'flow_state') is distinct from 'object' then
    raise exception 'invalid projection' using errcode = '22023';
  end if;
end $$;

create or replace function support_runtime.materialize_requests(
  p_conversation_id uuid,
  p_state jsonb,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, support_runtime
as $$
begin
  if jsonb_typeof(coalesce(p_state->'solicitacoes', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'solicitacoes must be an array' using errcode = '22023';
  end if;
  return coalesce(p_state->'solicitacoes', '[]'::jsonb);
end $$;

commit;
