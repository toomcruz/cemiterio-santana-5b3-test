# Implantação única — uso diário do MCP Santana

Estado: candidato isolado, aguardando aprovação específica. Nenhuma implantação PROD, nova concessão de escrita ou mensagem real foi executada.

## Evidência real de anexos

Em 19/10/2026, a mesma foto e o mesmo PDF que falharam foram lidos pela conexão atual, sem mudança de código ou permissão: JPEG de 472.599 bytes e PDF de 132.876 bytes, uma página com texto extraído. Cruzar o identificador do PDF com a conversa da imagem foi bloqueado, sem retornar conteúdo.

A causa transitória da falha anterior não foi estabelecida. O defeito de diagnóstico foi comprovado: negação de escopo e outras falhas terminavam no mesmo HTTP 400 / JSON-RPC -32000. O candidato preserva códigos fixos para negação, indisponibilidade, timeout, tamanho, integridade e renderização, sem expor credenciais, URLs do provedor, SQL ou conteúdo. Não faz tentativas automáticas.

## Dez arquivos do delta

| Componente existente | Arquivo | Alteração |
|---|---|---|
| Supabase PROD | `database.sql` | Nova tabela privada com RLS `sana_mcp_supervised_send_access`; funções invoker de escopo e marcador recente; função interna restrita `sana_mcp_private.response_triage`. Atualiza somente `sana_mcp_coordinated_send` e `sana_mcp_admin_read`. |
| Edge PROD | `prod-edge/mcp-admin-core.mjs` | Triagem conservadora e códigos seguros de erro. |
| Edge PROD | `prod-edge/mcp-admin-assist.ts` | Preserva os códigos da rota de anexos e distingue timeout. |
| Edge PROD | `prod-edge/mcp-official-operations.ts` | Aceita a concessão individual separada após verificar identidade PROD e revisão independente. |
| Painel oficial | `panel/lib/sana/mcp-read-media.mjs` | Reutiliza os mesmos helpers; normaliza configuração, trata download nulo e distingue falhas. Não altera a interface ou emissor. |
| Edge HOMOLOG | `homolog-edge/send-intents-core.mjs` | Vincula o marcador recente à prévia e ao hash aprovado. Preserva os outros arquivos da versão 15. |
| MCP existente | `mcp/whatsapp-santana-mcp/server.py` | Acrescenta consulta do estado oficial da operação preparada. |
| MCP existente | `mcp/whatsapp-santana-mcp/official_send_provider.py` | Acrescenta somente consulta de estado, preservando o transporte. |
| MCP existente | `mcp/whatsapp-santana-mcp/sana_read_provider.py` | Encaminha somente códigos administrativos fixos e seguros. |
| MCP existente | `mcp/whatsapp-santana-mcp/admin_assist_tools.py` | Devolve falhas estruturadas sem repetir consultas automaticamente. |

A ativação separada usa `deployment-delta/activate-after-approval.sql`, protegida pelo hash exato do manifesto. Os testes não a executam contra produção.

## Única concessão nova

Envio **individual supervisionado**, separado da leitura, para o operador PROD `8d76a3eb-4dad-40ac-a7ce-6b5be268ce7f`, vinculado à identidade OAuth e cliente ChatGPT atuais, no escopo `panel:santana`. Cobre somente conversas que continuarem autorizadas pelo perfil e pela concessão administrativa de leitura; não exige cadastro técnico por telefone.

Validade herdada da leitura: **25/10/2026 às 19h25, horário de São Paulo**. Sem extensão automática. Não permite contatos arbitrários, OpenBot, lotes ou atendimento automático. A ativação não envia, não pausa conversas nem aprova operações. O modelo não recebe credenciais de escrita nem pode criar concessões.

## Proteção por mensagem

Verificar identidade PROD, perfil, escopo, vigência, destinatário, revisão e mensagens recentes antes da aprovação e novamente no coordenador oficial. A prévia vincula destinatário, texto integral, anexos, hash e operação única. Nova mensagem ou mudança de revisão invalida a autorização anterior.

Cada envio continua exigindo confirmação específica e prova autenticada na interface protegida existente. Chat, leitura e concessão administrativa isoladamente não autorizam o backend a enviar. Sessões válidas são reaproveitadas conforme o fluxo atual.

Reutiliza `sana_control_transition` e `sana_manual_whatsapp`. Preserva pausa humana, travas oficiais, auditoria, idempotência e bloqueio de resultados desconhecidos. Aceite pela API não é entrega confirmada. Não cria outro emissor W-API.

## Triagem sem encerrar atendimentos

Agradecimentos e confirmações sem nova solicitação vão para `informational_items`, com `response_required=false`, preservando a conversa e o estado original de entrega. Exige resposta efetivamente enviada, histórico da mesma conversa e sequência recente completa. Texto apenas gerado não conta.

Aceites de horário, perguntas, correções, anexos, promessas de retorno pendentes, contexto incompleto, falhas, envios em andamento e resultados desconhecidos continuam visíveis. Mantém paginação mesmo com página apenas informativa. Sessão `closed` não significa atendimento resolvido.

Regras sem publicação oficialmente aprovada continuam indisponíveis. AUTHORITY, LOCATOR e FOLLOWUP_SCOPE não são promovidas a normas por este delta.

## Aplicação e reversão

Verificar hashes e versões de `deployment-delta/manifest.json`, obter backup e interromper se qualquer origem divergir. Aplicar somente esses dez arquivos nos componentes existentes, preservando os demais arquivos das Edge Functions. Ativar a concessão por último, após checks de leitura e catálogo. Não executar envio real durante a implantação.

Revogar desativando somente a nova concessão. Reverter restaurando os arquivos e as duas definições SQL anteriores, preservando auditoria, operações, leitura e concessões individuais antigas.

As evidências sanitizadas estão em `../admin-assist/validation/daily-operations/`. Testes com dados e transporte fictícios, sem repetir infraestrutura ou envios reais já concluídos.

Preservar Sana, OpenBot, Boss Bridge, n8n, W-API, webhooks, plugin, identidade OAuth, túnel e canal oficial. Nenhum projeto ou serviço novo.

**Autorização necessária:** aplicar este delta e ativar somente o envio administrativo individual supervisionado até o vencimento atual. Essa aprovação não autoriza mensagens reais nem lotes.
