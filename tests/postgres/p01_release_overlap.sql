\set ON_ERROR_STOP on
\if :{?is_setup}
  begin;
  \ir _helpers.sql
  select pg_temp.new_approved_release('P01_SCOPE') as release_a \gset
  select pg_temp.new_approved_release('P01_SCOPE') as release_b \gset
  create table if not exists support_vnext_shadow_test_p01(release_a uuid,release_b uuid);
  truncate support_vnext_shadow_test_p01;
  insert into support_vnext_shadow_test_p01 values(:'release_a',:'release_b');
  commit;
\elif :{?is_worker}
  begin;
  select case :'worker' when 'A' then release_a else release_b end as release_id from support_vnext_shadow_test_p01 \gset
  do $$ begin perform pg_advisory_lock(hashtextextended('P01-barrier',0)); perform pg_sleep(0.2); perform pg_advisory_unlock(hashtextextended('P01-barrier',0)); end $$;
  select support_vnext_shadow.publish_ruleset_release(:'release_id'::uuid,'P01-worker');
  commit;
\elif :{?is_assert}
  begin;
  \ir _helpers.sql
  select pg_temp.assert_true((select count(*)<=1 from support_vnext_shadow.support_ruleset_release where scope_code='P01_SCOPE' and status='PUBLISHED'),'P01 at most one overlapping release published');
  \echo 'PASS P01 concurrent publication exclusion'
  rollback;
\else
  \quit 3
\endif
