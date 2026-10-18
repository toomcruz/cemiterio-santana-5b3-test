# Única autorização adicional — envio administrativo supervisionado

Estado: candidato isolado. Nenhuma permissão administrativa de envio foi criada em PROD e nenhum envio real integra esta etapa.

## O que seria implantado

1. **No Supabase SANTANA-SANA-PROD existente:** acrescentar a tabela privada com RLS `sana_mcp_supervised_send_access`, separada da concessão de leitura, e duas funções invoker restritas ao serviço: verificação de escopo e marcador das mensagens recentes. Atualizar somente `sana_mcp_coordinated_send` e a projeção de metadados da leitura para vincular esse marcador à operação. Preservar as funções oficiais `sana_control_transition` e `sana_manual_whatsapp` e as barreiras de concorrência já instaladas.
2. **Na Edge Function PROD existente:** atualizar apenas `mcp-official-operations.ts` para aceitar a nova concessão administrativa após verificar a sessão individual PROD e a revisão independente. O vínculo de leitura sozinho continua insuficiente. Os caminhos antigos de concessão individual são preservados.
3. **Na Edge Function HOMOLOG existente:** atualizar somente `send-intents-core.mjs` para incluir o marcador das mensagens recentes na prévia e no hash aprovado.
4. **No MCP existente:** atualizar somente `server.py` e `official_send_provider.py` para que `consultar_envio_preparado` consulte também o estado oficial da operação pela rota `mcp_status` já existente, inclusive após resultado desconhecido. Essa consulta não tenta enviar novamente. Os argumentos e as identidades dos plugins permanecem.

O manifesto identifica exatamente cinco arquivos de implantação. Não há novo emissor, plugin, túnel, projeto, serviço ou conta. A implantação deverá parar se as versões de origem tiverem mudado.

## A concessão proposta

Uma única concessão para o operador PROD `8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f`, vinculado à identidade OAuth e ao cliente ChatGPT existentes, no escopo `panel:santana`. Validade **até 25/10/2026 às 19h25, horário de São Paulo**, limitada também pela vigência da leitura atual.

Permite atender individualmente as conversas operacionais que continuarem autorizadas ao seu perfil administrativo, sem cadastrar permissões técnicas por contato. Não permite abrir contatos arbitrários, disparos em massa ou acesso do OpenBot. Perfil, concessão de leitura, concessão de escrita e vigência são reavaliados no backend; qualquer revogação bloqueia novas execuções.

## Cada envio continuará exigindo

- Uma operação única, prévia integral de destinatário, texto e anexos, revisão protegida existente e confirmação específica por operação. A aprovação no chat sozinha não substitui a prova autenticada do backend.
- Conferência da revisão e das mensagens recentes na autorização e imediatamente antes da reserva oficial de envio. Mensagem nova invalida a aprovação, mesmo sem mudança de revisão.
- Pausa humana pelo controle oficial somente na conversa selecionada, ausência de envio concorrente, idempotência e registro no histórico oficial. Uma operação em andamento ou com resultado desconhecido não será reenviada.
- Texto, imagem ou PDF dentro dos limites já validados. Aceite pela W-API não será apresentado como entrega confirmada.

As sessões válidas continuam sendo reaproveitadas pelas telas existentes. O requisito de autenticação humana recente e as duas etapas protegidas de revisão e autorização atuais são preservados; este candidato não elimina essas verificações.

## Ativação e reversão

Após autorização expressa deste escopo: verificar as versões, aplicar a migração, atualizar os três componentes existentes e ativar a única concessão administrativa. A ativação não envia mensagem nem muda a pausa das conversas. Cada mensagem futura continuará dependendo de aprovação própria.

Para revogar, desativar a nova concessão. Para retornar, restaurar o coordenador e os arquivos de origem preservados, mantendo a auditoria. Não remover as barreiras oficiais, o histórico, a leitura administrativa ou as concessões individuais anteriores.

Depois do piloto, proponho concessões administrativas contínuas e revogáveis, vinculadas às permissões atuais do operador, com sessões que continuam expirando normalmente. A retirada da renovação semanal depende de autorização separada; não será feita nesta implantação.

**Autorização solicitada:** implantar esse delta e ativar essa concessão de envio supervisionado até o término do piloto, sem executar qualquer envio real durante a implantação.
