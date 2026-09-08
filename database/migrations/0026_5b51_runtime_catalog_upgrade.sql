-- 5B.5-B: atualização controlada do catálogo do runtime.
--
-- O hash do catálogo protege contra executar um estado já persistido sob
-- regras diferentes por acidente. Quando uma alteração é comprovadamente
-- compatível com o formato do estado, a troca precisa ser explícita, auditável
-- e feita por service_role; nunca ocorre como efeito colateral de uma mensagem.
begin;

create or replace function public.support_runtime_upgrade_catalog(
  p_from_catalog_hash char(64),
  p_to_catalog_hash char(64)
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, support_runtime as $$
declare
  v_updated integer := 0;
begin
  if p_from_catalog_hash is null or p_from_catalog_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid source catalog hash' using errcode = '22023';
  end if;
  if p_to_catalog_hash is null or p_to_catalog_hash !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'invalid target catalog hash' using errcode = '22023';
  end if;
  if p_from_catalog_hash = p_to_catalog_hash then
    return jsonb_build_object('updated', 0, 'unchanged', true);
  end if;

  -- Somente estados completos do runtime são elegíveis. Estados ausentes são
  -- inicializados pelo catálogo atualmente implantado na próxima entrada.
  update support_runtime.conversation_state
     set catalog_hash = p_to_catalog_hash,
         updated_at = now()
   where catalog_hash = p_from_catalog_hash
     and state is not null;
  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'updated', v_updated,
    'from_catalog_hash', p_from_catalog_hash,
    'to_catalog_hash', p_to_catalog_hash
  );
end $$;

revoke all on function public.support_runtime_upgrade_catalog(char,char) from public, anon, authenticated;
grant execute on function public.support_runtime_upgrade_catalog(char,char) to service_role;

commit;
