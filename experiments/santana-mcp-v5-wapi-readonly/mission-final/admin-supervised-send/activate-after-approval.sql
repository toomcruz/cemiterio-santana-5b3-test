-- Only after explicit approval of DEPLOYMENT-SCOPE.md and this exact candidate manifest.
begin;
do $guard$ begin
 if current_setting('santana_mcp.approved_write_manifest',true) is distinct from 'd183abaab3ed104f66d65886c902fc52a4c446e7e946a510cfb285cce384ed6b' then raise exception 'EXPLICIT_WRITE_APPROVAL_REQUIRED';end if;
end $guard$;
insert into public.sana_mcp_supervised_send_access(subject_id,client_id,operator_id,scope_key,is_active,live_enabled,expires_at)
select g.subject_id,g.client_id,g.operator_id,g.scope_key,true,true,g.expires_at from public.sana_mcp_supervision_access g
join public.support_members m on m.user_id=g.operator_id
where g.subject_id='3ddaa108-6106-45ed-82c5-7c2dad05dc32' and g.client_id='ccb5e1fc-2a61-4296-943a-a85c103e9313'
and g.operator_id='8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f' and g.is_active and g.expires_at>clock_timestamp()
and m.role='admin' and m.is_active and m.approval_status='approved' and 'atendimentos'=any(m.permissions);
do $guard$ begin
 if not exists(select 1 from public.sana_mcp_supervised_send_access where subject_id='3ddaa108-6106-45ed-82c5-7c2dad05dc32' and client_id='ccb5e1fc-2a61-4296-943a-a85c103e9313' and operator_id='8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f' and is_active and live_enabled and expires_at>clock_timestamp()) then raise exception 'EXPLICIT_WRITE_ACTIVATION_FAILED';end if;
end $guard$;
insert into public.sana_mcp_admin_audit(subject_id,client_id,operator_id,operation,item_count,details)
values('3ddaa108-6106-45ed-82c5-7c2dad05dc32','ccb5e1fc-2a61-4296-943a-a85c103e9313','8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f','explicit_supervised_send_activation',0,jsonb_build_object('manifest','d183abaab3ed104f66d65886c902fc52a4c446e7e946a510cfb285cce384ed6b','real_messages_sent',0));
commit;
