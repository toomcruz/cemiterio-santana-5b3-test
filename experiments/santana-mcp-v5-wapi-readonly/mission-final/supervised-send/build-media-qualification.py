from pathlib import Path
r=Path(__file__).resolve().parent
old=(r/'qualify-coordinator.sql').read_text()
prefix=old[:old.index('create function pg_temp.session_active')]
prefix=prefix.replace('artifact_id uuid,actor_id uuid','artifact_id uuid primary key,actor_id uuid').replace('file_name text,mime_type text);','file_name text,mime_type text,size_bytes integer,sha256 text);')
new=(r/'coordinator.sql').read_text()
core=new[new.index('create function sana_mcp_private.session_active'):new.index('-- Deliberately no permissions inserted or enabled.')]
core=core.replace('public.','pg_temp.').replace('sana_mcp_private.','pg_temp.').replace('auth.sessions','pg_temp.test_auth_sessions')
core=core.replace('create table pg_temp.','create temporary table pg_temp.')
text_test=old[old.index('do $test$'):old.index('select jsonb_build_object(\'result\',\'PASS\'')]
media_test="""
do $media$
declare actor uuid='10000000-0000-4000-8000-000000000001'; sub uuid='10000000-0000-4000-8000-000000000002'; sid uuid='10000000-0000-4000-8000-000000000003';
 cid uuid;op uuid;aid uuid;cli uuid='ccb5e1fc-2a61-4296-943a-a85c103e9313';p jsonb;r jsonb;m jsonb;mime text;
begin
 foreach mime in array array['image/png','application/pdf'] loop
  cid=gen_random_uuid();op=gen_random_uuid();aid=gen_random_uuid();
  insert into pg_temp.sana_conversations(conversation_id,contact_key) values(cid,'+12025550201');
  insert into pg_temp.sana_mcp_send_permissions values(sub,cli,actor,cid,true,now()+interval '1 hour');
  insert into pg_temp.sana_mcp_read_access values(sub,cli,actor,cid,true,now()+interval '1 hour');
  insert into pg_temp.sana_operator_attachments values(aid,actor,cid,op,now(),now(),'synthetic',mime,64,repeat('b',64));
  m=jsonb_build_object('name','synthetic','mime_type',mime,'size_bytes',64,'sha256',repeat('b',64));
  p=jsonb_build_object('operation','authorize','operation_id',op,'attachment_id',aid,'subject_id',sub,'client_id',cli,'operator_id',actor,'operator_session_id',sid,'conversation_id',cid,'payload_sha256',repeat('a',64),'expires_at',now()+interval '5 minutes','explicit_authorization',case when mime='application/pdf' then 'one_real_document_attempt' else 'one_real_image_attempt' end,'payload',jsonb_build_object('conversation_id',cid,'expected_revision',0,'recipient',jsonb_build_object('name','Synthetic','phone_mask','***0201'),'text','Synthetic media','attachment',m));
  begin perform pg_temp.sana_mcp_coordinated_send(p||'{"explicit_authorization":"one_real_text_attempt"}');raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_APPROVAL_INVALID_OR_STALE' then raise;end if;end;
  update pg_temp.sana_operator_attachments set verified_at=null where artifact_id=aid;
  begin perform pg_temp.sana_mcp_coordinated_send(p);raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_APPROVAL_INVALID_OR_STALE' then raise;end if;end;
  update pg_temp.sana_operator_attachments set verified_at=now() where artifact_id=aid;
  r=pg_temp.sana_mcp_coordinated_send(p);if r->>'status'<>'authorized' then raise exception 'TEST_MEDIA_AUTHORIZE';end if;
  if pg_temp.sana_mcp_coordinated_send(p||'{"operation":"status"}')->>'attachment_id'<>aid::text then raise exception 'TEST_MEDIA_ID_NOT_BOUND';end if;
  update pg_temp.sana_operator_attachments set sha256=repeat('c',64) where artifact_id=aid;
  begin perform pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}');raise exception 'TEST_DID_NOT_BLOCK';exception when others then if sqlerrm<>'MCP_ATTACHMENT_BINDING_CHANGED' then raise;end if;end;
  if (select revision from pg_temp.sana_conversations where conversation_id=cid)<>0 then raise exception 'TEST_MEDIA_PARTIAL_PAUSE';end if;
  update pg_temp.sana_operator_attachments set sha256=repeat('b',64) where artifact_id=aid;
  r=pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}');
  if r->>'status'<>'prepared' or r->>'attachment_id'<>aid::text then raise exception 'TEST_MEDIA_NATIVE_CLAIM';end if;
  if not exists(select 1 from pg_temp.sana_inbox_messages where action_id=op and attachments->0->>'artifact_id'=aid::text and attachments->0->>'mime_type'=mime)then raise exception 'TEST_MEDIA_NATIVE_AUDIT';end if;
  if pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}')->>'status'<>'duplicate' then raise exception 'TEST_MEDIA_DUPLICATE';end if;
  perform pg_temp.sana_mcp_coordinated_send(p||jsonb_build_object('operation','settle','claim_token',r->>'claim_token','outcome','unknown'));
  if pg_temp.sana_mcp_coordinated_send(p||'{"operation":"prepare"}')->>'delivery_state'<>'unknown' then raise exception 'TEST_MEDIA_UNKNOWN_RETRIED';end if;
  if (select count(*) from pg_temp.sana_inbox_messages where action_id=op)<>1 then raise exception 'TEST_MEDIA_DUPLICATION';end if;
 end loop;
end $media$;
select jsonb_build_object('result','PASS','environment','temporary_tables_rollback','production_writes',0,'transport','not_called','text_regression',true,'media',array['image/png','application/pdf'],'media_checks',array['media_specific_consent','verified_private_manifest_required','immutable_hash_rechecked','no_partial_pause_on_mismatch','canonical_attachment_id_status','native_attachment_claim_and_audit','duplicate_no_second_claim','ambiguous_outcome_no_retry'],'existing_concurrency_and_pause_checks','PASS') as qualification;
rollback;
"""
(r/'qualify-media.sql').write_text(prefix+core+text_test+media_test)
print('Temporary-only media SQL qualification generated.')
