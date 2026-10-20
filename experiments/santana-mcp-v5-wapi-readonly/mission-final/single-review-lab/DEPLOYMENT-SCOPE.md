# Escopo para aprovação — revisão única no Painel

**Estado: escopo aprovado pelo operador e implantado.** Os itens e hashes abaixo registram o escopo autorizado; os resultados estão em [DEPLOYMENT-RESULT.md](DEPLOYMENT-RESULT.md). A aprovação de implantação não autoriza envio de mensagens.

O operador abre a prévia no Painel, usa a sessão individual válida, confere destinatário/texto/anexos e clica **Aprovar e enviar**. O backend registra a aprovação e chama o emissor oficial na mesma solicitação. O ChatGPT consulta o recibo. Outras respostas ficam na mesma tela, com aprovações independentes. Não existe botão para aprovar ou disparar um lote.

## Delta exato: onze itens

O arquivo `candidate-manifest.json` contém SHA-256 de cada item. SHA-256 do manifesto:

`2c654bccfb3f2167a68c5e6ec2c7736fb73274262eb6a6d1c17b3cc635514901`

| Destino existente | Item do candidato | Mudança |
|---|---|---|
| Supabase SANTANA-SANA-PROD | `database.sql` | Cria somente a tabela privada `sana_mcp_panel_reviews`, RLS/índice e RPC invoker `sana_mcp_panel_review(jsonb)`. Guarda rascunhos, conteúdo/anexos preparados, destino exato, hash e prova da aprovação. Sem acesso direto por anon/authenticated. Acrescenta eventos à auditoria já existente. Não altera as funções do coordenador, controle humano ou envio. |
| Edge PROD `sana-panel-preview-login` | `prod-edge/single-review-edge.ts` | Valida identidade humana PROD, escopo vigente, desafio e hash; reutiliza identidade, mídia e coordenador existentes. Não contém transporte W-API. |
| Mesma Edge PROD | `prod-edge/mount.json` → `index.ts` | Acrescenta somente import e oito ações internas, depois do gate privado já existente. Preserva todos os demais arquivos/rotas. |
| Painel oficial existente | `panel/app/api/runtime/sana-control/route.ts` | Acrescenta seis ações públicas do fluxo e binding; protege origem e separa preparação OAuth de aprovação PROD. Não expõe prepare/settle internos ao navegador. |
| Mesmo Painel | `panel/app/mcp-review/page.tsx` | Nova rota de revisão no próprio Painel. Reutiliza cliente e sessão; login na mesma tela apenas se necessário, sem senha fixa ou tentativas automáticas. |
| Mesmo Painel | `panel/lib/sana/single-review-screen.tsx` | Prévia integral, anexos, botão por operação, recibo e paginação. Máximo de duas leituras simultâneas de prévia. |
| Mesmo Painel | `panel/lib/sana/single-review-core.mjs` | Aprova e solicita uma única execução no mesmo pedido. Repetições só consultam; falhas ambíguas não retomam envio. |
| Mesmo Painel | `panel/lib/sana/single-review-binding.ts` | Importa `sendManualWhatsApp` nativo sem alterar o emissor. |
| Edge HOMOLOG `sana-mcp-read` | `homolog-edge/send-intents-core.mjs` | Acrescenta prova de propriedade do rascunho acessível somente ao mesmo OAuth/cliente/sessão ativa. Não aprova, não envia e não usa login humano HOMOLOG neste fluxo. |
| MCP OAuth já publicado | `mcp/server.py` → `whatsapp-santana-mcp/server.py` | As ferramentas existentes `preparar_envio` e `consultar_envio_preparado` passam a atualizar contexto, retornar a tela única e consultar o recibo. Preserva operações antigas. |
| Mesmo MCP | `mcp/panel_review_provider.py` → `whatsapp-santana-mcp/panel_review_provider.py` | Adaptador somente de staging/consulta, sem aprovação, emissão ou retry. |

