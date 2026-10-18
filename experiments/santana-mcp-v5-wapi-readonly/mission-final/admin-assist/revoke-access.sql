-- Revoke the new administrative boundary only; preserve original grants and send history.
update public.sana_mcp_supervision_access set is_active=false where subject_id='3ddaa108-6106-45ed-82c5-7c2dad05dc32' and client_id='ccb5e1fc-2a61-4296-943a-a85c103e9313';
