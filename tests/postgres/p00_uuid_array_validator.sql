\set ON_ERROR_STOP on
begin;
\ir _helpers.sql

select '{"properties":{"relato":{"type":"string"},"attachment_ids":{"type":"uuid_array"}},"required":[]}'::jsonb as proposal_schema \gset
select pg_temp.assert_true(support_vnext_shadow.valid_proposal_fields('{"relato":"Relato artificial de teste"}'::jsonb,:'proposal_schema'::jsonb),'P00 UUID array accepts optional attachment_ids absent');
select pg_temp.assert_true(support_vnext_shadow.valid_proposal_fields('{"relato":"Relato artificial de teste","attachment_ids":[]}'::jsonb,:'proposal_schema'::jsonb),'P00 UUID array accepts empty attachment_ids');
select pg_temp.assert_true(support_vnext_shadow.valid_proposal_fields('{"relato":"Relato artificial de teste","attachment_ids":["00000000-0000-4000-8000-000000000001"]}'::jsonb,:'proposal_schema'::jsonb),'P00 UUID array accepts one valid UUID');
select pg_temp.assert_true(support_vnext_shadow.valid_proposal_fields('{"relato":"Relato artificial de teste","attachment_ids":["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"]}'::jsonb,:'proposal_schema'::jsonb),'P00 UUID array accepts many valid UUIDs');
select pg_temp.assert_true(support_vnext_shadow.valid_complaint_payload_strict('{"relato":"Relato artificial de teste","attachment_ids":["00000000-0000-4000-8000-000000000001"]}'::jsonb),'P00 valid complaint payload accepts UUID reference');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":"00000000-0000-4000-8000-000000000001"}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects UUID string instead of array');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":123}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects number');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":{}}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects object');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":["uuid-invalido"]}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects invalid UUID');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":[123]}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects numeric element');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":[null]}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects null element');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":["00000000-0000-4000-8000-000000000001",123]}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects mixed elements');
select pg_temp.assert_true(not support_vnext_shadow.valid_proposal_fields('{"attachment_ids":[["00000000-0000-4000-8000-000000000001"]]}'::jsonb,:'proposal_schema'::jsonb),'P00 rejects nested array');
rollback;
