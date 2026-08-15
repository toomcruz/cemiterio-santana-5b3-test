-- 5B.3-C: the controlled_publish / controlled_transition escape hatches are
-- transaction-scoped GUCs (set_config(..., is_local => true)). Once a caller
-- invoked publish_ruleset_release or transition_ruleset_release, the flag stayed
-- 'yes' for the remainder of the transaction, so any subsequent RAW UPDATE on
-- support_ruleset_release bypassed guard_release_final_state — including the
-- resurrection of a SUPERSEDED/REVOKED release to PUBLISHED (P00/P06).
-- The definitions below are byte-identical to 0007/0008 except that each
-- controlled UPDATE is immediately followed by a reset of the flag it consumed.
begin;

create or replace function support_vnext_shadow.publish_ruleset_release(p_release_id uuid, p_actor text)
returns support_vnext_shadow.support_ruleset_release
language plpgsql
security definer
set search_path=pg_catalog,support_vnext_shadow,extensions
as $$
declare r support_vnext_shadow.support_ruleset_release; h char(64);
begin
 if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'APPROVED' or r.approved_at is null or coalesce(btrim(r.approved_by),'')='' then raise exception 'release not approved' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support-vnext-scope:'||r.scope_code,0)); h:=support_vnext_shadow.compute_release_content_hash(r.release_id);
 if h<>r.content_hash then raise exception 'content hash mismatch' using errcode='22023'; end if;
 perform set_config('support_vnext_shadow.controlled_publish','yes',true);
 update support_vnext_shadow.support_ruleset_release set status='PUBLISHED',published_at=now(),published_by=p_actor,updated_by=p_actor,row_version=row_version+1 where release_id=r.release_id returning * into r;
 perform set_config('support_vnext_shadow.controlled_publish','',true);
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,content_hash) values(extensions.gen_random_uuid(),r.release_id,'PUBLISHED',p_actor,h);
 return r;
end $$;

create or replace function support_vnext_shadow.transition_ruleset_release(
  p_release_id uuid,
  p_to_status support_vnext_shadow.ruleset_status,
  p_actor text,
  p_reason text default null,
  p_revocation_mode text default null,
  p_replacement_release_id uuid default null
) returns support_vnext_shadow.support_ruleset_release
language plpgsql
security definer
set search_path=pg_catalog,support_vnext_shadow,extensions
as $$
declare r support_vnext_shadow.support_ruleset_release; replacement support_vnext_shadow.support_ruleset_release; h char(64);
begin
 if coalesce(btrim(p_actor),'')='' then raise exception 'actor required' using errcode='22023'; end if;
 select * into r from support_vnext_shadow.support_ruleset_release where release_id=p_release_id for update;
 if not found or r.status<>'PUBLISHED' or p_to_status not in ('SUPERSEDED','REVOKED') then raise exception 'invalid final transition' using errcode='55000'; end if;
 if p_to_status='REVOKED' then
   if coalesce(btrim(p_reason),'')='' or p_revocation_mode not in ('BLOCK_FACTS','EXPLICIT_REBIND','TERMINATE_AFFECTED_FLOW') then raise exception 'invalid revocation' using errcode='22023'; end if;
   if p_revocation_mode='EXPLICIT_REBIND' then
     select * into replacement from support_vnext_shadow.support_ruleset_release where release_id=p_replacement_release_id for update;
     if not found or replacement.release_id=r.release_id or replacement.scope_code<>r.scope_code or replacement.status<>'APPROVED' or replacement.approved_at is null or coalesce(btrim(replacement.approved_by),'')='' or not (replacement.effective_from<=now() and (replacement.effective_to is null or replacement.effective_to>now())) then raise exception 'invalid replacement release' using errcode='22023'; end if;
     h:=support_vnext_shadow.compute_release_content_hash(replacement.release_id); if h<>replacement.content_hash then raise exception 'replacement hash mismatch' using errcode='22023'; end if;
     perform pg_advisory_xact_lock(hashtextextended('support-vnext-scope:'||r.scope_code,0)); perform set_config('support_vnext_shadow.controlled_publish','yes',true); perform set_config('support_vnext_shadow.controlled_transition','yes',true); set constraints support_ruleset_release_one_effective_published deferred;
     update support_vnext_shadow.support_ruleset_release set status='PUBLISHED',published_at=now(),published_by=p_actor,updated_by=p_actor,row_version=row_version+1 where release_id=replacement.release_id;
     perform set_config('support_vnext_shadow.controlled_publish','',true);
     perform set_config('support_vnext_shadow.controlled_transition','',true);
   elsif p_replacement_release_id is not null then raise exception 'replacement only allowed for explicit rebind' using errcode='22023'; end if;
 end if;
 perform set_config('support_vnext_shadow.controlled_transition','yes',true);
 if p_to_status='REVOKED' then update support_vnext_shadow.support_ruleset_release set status='REVOKED',revoked_at=now(),revoked_by=p_actor,revocation_reason=p_reason,revocation_mode=p_revocation_mode,replacement_release_id=p_replacement_release_id,updated_by=p_actor where release_id=p_release_id returning * into r; else update support_vnext_shadow.support_ruleset_release set status='SUPERSEDED',updated_by=p_actor where release_id=p_release_id returning * into r; end if;
 perform set_config('support_vnext_shadow.controlled_transition','',true);
 insert into support_vnext_shadow.release_audit_events(event_id,release_id,event_type,actor,reason,content_hash) values(extensions.gen_random_uuid(),p_release_id,p_to_status::text,p_actor,p_reason,r.content_hash);
 return r;
end $$;

commit;
