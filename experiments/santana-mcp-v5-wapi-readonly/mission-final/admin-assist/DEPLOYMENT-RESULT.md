# Leitura administrativa — implantação autorizada de 18/10/2026

Leitura instalada nos componentes existentes. Concessão individual vinculada ao operador PROD, vigente até **25/10/2026 às 19h25, horário de São Paulo**, com auditoria e revogação. Nenhuma concessão de escrita foi ampliada e nenhuma mensagem real foi enviada nesta etapa.

Edge PROD `sana-panel-preview-login` v42; Edge HOMOLOG `sana-mcp-read` v14. MCP existente: `dpl_8dfbsPTvZ6eDzsmmXBEN3Pnjf2Am`, READY. Painel existente: `dpl_9dNM9kTUwfnudfBb7oqMbmXzRNcg`, READY, commit `58a242926cbae6213e079f18234cad8eb87e0f59`. Os arquivos do atendimento automático, emissores, pausa, webhooks, n8n e OpenBot foram preservados.

Zero publicações oficiais de regras. AUTHORITY, LOCATOR e FOLLOWUP_SCOPE permanecem propostas internas, sujeitas à validação da Administração. As regras pendentes não fundamentam procedimentos.

Comprovação: a conexão OAuth atual do ChatGPT retornou fonte `sana_administrative_read` para o contato de teste e para mensagens de outro atendimento administrativo autorizado. A consulta de pendências pelo RPC restrito percorreu todas as páginas do dia 18/10, em São Paulo: três atendimentos examinados, uma pendência sem resposta. O histórico dessa pendência foi percorrido pelo plugin em três páginas, com 59 mensagens. O teste administrativo pelo RPC de gestão é identificado separadamente da prova OAuth; não foi apresentado como chamada das quatro ferramentas novas pelo host.

**Limitação pendente no ChatGPT:** o servidor foi atualizado com as quatro ferramentas, mas esta conversa ainda mantém o catálogo anterior da conexão. As quatro chamadas novas, incluindo a leitura real de anexo, não foram demonstradas nesta conversa. O navegador de automação não permitiu observar a tela de configurações por proteção de credenciais. É necessário atualizar o catálogo da conexão existente na interface do ChatGPT; não recriar plugin ou conta. A sessão individual já está válida.

Foram validados isoladamente 68 testes de leitura, arquivos e regressão do canal supervisionado. As evidências finais do runner e do candidato separado de escrita ficam nos arquivos JSON e no repositório existente. Nenhum dado real de mensagens foi copiado para esses artefatos.

## Atualização de 19/10/2026 — uso diário

As quatro ferramentas já estão no catálogo ativo. A leitura PROD de pendências, contextos paginados e catálogo de regras foi comprovada pelo ChatGPT, mantendo zero normas oficialmente publicadas. Foto e PDF autorizados foram lidos na conexão existente em 19/10, sem alteração de código ou permissão; cruzar o arquivo de outra conversa foi bloqueado. A causa dos erros transitórios anteriores não foi estabelecida.

O novo delta preserva os helpers de mídia e corrige a perda dos códigos de erro, acrescenta triagem conservadora de agradecimentos/confirmações e reaproveita o candidato de envio individual separado. O runner existente aprovou 50 verificações focadas, sem alterações de produção, ativação de escrita ou mensagens reais. Evidências atuais: validation/daily-operations/live-read.json e runner-result.json. A implantação continua pendente da autorização específica descrita em ../admin-supervised-send/DEPLOYMENT-SCOPE.md; nenhum lote real ou atendimento automático integra esse escopo.
