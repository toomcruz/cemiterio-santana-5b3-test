-- CANDIDATE: execute only after explicit approval of deployment, administrative access and the referenced three-rule manifesto.
begin;
do $guard$ begin
 if current_setting('santana_mcp.approved_manifest',true) is distinct from '4c64c2f408ad4bdd3f1e76c8dd35e12eec4d23a6ed4c2cf6e9a85d663e0bb02b' then
  raise exception 'EXPLICIT_APPROVAL_REQUIRED';
 end if;
end $guard$;
insert into public.sana_mcp_supervision_access(subject_id,client_id,operator_id,scope_key,conversation_ids,operations,is_active,expires_at)
values('3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','panel:santana',null,
 array['pending','context','rules','attachment','conversations','contact','messages','files'],true,now()+interval '7 days');
insert into public.sana_mcp_rule_approvals(rule_id,catalog_sha256,approved_by,approved_at,expires_at,approval_reference)
select id,'2dffd7a236bb6239cae3d480315c47f42cec213c72fb7a04b58cd4cf9795db60','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f',now(),now()+interval '7 days','manifest:4c64c2f408ad4bdd3f1e76c8dd35e12eec4d23a6ed4c2cf6e9a85d663e0bb02b'
from unnest(array['AUTHORITY','LOCATOR','FOLLOWUP_SCOPE']) id;
insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,item_count,details)
values('3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','explicit_activation',3,jsonb_build_object('approval_manifest','4c64c2f408ad4bdd3f1e76c8dd35e12eec4d23a6ed4c2cf6e9a85d663e0bb02b','expires_in_days',7));
commit;
