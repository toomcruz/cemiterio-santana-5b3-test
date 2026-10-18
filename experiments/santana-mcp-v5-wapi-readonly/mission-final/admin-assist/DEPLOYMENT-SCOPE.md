> Escopo original de revisão. A autorização posterior de 18/10/2026 aprovou a leitura, mas NÃO a publicação das três propostas como normas oficiais. Veja DEPLOYMENT-RESULT.md para o estado executado.

# Escopo para autorização — supervisão e atendimento assistido

Estado: candidato implementado e validado em ambiente sintético; não instalado em produção e sem ampliação de leitura real.

## Uma ativação delimitada

1. Atualizar os componentes existentes, preservando identidades e conexões: Edge Function PROD `sana-panel-preview-login`, Edge Function HOMOLOG `sana-mcp-read`, servidor MCP HOMOLOG e a rota de leitura de mídia do Painel. O manifesto identifica os 14 arquivos e as versões de origem; a instalação deverá parar se essas versões tiverem mudado.
2. Acrescentar três tabelas privadas com RLS para concessão, publicação de regras e auditoria, e três funções invoker acessíveis somente ao serviço. Nenhuma alteração direta em `auth.users`, mensagens, conversas, filas ou regras de atendimento automático.
3. Vincular a identidade OAuth existente ao operador PROD `8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f`, cuja condição de administrador aprovado com permissão `atendimentos` será verificada a cada consulta. A sessão HOMOLOG, sozinha, não autoriza acesso PROD.
4. Conceder por **7 dias**, com revogação imediata, leitura administrativa do escopo `panel:santana`: conversas não técnicas supervisionadas pelo perfil administrativo, incluindo histórico, protocolos, documentos, notas e estado de pausa. Isso amplia o vínculo anterior de uma única conversa para esse conjunto administrativo. As seis consultas existentes passam a respeitar o mesmo escopo explícito; não haverá ferramenta de SQL livre, acesso a outras tabelas ou credenciais entregues ao ChatGPT.
5. Disponibilizar `listar_pendencias`, `consultar_contexto_atendimento`, `consultar_regras_santana` e `ler_anexo_autorizado` apenas ao cliente ChatGPT autorizado. Consultas paginadas, evidências e lacunas explícitas, auditoria sem copiar os textos das mensagens para o log de acesso. A primeira demonstração consultará as pendências de hoje, horário de São Paulo, e preparará sugestões sem enviar.
6. Permitir leitura de imagens e PDFs recebidos, vinculados à conversa e mensagem autorizadas, pelo canal de mídia existente. Limite de 2 MiB por arquivo; PDFs com até duas páginas por consulta e cobertura parcial indicada. Sem URLs arbitrárias, tokens de mídia ou arquivos de outras conversas.
7. Publicar por 7 dias somente as **três orientações administrativas** transcritas em `REGRAS-PARA-APROVACAO.md`, vinculadas ao hash do catálogo. As outras 77 regras não serão publicadas; as 16 pendentes continuarão sem texto utilizável para fundamentar respostas. Essa publicação não muda o catálogo nem o comportamento da Sana.

## Envio e preservação do atendimento

Nenhum envio real faz parte desta autorização. O canal oficial, a aprovação independente por operação e a idempotência existentes permanecem. O novo acesso administrativo de leitura não concede escrita: um novo destinatário continua exigindo vínculo específico no fluxo oficial. Sana, n8n, W-API, OpenBot, Boss Bridge, webhooks, pausa humana e filas não serão modificados.

## Revogação e retorno

`revoke-access.sql` desativa somente a nova concessão administrativa; revogar as três publicações também interrompe seu uso. A auditoria é preservada. Os componentes podem retornar às versões de origem registradas em `candidate-manifest.json`; o vínculo anterior da conversa de teste e os registros dos envios já realizados permanecem.

Autorização solicitada: instalar esse candidato nos componentes existentes, ativar essa leitura administrativa por 7 dias e aprovar a publicação dessas três orientações. A execução só ocorrerá após autorização expressa desse escopo.
