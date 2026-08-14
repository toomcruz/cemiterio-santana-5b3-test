-- Included by P01–P15 inside their own transaction. Artificial data only.
create or replace function pg_temp.assert_true(p_condition boolean, p_message text) returns void language plpgsql as $$
begin if p_condition is distinct from true then raise exception 'ASSERTION FAILED: %', p_message using errcode='P0001'; end if; end $$;

create or replace function pg_temp.expect_error(p_sql text, p_sqlstate text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'ASSERTION FAILED: statement unexpectedly succeeded: %', p_sql using errcode='P0001';
exception when others then
  if sqlstate='P0001' then raise; end if;
  if sqlstate<>p_sqlstate then raise exception 'ASSERTION FAILED: expected SQLSTATE %, got %',p_sqlstate,sqlstate using errcode='P0001'; end if;
end $$;

create or replace function pg_temp.new_approved_release(p_scope text default 'TEST_SCOPE') returns uuid language plpgsql as $$
declare r uuid:=extensions.gen_random_uuid(); n integer;
begin
 select coalesce(max(release_sequence),0)+1 into n from support_vnext_shadow.support_ruleset_release;
 insert into support_vnext_shadow.support_ruleset_release(release_id,release_code,release_sequence,scope_code,status,effective_from,content_hash,change_summary,approved_at,approved_by,created_by,updated_by)
 values(r,'TEST-'||replace(r::text,'-',''),n,p_scope,'APPROVED',now()-interval '1 minute',repeat('0',64),'test fixture',now(),'test-fixture','test-fixture','test-fixture');
 perform support_vnext_shadow.refresh_draft_release_content_hash(r,'test-fixture');
 return r;
end $$;

create or replace function pg_temp.publish_release(p_scope text default 'TEST_SCOPE') returns uuid language plpgsql as $$
declare r uuid:=pg_temp.new_approved_release(p_scope);
begin perform support_vnext_shadow.publish_ruleset_release(r,'test-fixture'); return r; end $$;
