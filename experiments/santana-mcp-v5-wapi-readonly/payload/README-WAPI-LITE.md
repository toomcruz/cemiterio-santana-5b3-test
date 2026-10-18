# Patch incremental W-API LITE para o MCP Santana v5

Preparado em 18/10/2026. Não substitui o projeto, o plugin ou o túnel.

## Resultado e limites

O LAB conectado continua em `source=fixture`. Não existe nesta entrega prova
de conexão autenticada com a W-API nem de leitura real por operador.

A documentação atual marca `/v1/chats/fetch-chats`, `/v1/chats/chat` e
`/v1/contacts/fetch-contacts` como PRO. Status e dados da instância são LITE/PRO.
Histórico de mensagens e arquivos depende do armazenamento Sana autorizado.
Fonte: https://docs.w-api.app . O registro de rotas e hash da fonte documental
fica nas evidências; documentação não é resultado da instância do usuário.

## Mudanças

- Catálogo de capacidades por domínio e plano, sem instalar mcp-zapi.
- Em modo W-API LITE, anuncia apenas `consultar_conexao`; não anuncia rotas PRO.
- HTTP 200 com envelope de erro não é mais tratado como operação válida.
- Dados da instância são projetados sem token, telefone, QR ou URL de webhook.
- `sana_wapi` encaminha as seis consultas de dados ao adaptador Sana existente,
  sempre com o JWT individual original e as permissões verificadas no backend.
- Uma recusa de leitura não aciona fallback W-API, fixture ou credencial admin.
- A ferramenta de status real do modo integrado exige primeiro uma leitura
  autorizada com `source=sana_panel_fast_snapshot`. HOMOLOG sintética não autoriza
  acesso à instância W-API real.
- `REAL_SEND_GATE_OPEN=False` permanece imutável.

## Fonte do painel: o bloqueio real

O painel PROD usa `sana-panel-preview-login` v35 e a ação `operational_snapshot`,
com validação de JWT de operador do projeto PROD e de sua associação aprovada.
A RPC `sana_panel_fast_snapshot` não concede EXECUTE a `authenticated`; é
acessada pelo gateway existente depois dessas verificações. Não conceda acesso
direto à RPC para contornar o gateway.

O `sana-mcp-read` v3 atualmente publicado fica em HOMOLOG e lê dados sintéticos.
Não há `sana-mcp-read` publicado em PROD. O adaptador dedicado v5 não pode ser
apontado ao gateway do painel: os contratos, a autenticação e o caminho diferem.
Nenhum token HOMOLOG autentica automaticamente um operador em PROD.

Portanto, o modo integrado está preparado, mas não será ativado até existir um
vínculo de leitura individual compatível e efetivamente validado. O instalador
preserva o provider `fixture` e não grava credenciais ou concessões novas.

## Instalação controlada

A ação root verifica o SHA-256 do bootstrap e do ZIP base já existente na VPS,
verifica que o servidor ativo corresponde aos arquivos base auditados, prepara
o patch em diretório privado, roda as suítes isoladas e usa o instalador v5
existente para backup, atualização somente do LAB e rollback automático.
Também executa até quatro GETs diagnósticos quando encontra as credenciais
existentes no ambiente autorizado. Nunca imprime ou persiste essas credenciais.
Nenhum webhook, configuração W-API, banco, projeto Vercel ou serviço adicional
é criado/modificado.

O bootstrap deixa relatório sem segredos no staging do runner. Uma execução
não cria acesso permanente nem muda sudo/permissões do runner.

## Reversão

O resultado da instalação contém o diretório de backup. Execute o `rollback.py`
v5 desse servidor com o caminho exato do backup. Ele verifica hashes, restaura
somente o código e preserva o ledger de idempotência. Não restaure o ledger.
Não reinicie ou altere o túnel para aplicar ou reverter este patch.
