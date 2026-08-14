\set ON_ERROR_STOP on
\echo '5B.2-C3 PostgreSQL integrity suite: isolated database only'
\echo 'Apply migrations 0001..0007 and test seed before running individual P01..P15 cases.'
\ir p02_published_update.sql
\ir p03_published_delete.sql
\ir p04_content_insert_update_delete.sql
\ir p05_source_link_insert.sql
\ir p06_final_states.sql
\ir p07_explicit_rebind.sql
\ir p08_hash_integrity.sql
\ir p10_a_confirmar.sql
\ir p12_inbound_reuse.sql
\ir p13_confirmation_rejections.sql
\ir p14_complaint_closed.sql
\ir p15_privileges.sql
\echo 'P01, P09 and P11 require tests/postgres/run_concurrency.sh with two isolated DATABASE_URL values.'
