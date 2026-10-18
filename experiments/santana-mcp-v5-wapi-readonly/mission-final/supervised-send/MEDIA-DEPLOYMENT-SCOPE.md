# Extensão de anexos no envio supervisionado existente

Estado: escopo implantado por solicitação de continuidade em 18/10/2026; imagem e PDF reais ainda não enviados. Permissão de envio continua fechada.

## Escopo de produção aplicado

1. No banco SANTANA-SANA-PROD existente: acrescentar `attachment_id` com chave estrangeira à tabela `sana_mcp_send_operations`; substituir apenas a restrição de texto por vínculo entre anexo e operação; acrescentar a função privada `attachment_matches`; atualizar somente a RPC MCP `sana_mcp_coordinated_send`. Script exato: `media-upgrade.sql`.
2. Na Edge Function existente `sana-panel-preview-login`: substituir somente o módulo MCP `mcp-official-operations.ts` pelo candidato `edge-operations.ts` e incluir seu auxiliar `media-attachments.mjs`. A entrada e todos os módulos do atendimento permanecem iguais.
3. No projeto oficial Vercel existente: atualizar `lib/sana/official-adapter.mjs` e `lib/sana/edge-operations.mjs`, incluir `lib/sana/media-attachments.mjs`, atualizar somente a prévia de anexo em `app/mcp-authorize/page.tsx` e ajustar o prazo interno exclusivamente das ações MCP na rota `app/api/runtime/sana-control/route.ts`. Base de produção conhecida: `6e991ad5a9fa6ecd4b544a1e762ebed8ca3828d6`.

Sem novas tabelas, buckets, projetos, plugins, serviços ou credenciais. O emissor `manual-whatsapp.ts`, `sana_manual_whatsapp`, `sana_control_transition`, as barreiras de concorrência, Sana, n8n, webhooks, Boss Bridge, LAB e túneis não serão alterados.

## Controle dos anexos

- Um único PNG, JPEG ou PDF por operação, até 512 KiB.
- Aprovação específica por classe: texto, imagem ou documento.
- O hash da preparação inclui destinatário, texto e metadados/hash do anexo.
- Os bytes são obtidos da revisão pessoal, verificados e colocados sem sobrescrita no bucket privado oficial já existente.
- Operador, conversa, operação, arquivo, tamanho, MIME e SHA-256 são conferidos novamente antes do claim oficial; arquivo divergente não inicia envio.
- O transporte permanece exclusivamente o emissor oficial. Imagem/documento e legenda usam a mesma chamada, sem segunda mensagem de texto.
- Mesmo claim único, revisão da conversa, pausa humana, auditoria e bloqueio de repetição em resultado desconhecido.
- A implantação não ativa nenhuma permissão de envio. Um teste real precisará de aprovação exata e registro pessoal no Painel.

## Verificação já realizada

27 testes Node e 2 testes Python passaram localmente e no runner existente da VPS (run `39161272624`, job `117774932888`, conclusão `success`). O fluxo completo de identidade/revisão/armazenamento/emissor foi simulado com os arquivos de teste reais. A qualificação PostgreSQL passou em HOMOLOG usando apenas tabelas/funções temporárias e rollback; nenhuma alteração permanente nem transporte real.

A compilação de prévia e produção passou na aplicação existente; a página HTTPS respondeu 200 e o bloqueio fechado foi comprovado na RPC em produção, sem criar operação nem chamar o transporte. Não há comprovação de envio real de imagem ou PDF ainda.

## Próximos testes, separados

Primeiro: `Santana-Teste-Imagem.png`, Wellington, final 5497, com legenda `Teste supervisionado de imagem da integração WhatsApp Santana com o ChatGPT.` Uma aprovação, uma tentativa. Depois: PDF sintético, com outra operação e aprovação.

## Reversão

Fechar a permissão restrita do teste. Se houver operação `dispatching` ou `unknown`, reconciliar antes de qualquer reversão; nunca removê-la nem reenviá-la. Repor o módulo Edge MCP e o deploy oficial da etapa de texto. Preservar a coluna e registros aditivos para não perder o vínculo/auditoria de anexos já aprovados. Nenhum rollback remove mensagens, revisões ou histórico.
