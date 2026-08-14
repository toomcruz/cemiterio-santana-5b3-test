-- C4-R6B: make inbound_classifications match the final classifier contract.
begin;

alter table support_vnext_shadow.inbound_classifications
  alter column confirmation_id drop not null,
  drop constraint if exists inbound_classifications_classification_code_check,
  drop constraint if exists inbound_classifications_classification_status_check,
  drop constraint if exists inbound_classifications_code_status_confirmation_ck,
  add constraint inbound_classifications_classification_code_check
    check (classification_code in ('CONFIRMATION_AFFIRMATIVE', 'OTHER')),
  add constraint inbound_classifications_classification_status_check
    check (classification_status in ('OK', 'AMBIGUOUS', 'BLOCKED')),
  add constraint inbound_classifications_code_status_confirmation_ck check (
    (
      classification_code = 'CONFIRMATION_AFFIRMATIVE'
      and confirmation_id is not null
      and authority_key_id is not null
      and authority_nonce is not null
      and authority_assertion_hash is not null
    )
    or
    (
      classification_code = 'OTHER'
      and confirmation_id is null
      and authority_key_id is null
      and authority_nonce is null
      and authority_assertion_hash is null
    )
  );

-- The final RPC is the only runtime write surface. It already verifies the HMAC
-- for every affirmative result and rejects evidence on OTHER before insertion.
revoke all on function support_vnext_shadow.persist_inbound_classification(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function support_vnext_shadow.persist_inbound_classification(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, uuid, text
) to service_role;

commit;