Uma única configuração adicional, **não secreta**, no projeto existente do Painel: `SANTANA_SINGLE_REVIEW_READY=verified`, ativada por último. Ela não cria permissões e permanece ausente/desligada até a implantação autorizada e seus checks. Os tokens humanos de login continuam separados: PROD só no Painel/PROD; nenhum token humano HOMOLOG é transferido. A integração OAuth federada existente é utilizada apenas para comprovar autoria/consultar a preparação, nunca para autorizar escrita como operador PROD.

## Permissões e validade

Nenhuma nova concessão de leitura/escrita, conta, segredo, plugin, projeto, túnel ou serviço. O fluxo usa exclusivamente as concessões existentes do operador PROD `8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f`, identidade OAuth e cliente atuais, somente conversas administrativas permitidas. Não cria contato arbitrário. Leitura não concede escrita.

O vencimento permanece **25/10/2026 às 19h25, America/Sao_Paulo**. Não há renovação automática. A aprovação é individual por mensagem, vinculada à sessão PROD, destinatário exato, conteúdo/anexos, operação, revisão e mensagens recentes. Revogar sessão, perfil ou concessão bloqueia novas aprovações/preparações.

## Pré-requisitos da aplicação autorizada

1. Confirmar novamente versões e hashes. Bases auditadas: Edge PROD v43, pacote `5c602e62ebacab97fb19d4c7454910f5f337a491fb3de84805fff684a787bcf9`; Edge HMG v16, pacote `19f5eb0281af6ba5f9acba38666afa44d158fbc3f98ccc0e6bbee69399d770c2`; Painel no commit `bbc4e108e703322ee30f5aa6624926829f7b1066`; MCP no deployment `dpl_25yLqLJACBQeTWxmhytq1JALr1Tn`. O UID SHA-1 do `server.py` publicado coincide com a base local: `aefe4beafe6f49c83c347c7737c311283cd9f1ff`. Interromper se houver divergência, sem sobrescrever trabalho novo.
2. Salvar backups completos dos deployments existentes, configurações de ativação e definições SQL afetadas. A tabela/RPC são novas; não executar migrações antigas de concessão.
3. Fazer o build no projeto real do Painel, preservando os demais arquivos. O candidato passou em compilação de componentes e tipagem; não foi afirmado um build integral do projeto.
4. Aplicar o delta aos mesmos projetos Supabase/Vercel. O MCP OAuth está no projeto Vercel existente, com fonte `whatsapp-santana-mcp`; não é necessário alterar o MCP fixture da VPS nem seu túnel.
5. Verificar montagem, catálogo, sessão/revogação e rota, sem acionar mensagem real. Ativar a flag por último. A validação humana da nova tela com sessão real só ocorre após essa implantação autorizada.

## Reversão

Desativar `SANTANA_SINGLE_REVIEW_READY` primeiro. Restaurar deployments/arquivos anteriores do Painel, Edge PROD, HMG e MCP, usando os backups verificados. Preservar a tabela nova, provas de aprovação, auditoria, operações e resultados; não apagar registros nem tentar reenviar operações interrompidas. Operações novas pendentes não migram automaticamente para o fluxo antigo.

Permanecem intocados o código do emissor, W-API/configuração, webhooks, Sana, n8n, OpenBot, Boss Bridge, ponte multiagente, identidade OAuth, plugins e túneis. Não ativa lote real nem atendimento automático.

## Evidência e limite da autorização

**44 testes isolados aprovados**, tipagem e compilação aprovadas; logs em `evidence/`. Texto, imagem/PDF, sessão reutilizada/expirada, múltiplas respostas, paginação, clique duplo, troca de destinatário, contexto novo, revogação, adulteração de anexo, prova OAuth expirada/de outro cliente, timeout e falhas antes/depois do ACK foram exercitados com dados fictícios e transporte simulado. PostgreSQL utilizado: PGlite em memória. Não é teste de carga/conectividade em produção. A inspeção visual pelo navegador ficou bloqueada pela política para arquivos locais; os testes DOM da tela passaram.

**Autorização solicitada:** aplicar somente estes onze itens e ativar a flag no projeto existente, mantendo concessões e vencimento atuais. Esta autorização de implantação **não autoriza envio real**. Cada mensagem continuará exigindo a aprovação autenticada específica do operador no Painel.
