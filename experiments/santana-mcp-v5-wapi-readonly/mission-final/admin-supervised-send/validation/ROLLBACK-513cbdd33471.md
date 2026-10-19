# Implantação 513cbdd33471 — reversão

Implantado em 19/10/2026, com autorização expressa do usuário. Escopo: dez arquivos do delta aprovado e uma concessão administrativa de envio individual supervisionado. Nenhum despacho ou aprovação de mensagem foi executado.

## Integridade e ajustes de execução

O manifesto SHA-256 513cbdd33471a92b32ef8edbef914bb8e242d341cfd4bb1defb86429e4ed8cd1 e todos os dez arquivos aprovados foram preservados e verificados. Na execução SQL foram acrescentados apenas os dois terminadores de instrução ausentes entre definições; nenhuma lógica foi alterada. O Supabase herdou privilégios de tabela mais amplos que os do teste isolado; a nova tabela foi restringida com REVOKE ALL FROM service_role e GRANT SELECT, UPDATE(is_active), comprovando INSERT=false, DELETE=false, alteração de live_enabled=false e alteração de expires_at=false. A concessão foi ativada com o GUC local do manifesto autorizado. Sua expiração foi limitada a 25/10/2026 19:25:00 em America/Sao_Paulo, sem mudar a leitura.

## Backups

Arquivo privado persistido: santana-pre-deploy-513cbdd33471.zip. Contém os 53 arquivos anteriores da Edge PROD, os sete da Edge HOMOLOG, as duas definições SQL anteriores, metadados dos projetos e o catálogo de arquivos MCP anterior. Nenhum segredo ou conteúdo de atendimento foi incluído. Os deployments anteriores continuam disponíveis para rollback.

## Ordem de reversão, somente se necessária

1. Desativar apenas a nova concessão abaixo. Não apagar operações, eventos ou auditoria.
2. Reverter o MCP existente ao deployment dpl_8dfbsPTvZ6eDzsmmXBEN3Pnjf2Am e o Painel ao dpl_9dNM9kTUwfnudfBb7oqMbmXzRNcg, pelos mesmos projetos Vercel.
3. Restaurar os arquivos completos das Edge Functions anteriores a partir do backup: sana-panel-preview-login (código v42, verify_jwt=false) e sana-mcp-read (código v15, verify_jwt=true, import_map_path=deno.json). Preservar todas as configurações e segredos existentes. Uma restauração gera outra versão numérica.
4. Restaurar somente as definições anteriores de sana_mcp_coordinated_send(jsonb) e sana_mcp_admin_read(uuid,uuid,text,jsonb), com os terminadores SQL necessários. Conservar a tabela nova inativa e a auditoria; não usar DROP CASCADE. A leitura e as concessões individuais antigas permanecem intactas.
5. Validar o catálogo, uma leitura autorizada e os hashes de sana_control_transition e sana_manual_whatsapp; não disparar mensagens.

```sql
update public.sana_mcp_supervised_send_access
set is_active=false
where subject_id='3ddaa108-6106-45ed-82c5-7c2dad05dc32'
  and client_id='ccb5e1fc-2a61-4296-943a-a85c103e9313'
  and operator_id='8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f';
```

## Resultado funcional

As quatro ferramentas administrativas foram consultadas com a conexão OAuth atual. Foto e PDF autorizados foram lidos; referência cruzada de anexo foi negada com MCP_ADMIN_ATTACHMENT_DENIED / 403, sem conteúdo ou retry automático. Um rascunho foi preparado e consultado para uma conversa administrativa fora do telefone original de teste, com revisão e watermark vinculados; permaneceu prepared, sem revisão independente e sem operação de envio PROD. As quatro operações de envio antigas e seu último claimed_at permaneceram iguais. A revisão da conversa e a pausa humana foram preservadas. Lotes e autonomia não foram habilitados; cada mensagem futura requer aprovação autenticada específica.
