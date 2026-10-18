-- User expressly authorized administrative READ only on 2026-10-18; no rule publications and no send permission.
begin;
insert into public.sana_mcp_supervision_access(subject_id,client_id,operator_id,scope_key,conversation_ids,operations,is_active,expires_at)
values('3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','panel:santana',null,
 array['pending','context','rules','attachment','conversations','contact','messages','files'],true,now()+interval '7 days');
insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,item_count,details)
values('3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','explicit_read_activation',0,jsonb_build_object('authorization','user-message-20261018T192202-0300','expires_in_days',7,'rule_publications',0,'write_permission',false));
commit;
