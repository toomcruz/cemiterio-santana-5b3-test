-- C4-R5A: protect both source and destination releases during content updates.
-- Local package only; do not apply before isolated-environment review.
begin;

create or replace function support_vnext_shadow.guard_release_content_immutable()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,support_vnext_shadow
as $$
declare
  old_status support_vnext_shadow.ruleset_status;
  new_status support_vnext_shadow.ruleset_status;
begin
  if tg_op in ('UPDATE','DELETE') then
    select status into old_status
      from support_vnext_shadow.support_ruleset_release
     where release_id=old.release_id;
    if old_status in ('PUBLISHED','SUPERSEDED','REVOKED') then
      raise exception 'Release content is immutable: %', old.release_id using errcode='55000';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    select status into new_status
      from support_vnext_shadow.support_ruleset_release
     where release_id=new.release_id;
    if new_status in ('PUBLISHED','SUPERSEDED','REVOKED') then
      raise exception 'Release content is immutable: %', new.release_id using errcode='55000';
    end if;
  end if;

  return case when tg_op='DELETE' then old else new end;
end $$;

commit;
